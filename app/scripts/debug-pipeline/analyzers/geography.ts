/**
 * Analyseur géographique — coordonnées, distances, cohérence spatiale
 */

import { Trip, TripItem } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

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
      if (centerCount > 0 && item.type === 'restaurant') {
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
    const nonLogistics = items.filter(i => !['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage'].includes(i.type));
    for (let i = 0; i < nonLogistics.length - 1; i++) {
      const current = nonLogistics[i];
      const next = nonLogistics[i + 1];

      if (current.latitude === 0 || next.latitude === 0) continue;

      const dist = haversineDistance(current.latitude, current.longitude, next.latitude, next.longitude);
      const gapMinutes = parseTime(next.startTime) - parseTime(current.endTime);

      // Plus de 20km entre deux items consécutifs
      if (dist > 20 && !day.isDayTrip) {
        issues.push({
          severity: 'warning',
          category: 'geography',
          message: `Jour ${day.dayNumber}: ${dist.toFixed(1)}km entre "${current.title}" et "${next.title}" — trajet long`,
          dayNumber: day.dayNumber,
          details: { distanceKm: Math.round(dist), gapMinutes },
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
    });
  }

  return issues;
}
