/**
 * Pipeline V2 — Step 8: Post-Generation Quality Gate
 *
 * Validates and auto-fixes the generated trip before returning it.
 * Non-blocking: logs warnings but never prevents trip delivery.
 */

import type { Trip, TripDay, TripItem } from '../types';
import { calculateDistance } from '../services/geocoding';

const LONG_LEG_TARGET_KM = 2.5;
const LONG_LEG_HARD_KM = 4;
const IMPOSSIBLE_SPEED_KMH = 65;
const LOGISTICS_TYPES: TripItem['type'][] = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage'];
const GEO_STRICT_ENABLED = !['0', 'false', 'off'].includes(
  String(process.env.PIPELINE_GEO_STRICT || 'true').toLowerCase()
);

export interface ValidationResult {
  score: number; // 0-100 quality score
  warnings: string[];
  autoFixes: string[];
}

type LegMetric = {
  fromTitle: string;
  toTitle: string;
  distanceKm: number;
  travelMin: number;
  gapMin: number;
};

export function validateAndFixTrip(trip: Trip): ValidationResult {
  const warnings: string[] = [];
  const autoFixes: string[] = [];
  let penalties = 0;

  for (const day of trip.days) {
    // 1. Check for placeholder restaurants (no real data)
    for (const item of day.items) {
      if (item.type === 'restaurant' && !item.restaurant) {
        warnings.push(`Day ${day.dayNumber}: Restaurant "${item.title}" has no restaurant data`);
        penalties += 5;
      }
    }

    // 2. Check restaurant distances (should be < 2km from nearest activity)
    const activities = day.items.filter(i => i.type === 'activity');
    const restaurants = day.items.filter(i => i.type === 'restaurant' && !isHotelMeal(i));
    for (const resto of restaurants) {
      if (!resto.latitude || !resto.longitude || resto.latitude === 0) continue;
      const nearestDist = activities.length > 0
        ? Math.min(...activities
            .filter(a => a.latitude && a.longitude && a.latitude !== 0)
            .map(a => calculateDistance(resto.latitude, resto.longitude, a.latitude, a.longitude)))
        : Infinity;
      if (nearestDist > 3 && nearestDist !== Infinity) {
        warnings.push(`Day ${day.dayNumber}: Restaurant "${resto.title}" is ${nearestDist.toFixed(1)}km from nearest activity`);
        penalties += 3;
      }
    }

    // 3. Check for duplicate restaurants within the same day
    const restoNames = restaurants.map(r => r.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, ''));
    const dupes = restoNames.filter((name, idx) => restoNames.indexOf(name) !== idx);
    if (dupes.length > 0) {
      warnings.push(`Day ${day.dayNumber}: Duplicate restaurant(s): ${[...new Set(dupes)].join(', ')}`);
      penalties += 5;
    }

    // 4. Check for days without any activity (except travel days)
    if (activities.length === 0 && !day.items.some(i => i.type === 'flight' || i.type === 'transport')) {
      warnings.push(`Day ${day.dayNumber}: No activities scheduled`);
      penalties += 8;
    }

    // 5. Check for items at coordinates (0, 0)
    for (const item of day.items) {
      if (item.latitude === 0 && item.longitude === 0 && ['activity', 'restaurant'].includes(item.type)) {
        warnings.push(`Day ${day.dayNumber}: "${item.title}" has (0,0) coordinates`);
        penalties += 2;
      }
    }

    // 6. Check for unrealistic gaps between consecutive items (>3 hours with nothing)
    const sortedItems = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sortedItems.length; i++) {
      const prev = sortedItems[i - 1];
      const curr = sortedItems[i];
      const prevEnd = timeToMinutes(prev.endTime);
      const currStart = timeToMinutes(curr.startTime);
      const gap = currStart - prevEnd;
      if (gap > 180) { // 3 hours
        warnings.push(`Day ${day.dayNumber}: ${gap}min gap between "${prev.title}" and "${curr.title}"`);
        penalties += 2;
      }
    }

    // 7. Auto-fix: Remove duplicate restaurants (keep the first occurrence)
    const seenRestoNames = new Set<string>();
    const itemsToRemove: number[] = [];
    day.items.forEach((item, idx) => {
      if (item.type === 'restaurant') {
        const cleanName = item.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, '');
        // Allow same restaurant for different meals (breakfast vs lunch is OK)
        const mealType = item.title.match(/^(Petit-déjeuner|Déjeuner|Dîner)/)?.[0] || '';
        const key = `${cleanName}-${mealType}`;
        if (seenRestoNames.has(key)) {
          itemsToRemove.push(idx);
          autoFixes.push(`Day ${day.dayNumber}: Removed duplicate "${item.title}"`);
        } else {
          seenRestoNames.add(key);
        }
      }
    });
    for (const idx of itemsToRemove.reverse()) {
      day.items.splice(idx, 1);
    }

    // 8. Auto-fix: Re-index orderIndex after any removals
    day.items.forEach((item, idx) => {
      item.orderIndex = idx;
    });

    // 9. New geographic diagnostics + impossible transition checks
    const legMetrics = computeLegMetrics(day);
    const distances = legMetrics.map((l) => l.distanceKm).sort((a, b) => a - b);
    const maxLegKm = distances.length > 0 ? distances[distances.length - 1] : 0;
    const p95LegKm = distances.length > 0 ? percentile(distances, 0.95) : 0;
    const totalTravelMin = legMetrics.reduce((sum, leg) => sum + leg.travelMin, 0);

    day.geoDiagnostics = {
      maxLegKm: round2(maxLegKm),
      p95LegKm: round2(p95LegKm),
      totalTravelMin: Math.round(totalTravelMin),
    };

    if (!day.isDayTrip && GEO_STRICT_ENABLED) {
      const longTargetLegs = legMetrics.filter((l) => l.distanceKm > LONG_LEG_TARGET_KM);
      const hardLongLegs = legMetrics.filter((l) => l.distanceKm > LONG_LEG_HARD_KM);

      if (hardLongLegs.length > 0) {
        penalties += hardLongLegs.length * 8;
        for (const leg of hardLongLegs) {
          warnings.push(
            `Day ${day.dayNumber}: hard long leg ${leg.distanceKm.toFixed(1)}km between "${leg.fromTitle}" and "${leg.toTitle}"`
          );
        }
      }

      if (longTargetLegs.length > 1) {
        penalties += (longTargetLegs.length - 1) * 4;
        warnings.push(
          `Day ${day.dayNumber}: ${longTargetLegs.length} legs > ${LONG_LEG_TARGET_KM}km (target max = 1)`
        );
      }
    }

    for (const leg of legMetrics) {
      const speedKmh = leg.travelMin > 0 ? (leg.distanceKm / leg.travelMin) * 60 : 0;
      const impossibleByGap = leg.distanceKm > LONG_LEG_HARD_KM && leg.gapMin >= 0 && leg.gapMin < 15;
      const impossibleBySpeed = leg.distanceKm > 1.5 && speedKmh > IMPOSSIBLE_SPEED_KMH;

      if (impossibleByGap || impossibleBySpeed) {
        penalties += 7;
        warnings.push(
          `Day ${day.dayNumber}: impossible transition "${leg.fromTitle}" → "${leg.toTitle}" (${leg.distanceKm.toFixed(1)}km, ${leg.travelMin}min, gap=${leg.gapMin}min)`
        );
      }
    }

    // Boundary transport sanity: should not be 0km when source and destination differ
    checkBoundaryConsistency(day, warnings, (deltaPenalty) => { penalties += deltaPenalty; });
  }

  // 10. Check hotel distance from activities centroid
  const allActivityCoords = trip.days.flatMap(d =>
    d.items.filter(i => i.type === 'activity' && i.latitude && i.longitude && i.latitude !== 0)
  );
  if (allActivityCoords.length > 0) {
    const centroid = {
      lat: allActivityCoords.reduce((s, a) => s + a.latitude, 0) / allActivityCoords.length,
      lng: allActivityCoords.reduce((s, a) => s + a.longitude, 0) / allActivityCoords.length,
    };

    const hotelItem = trip.days[0]?.items.find(i => i.type === 'checkin');
    if (hotelItem && hotelItem.latitude && hotelItem.latitude !== 0) {
      const hotelDist = calculateDistance(centroid.lat, centroid.lng, hotelItem.latitude, hotelItem.longitude);
      if (hotelDist > 5) {
        warnings.push(`Hotel "${hotelItem.title}" is ${hotelDist.toFixed(1)}km from activities centroid`);
        penalties += 5;
      }
    }
  }

  const score = Math.max(0, 100 - penalties);

  if (warnings.length > 0) {
    console.log(`[Pipeline V2] Step 8 Quality Gate: Score ${score}/100`);
    warnings.forEach(w => console.log(`  ⚠️ ${w}`));
  }
  if (autoFixes.length > 0) {
    autoFixes.forEach(f => console.log(`  🔧 ${f}`));
  }

  return { score, warnings, autoFixes };
}

