/**
 * Analyseur géographique — coordonnées, distances, cohérence spatiale
 */

import { Trip, TripItem } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

const URBAN_LONG_LEG_TARGET_KM = 2.5;
const URBAN_LONG_LEG_HARD_KM = 4;
const OUTLIER_MIN_THRESHOLD_KM = 3;
const LOGISTICS_TYPES = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage'];

function isHotelMeal(item: TripItem): boolean {
  if (item.type !== 'restaurant') return false;
  const normalizedTitle = (item.title || '')
    .toLowerCase()
    .replace(/’/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalizedTitle.includes("a l'hotel") || normalizedTitle.includes('at hotel');
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function activityDistanceFromCentroid(items: TripItem[]): Map<string, number> {
  const points = items.filter((item) => item.latitude !== 0 && item.longitude !== 0);
  if (points.length < 3) return new Map();

  const centroid = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.latitude, lng: acc.lng + point.longitude }),
    { lat: 0, lng: 0 }
  );
  centroid.lat /= points.length;
  centroid.lng /= points.length;

  const distances = new Map<string, number>();
  for (const point of points) {
    distances.set(
      point.id,
      haversineDistance(centroid.lat, centroid.lng, point.latitude, point.longitude)
    );
  }
  return distances;
}

export function analyzeGeography(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  // Chercher un point de référence pour le centre-ville
  // Utiliser l'hébergement ou la moyenne des coordonnées
  let centerLat = 0;
  let centerLng = 0;
  let centerCount = 0;

  if (trip.accommodation && trip.accommodation.latitude !== 0) {
    centerLat = trip.accommodation.latitude;
    centerLng = trip.accommodation.longitude;
    centerCount = 1;
  }

  if (centerCount === 0) {
    // Calculer la moyenne des coordonnées des activités
    for (const day of trip.days) {
      for (const item of day.items) {
        if (item.latitude !== 0 && item.longitude !== 0 && item.type === 'activity') {
          centerLat += item.latitude;
          centerLng += item.longitude;
          centerCount++;
        }
      }
    }
    if (centerCount > 0) {
      centerLat /= centerCount;
      centerLng /= centerCount;
    }
  }

  for (const day of trip.days) {
    const items = [...day.items].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    for (const item of items) {
      if (item.type === 'flight') continue;

      // Coordonnées nulles ou (0,0)
      if (item.latitude === 0 && item.longitude === 0) {
        issues.push({
          severity: 'critical',
          category: 'geography',
          message: `Jour ${day.dayNumber}: "${item.title}" a des coordonnées (0, 0) — non géocodé`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
        });
        continue;
      }

      // Coordonnées absurdes
      if (Math.abs(item.latitude) > 90 || Math.abs(item.longitude) > 180) {
        issues.push({
          severity: 'critical',
          category: 'geography',
          message: `Jour ${day.dayNumber}: "${item.title}" a des coordonnées invalides (${item.latitude}, ${item.longitude})`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
        });
        continue;
      }

      // Activité trop loin du centre (>30km) pour les non-day-trips
      if (centerCount > 0 && item.type === 'activity' && !day.isDayTrip) {
        const dist = haversineDistance(centerLat, centerLng, item.latitude, item.longitude);
        if (dist > 30) {
          issues.push({
            severity: 'warning',
            category: 'geography',
            message: `Jour ${day.dayNumber}: "${item.title}" est à ${dist.toFixed(1)}km du centre — trop loin ?`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            details: { distanceKm: Math.round(dist) },
          });
        }
      }

      // Restaurant trop loin du centre (>15km)
      if (centerCount > 0 && item.type === 'restaurant' && !isHotelMeal(item)) {
        const dist = haversineDistance(centerLat, centerLng, item.latitude, item.longitude);
        if (dist > 15) {
          issues.push({
            severity: 'warning',
            category: 'geography',
            message: `Jour ${day.dayNumber}: restaurant "${item.title}" est à ${dist.toFixed(1)}km du centre`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            details: { distanceKm: Math.round(dist) },
          });
        }
      }
    }

    // Distance entre activités consécutives
    const nonLogistics = items.filter(i => !LOGISTICS_TYPES.includes(i.type) && !isHotelMeal(i));
    const dayLegDistancesKm: number[] = [];

    for (let i = 0; i < nonLogistics.length - 1; i++) {
      const current = nonLogistics[i];
      const next = nonLogistics[i + 1];

      if (current.latitude === 0 || next.latitude === 0) continue;

      const dist = haversineDistance(current.latitude, current.longitude, next.latitude, next.longitude);
      const gapMinutes = parseTime(next.startTime) - parseTime(current.endTime);
      dayLegDistancesKm.push(dist);

      // Plus de 20km entre deux items consécutifs
      if (dist > 20 && !day.isDayTrip) {
        issues.push({
          severity: 'warning',
          category: 'geography',
          message: `Jour ${day.dayNumber}: ${dist.toFixed(1)}km entre "${current.title}" et "${next.title}" — trajet long`,
          dayNumber: day.dayNumber,
          details: { distanceKm: Math.round(dist), gapMinutes },
          code: 'GEO_VERY_LONG_DAY_LEG',
          component: 'pipeline/geography',
          frequencyWeight: 1.2,
        });
      }

      // Trajet impossible : grande distance avec peu de temps
      if (dist > 5 && gapMinutes < 15) {
        issues.push({
          severity: 'critical',
          category: 'geography',
          message: `Jour ${day.dayNumber}: ${dist.toFixed(1)}km entre "${current.title}" et "${next.title}" avec seulement ${gapMinutes}min de battement`,
          dayNumber: day.dayNumber,
          details: { distanceKm: dist.toFixed(1), gapMinutes },
          code: 'GEO_IMPOSSIBLE_TRANSITION',
          component: 'pipeline/step8-validate',
          frequencyWeight: 2,
          autofixCandidate: true,
        });
      }

      // Règle urbaine non day-trip: 0 legs >4km
      if (!day.isDayTrip && dist > URBAN_LONG_LEG_HARD_KM) {
        issues.push({
          severity: 'critical',
          category: 'geography',
          message: `Jour ${day.dayNumber}: segment urbain dur ${dist.toFixed(1)}km entre "${current.title}" et "${next.title}" (> ${URBAN_LONG_LEG_HARD_KM}km)`,
          dayNumber: day.dayNumber,
          details: { distanceKm: Number(dist.toFixed(2)), thresholdKm: URBAN_LONG_LEG_HARD_KM },
          code: 'GEO_URBAN_HARD_LONG_LEG',
          component: 'pipeline/step8-validate',
          frequencyWeight: 2.2,
          autofixCandidate: true,
        });
      }
    }

    // Règle urbaine non day-trip: max 1 leg >2.5km
    if (!day.isDayTrip) {
      const longLegCount = dayLegDistancesKm.filter((d) => d > URBAN_LONG_LEG_TARGET_KM).length;
      if (longLegCount > 1) {
        issues.push({
          severity: 'warning',
          category: 'geography',
          message: `Jour ${day.dayNumber}: ${longLegCount} segments > ${URBAN_LONG_LEG_TARGET_KM}km (max cible: 1)`,
          dayNumber: day.dayNumber,
          details: { longLegCount, thresholdKm: URBAN_LONG_LEG_TARGET_KM, maxAllowed: 1 },
          code: 'GEO_URBAN_TOO_MANY_LONG_LEGS',
          component: 'pipeline/step8-validate',
          frequencyWeight: 1.6,
          autofixCandidate: true,
        });
      }
    }

    // Outliers intra-journée par percentile
    const distByItemId = activityDistanceFromCentroid(nonLogistics);
    if (distByItemId.size >= 3) {
      const values = [...distByItemId.values()];
      const p90 = percentile(values, 0.9);
      const threshold = Math.max(OUTLIER_MIN_THRESHOLD_KM, p90);
      for (const item of nonLogistics) {
        const dist = distByItemId.get(item.id);
        if (!dist || dist <= threshold) continue;
        issues.push({
          severity: 'warning',
          category: 'geography',
          message: `Jour ${day.dayNumber}: "${item.title}" est un outlier géographique (${dist.toFixed(1)}km du centroïde journalier)`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
          details: { distanceKm: Number(dist.toFixed(2)), p90Km: Number(p90.toFixed(2)), thresholdKm: Number(threshold.toFixed(2)) },
          code: 'GEO_DAY_OUTLIER',
          component: 'pipeline/step7-assemble',
          frequencyWeight: 1.4,
          autofixCandidate: true,
        });
      }
    }
  }

  // Hébergement
  if (trip.accommodation) {
    if (trip.accommodation.latitude === 0 && trip.accommodation.longitude === 0) {
      issues.push({
        severity: 'critical',
        category: 'geography',
        message: `Hébergement "${trip.accommodation.name}" a des coordonnées (0, 0)`,
      });
    } else if (centerCount > 0) {
      const hotelDist = haversineDistance(centerLat, centerLng, trip.accommodation.latitude, trip.accommodation.longitude);
      if (hotelDist > 10) {
        issues.push({
          severity: 'warning',
          category: 'geography',
          message: `Hébergement "${trip.accommodation.name}" est à ${hotelDist.toFixed(1)}km du centre des activités`,
          details: { distanceKm: Math.round(hotelDist) },
        });
      }
    }
  }

  // Stats de fiabilité des données
  let verified = 0, estimated = 0, generated = 0, noReliability = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.dataReliability === 'verified') verified++;
      else if (item.dataReliability === 'estimated') estimated++;
      else if (item.dataReliability === 'generated') generated++;
      else noReliability++;
    }
  }

  if (generated > verified + estimated) {
    issues.push({
      severity: 'warning',
      category: 'geography',
      message: `Majorité des coordonnées générées (${generated} generated vs ${verified} verified + ${estimated} estimated) — qualité GPS faible`,
      details: { verified, estimated, generated, noReliability },
      code: 'GEO_DATA_RELIABILITY_LOW',
      component: 'pipeline/geocoding',
      frequencyWeight: 1.1,
    });
  }

  return issues;
}