function computeLegMetrics(day: TripDay): LegMetric[] {
  const sortedItems = [...day.items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const routeItems = sortedItems.filter((item) => !isLogisticsItem(item) && !isHotelMeal(item));
  const legs: LegMetric[] = [];

  for (let i = 1; i < routeItems.length; i++) {
    const from = routeItems[i - 1];
    const to = routeItems[i];

    if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) continue;
    if (from.latitude === 0 || from.longitude === 0 || to.latitude === 0 || to.longitude === 0) continue;

    const directDistanceKm = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    const reportedDistanceKm =
      typeof to.distanceFromPrevious === 'number' && to.distanceFromPrevious > 0
        ? to.distanceFromPrevious
        : null;
    const canTrustReportedDistance =
      typeof reportedDistanceKm === 'number'
      && Math.abs(reportedDistanceKm - directDistanceKm) <= 0.75;
    const distanceKm = canTrustReportedDistance ? reportedDistanceKm : directDistanceKm;

    const reportedTravelMin =
      typeof to.timeFromPrevious === 'number' && to.timeFromPrevious > 0
        ? to.timeFromPrevious
        : null;
    const estimatedTravelMin = Math.max(5, Math.round(distanceKm * 12));
    const travelMin = reportedTravelMin && canTrustReportedDistance
      ? reportedTravelMin
      : estimatedTravelMin;

    const gapMin = timeToMinutes(to.startTime) - timeToMinutes(from.endTime);

    legs.push({
      fromTitle: from.title,
      toTitle: to.title,
      distanceKm,
      travelMin,
      gapMin,
    });
  }

  return legs;
}

function isLogisticsItem(item: TripItem): boolean {
  return LOGISTICS_TYPES.includes(item.type);
}

function isHotelMeal(item: TripItem): boolean {
  if (item.type !== 'restaurant') return false;
  const normalizedTitle = (item.title || '')
    .toLowerCase()
    .replace(/’/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalizedTitle.includes("a l'hotel") || normalizedTitle.includes('at hotel');
}

function checkBoundaryConsistency(
  day: TripDay,
  warnings: string[],
  addPenalty: (penalty: number) => void
): void {
  const departurePrefix = `hotel-depart-${day.dayNumber}-`;
  const returnPrefix = `hotel-return-${day.dayNumber}-`;

  for (const item of day.items) {
    if (item.type !== 'transport') continue;

    if (item.id.startsWith(departurePrefix)) {
      const targetId = item.id.slice(departurePrefix.length);
      const target = day.items.find((candidate) => candidate.id === targetId);
      if (!target || !item.latitude || !item.longitude || !target.latitude || !target.longitude) continue;

      const direct = calculateDistance(item.latitude, item.longitude, target.latitude, target.longitude);
      const declared = item.distanceFromPrevious || 0;
      if (direct > 0.2 && declared < 0.05) {
        warnings.push(`Day ${day.dayNumber}: hotel departure "${item.title}" has incoherent 0km distance`);
        addPenalty(6);
      }
    }

    if (item.id.startsWith(returnPrefix)) {
      const sourceId = item.id.slice(returnPrefix.length);
      const source = day.items.find((candidate) => candidate.id === sourceId);
      if (!source || !item.latitude || !item.longitude || !source.latitude || !source.longitude) continue;

      const direct = calculateDistance(source.latitude, source.longitude, item.latitude, item.longitude);
      const declared = item.distanceFromPrevious || 0;
      if (direct > 0.2 && declared < 0.05) {
        warnings.push(`Day ${day.dayNumber}: hotel return "${item.title}" has incoherent 0km distance`);
        addPenalty(6);
      }
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
