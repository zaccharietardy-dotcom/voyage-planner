/**
 * Pipeline V2 — Step 8: Post-Generation Quality Gate
 *
 * Validates and auto-fixes the generated trip before returning it.
 * Non-blocking: logs warnings but never prevents trip delivery.
 */

import type { Trip, TripDay, TripItem } from '../types';
import { calculateDistance } from '../services/geocoding';
import { formatDateForUrl, generateFlightLink, generateFlightOmioLink } from '../services/linkGenerator';
import { getHotelHardCapKmForProfile, resolveQualityCityProfile } from './qualityPolicy';

const LONG_LEG_TARGET_KM = 2.5;
const LONG_LEG_HARD_KM = 4;
const IMPOSSIBLE_SPEED_KMH = 65;
const MAX_FULL_DAY_LOAD_MIN = 600;
const MAX_BOUNDARY_DAY_LOAD_MIN = 510;
const MAX_NON_DAYTRIP_TRAVEL_MIN = 130;
const MAX_HEAVY_ACTIVITIES_PER_DAY = 2;
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
  const tripCuisineCounts = new Map<string, number>();
  let tripRestaurantCount = 0;
  const interCityTrip = isInterCityTrip(trip);

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
    const nonGooglePhotoRestaurants = restaurants.filter((restaurant) => hasNonGoogleRestaurantPhoto(restaurant));
    for (const restaurant of nonGooglePhotoRestaurants) {
      warnings.push(`Day ${day.dayNumber}: Restaurant "${restaurant.title}" has a non-Google photo source`);
      penalties += 3;
    }

    for (const restaurant of restaurants) {
      const cuisineFamily = inferRestaurantCuisineFamily(restaurant);
      if (cuisineFamily) {
        tripCuisineCounts.set(cuisineFamily, (tripCuisineCounts.get(cuisineFamily) || 0) + 1);
        tripRestaurantCount += 1;
      }
    }

    if (restaurants.length >= 2) {
      const dayCuisineCounts = new Map<string, number>();
      for (const restaurant of restaurants) {
        const family = inferRestaurantCuisineFamily(restaurant);
        if (!family) continue;
        dayCuisineCounts.set(family, (dayCuisineCounts.get(family) || 0) + 1);
      }
      const dominant = [...dayCuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (dominant && dominant[0] !== 'generic' && dominant[1] >= 2 && dominant[1] === restaurants.length) {
        warnings.push(
          `Day ${day.dayNumber}: Restaurant variety is low (${dominant[0]} repeated ${dominant[1]}x)`
        );
        penalties += 3;
      }
    }

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
        if (isIntentionalGapAnchor(prev) || isIntentionalGapAnchor(curr)) {
          continue;
        }
        warnings.push(`Day ${day.dayNumber}: ${gap}min gap between "${prev.title}" and "${curr.title}"`);
        penalties += 2;
      }
    }

    // 6b. Check for temporal overlaps between consecutive items
    for (let i = 1; i < sortedItems.length; i++) {
      const prev = sortedItems[i - 1];
      const curr = sortedItems[i];
      const prevEnd = timeToMinutes(prev.endTime);
      const currStart = timeToMinutes(curr.startTime);
      if (prevEnd > currStart) {
        const overlapMin = prevEnd - currStart;
        warnings.push(
          `Day ${day.dayNumber}: ${overlapMin}min overlap between "${prev.title}" and "${curr.title}"`
        );
        penalties += Math.min(10, overlapMin);
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
    const totalLegKm = legMetrics.reduce((sum, leg) => sum + leg.distanceKm, 0);
    const maxLegKm = distances.length > 0 ? distances[distances.length - 1] : 0;
    const p95LegKm = distances.length > 0 ? percentile(distances, 0.95) : 0;
    const totalTravelMin = legMetrics.reduce((sum, leg) => sum + leg.travelMin, 0);
    const routePoints = computeRoutePoints(day);
    const zigzagTurns = computeZigzagTurns(routePoints);
    const mstLowerBoundKm = computeMstLowerBoundKm(routePoints);
    const routeInefficiencyRatio = mstLowerBoundKm > 0.05
      ? totalLegKm / mstLowerBoundKm
      : 1;

    day.geoDiagnostics = {
      maxLegKm: round2(maxLegKm),
      p95LegKm: round2(p95LegKm),
      totalTravelMin: Math.round(totalTravelMin),
      totalLegKm: round2(totalLegKm),
      zigzagTurns,
      routeInefficiencyRatio: round2(routeInefficiencyRatio),
      mstLowerBoundKm: round2(mstLowerBoundKm),
    };

    const routeIsNonTrivial =
      routePoints.length >= 4
      && totalLegKm > 1.5
      && mstLowerBoundKm > 0.5;
    if (!day.isDayTrip && zigzagTurns >= 2) {
      warnings.push(
        `Day ${day.dayNumber}: zigzag route detected (${zigzagTurns} turnbacks)`
      );
      penalties += 4;
    }
    if (!day.isDayTrip && routeIsNonTrivial && routeInefficiencyRatio > 1.75) {
      warnings.push(
        `Day ${day.dayNumber}: route inefficiency is high (${routeInefficiencyRatio.toFixed(2)}x vs MST lower bound)`
      );
      penalties += 3;
    }

    const isBoundaryDay = day.dayNumber === 1 || day.dayNumber === trip.days.length;
    const heavyActivities = activities.filter((item) => (item.duration || 60) >= 120).length;
    if (!day.isDayTrip && heavyActivities > MAX_HEAVY_ACTIVITIES_PER_DAY) {
      warnings.push(
        `Day ${day.dayNumber}: ${heavyActivities} long activities scheduled (fatigue risk)`
      );
      penalties += (heavyActivities - MAX_HEAVY_ACTIVITIES_PER_DAY) * 3;
    }

    const activityMinutes = activities.reduce((sum, item) => sum + (item.duration || 60), 0);
    const mealMinutes = restaurants.reduce((sum, item) => sum + Math.max(30, item.duration || 60), 0);
    const dayLoadMinutes = activityMinutes + mealMinutes + totalTravelMin;
    const maxLoad = isBoundaryDay ? MAX_BOUNDARY_DAY_LOAD_MIN : MAX_FULL_DAY_LOAD_MIN;
    const mustSeeMinutes = activities.reduce((sum, item) => {
      const isMustSee = Boolean((item as TripItem & { data?: { mustSee?: boolean } }).data?.mustSee);
      return sum + (isMustSee ? (item.duration || 60) : 0);
    }, 0);
    const adaptiveMustSeeAllowance = Math.min(60, Math.max(0, mustSeeMinutes - 180) * 0.2);
    const fatigueThreshold = maxLoad + adaptiveMustSeeAllowance;
    if (!day.isDayTrip && dayLoadMinutes > fatigueThreshold) {
      warnings.push(
        `Day ${day.dayNumber}: day load is high (${Math.round(dayLoadMinutes)}min planned incl. travel)`
      );
      penalties += 4;
    }

    if (!day.isDayTrip && totalTravelMin > MAX_NON_DAYTRIP_TRAVEL_MIN) {
      warnings.push(
        `Day ${day.dayNumber}: too much travel time (${Math.round(totalTravelMin)}min)`
      );
      penalties += 3;
    }

    const firstActivityStart = activities.length > 0
      ? Math.min(...activities.map((item) => timeToMinutes(item.startTime)))
      : null;
    if (!day.isDayTrip && !isBoundaryDay && activities.length >= 3 && firstActivityStart !== null && firstActivityStart > 9 * 60 + 30) {
      warnings.push(
        `Day ${day.dayNumber}: first activity starts late (${minutesToTime(firstActivityStart)})`
      );
      penalties += 2;
    }

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

  if (interCityTrip) {
    ensureInterCityLonghaulCoverage(trip, warnings, autoFixes, (penalty) => {
      penalties += penalty;
    });
  }

  if (tripRestaurantCount >= 5) {
    const dominantTripCuisine = [...tripCuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dominantTripCuisine && dominantTripCuisine[0] !== 'generic' && dominantTripCuisine[1] / tripRestaurantCount >= 0.7) {
      warnings.push(
        `Trip-wide restaurant variety is limited (${dominantTripCuisine[0]} = ${dominantTripCuisine[1]}/${tripRestaurantCount})`
      );
      penalties += 4;
    }
  }

  // 10. Check hotel distance from activities centroid (city-profile aware caps)
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
      const profile = resolveQualityCityProfile({ destination: trip.preferences.destination });
      const hotelHardCap = getHotelHardCapKmForProfile(profile, trip.preferences.durationDays);
      if (hotelDist > hotelHardCap) {
        warnings.push(
          `Hotel "${hotelItem.title}" is ${hotelDist.toFixed(1)}km from activities centroid (cap=${hotelHardCap.toFixed(1)}km, profile=${profile.id})`
        );
        penalties += 5;
      }
    }
  }

  // ============================================
  // Fix themes and narratives to match actual items
  // ============================================
  for (const day of trip.days) {
    const actualActivities = day.items.filter(i => i.type === 'activity');
    const actualActivityNames = actualActivities.map(i => i.title);

    // 1. Fix dayNarrative activity count
    if (day.dayNarrative) {
      const countMatch = day.dayNarrative.match(/(\d+)\s+activités?\s+prévues?/);
      if (countMatch) {
        const claimedCount = parseInt(countMatch[1]);
        if (claimedCount !== actualActivities.length) {
          if (actualActivities.length === 0) {
            day.dayNarrative = '';
            autoFixes.push(`Day ${day.dayNumber}: Cleared narrative (no activities)`);
          } else {
            day.dayNarrative = day.dayNarrative.replace(
              /\d+\s+activités?\s+prévues?/,
              `${actualActivities.length} activité${actualActivities.length > 1 ? 's' : ''} prévue${actualActivities.length > 1 ? 's' : ''}`
            );
            autoFixes.push(`Day ${day.dayNumber}: Fixed activity count in narrative (${claimedCount} → ${actualActivities.length})`);
          }
        }
      }
    }

    // 2. Regenerate theme from ACTUAL activities if current theme mentions non-existent ones
    if (day.theme && actualActivities.length > 0) {
      // Check if theme words match any actual activity
      const themeLower = day.theme.toLowerCase();
      const anyMatch = actualActivityNames.some(name => {
        // Check if any significant word from the activity name appears in the theme
        const words = name.toLowerCase().split(/[\s,'-]+/).filter(w => w.length > 3);
        return words.some(word => themeLower.includes(word));
      });

      if (!anyMatch) {
        // Theme mentions activities not in the schedule → regenerate
        const oldTheme = day.theme;
        const topActivities = actualActivities.slice(0, 2).map(a => a.title);
        day.theme = topActivities.join(' et ');
        autoFixes.push(`Day ${day.dayNumber}: Regenerated theme (no match): "${oldTheme}" → "${day.theme}"`);
      }
    } else if (!day.theme || actualActivities.length === 0) {
      // No activities → generic theme
      const restaurants = day.items.filter(i => i.type === 'restaurant');
      const hasTransport = day.items.some(i => i.type === 'transport' && i.transportRole === 'longhaul');
      if (hasTransport && day.dayNumber === 1) {
        day.theme = 'Arrivée et installation';
      } else if (hasTransport) {
        day.theme = 'Retour';
      } else if (restaurants.length > 0) {
        day.theme = 'Découverte gastronomique';
      }
    }

    // 3. Regenerate dayNarrative if it mentions specific attraction names not in the trip
    if (day.dayNarrative && actualActivities.length > 0) {
      // Check for well-known attraction names that might be hallucinated
      const knownAttractions = [
        'Louvre', 'Orangerie', 'Orsay', 'Versailles', 'Colosseum', 'Vatican',
        'Sagrada', 'Buckingham', 'Big Ben', 'Rialto', 'Duomo', 'Eiffel',
        'Acropolis', 'Parthenon', 'Prado', 'Reina Sofia', 'Alhambra',
      ];
      const narrativeLower = day.dayNarrative.toLowerCase();
      const mentionedButMissing = knownAttractions.filter(attr => {
        const mentioned = narrativeLower.includes(attr.toLowerCase());
        const inTrip = actualActivityNames.some(n => n.toLowerCase().includes(attr.toLowerCase()));
        return mentioned && !inTrip;
      });

      if (mentionedButMissing.length > 0) {
        // Rebuild narrative from scratch
        const actNames = actualActivities.map(a => a.title).join(', ');
        const oldNarrative = day.dayNarrative;
        day.dayNarrative = `Journée consacrée à ${actNames}. ${actualActivities.length} activité${actualActivities.length > 1 ? 's' : ''} prévue${actualActivities.length > 1 ? 's' : ''}.`;
        autoFixes.push(`Day ${day.dayNumber}: Rebuilt narrative (hallucinated: ${mentionedButMissing.join(', ')})`);
        warnings.push(`Day ${day.dayNumber}: Narrative mentioned non-existent attractions: ${mentionedButMissing.join(', ')}`);
        penalties += 2;
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

function computeRoutePoints(day: TripDay): Array<{ latitude: number; longitude: number }> {
  return [...day.items]
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    .filter((item) => !isLogisticsItem(item) && !isHotelMeal(item))
    .filter((item) =>
      !!item.latitude
      && !!item.longitude
      && item.latitude !== 0
      && item.longitude !== 0
    )
    .map((item) => ({ latitude: item.latitude, longitude: item.longitude }));
}

function computeZigzagTurns(points: Array<{ latitude: number; longitude: number }>): number {
  if (points.length < 3) return 0;
  let turns = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const current = points[i];
    const next = points[i + 1];

    const v1x = current.longitude - prev.longitude;
    const v1y = current.latitude - prev.latitude;
    const v2x = next.longitude - current.longitude;
    const v2y = next.latitude - current.latitude;
    const norm1 = Math.hypot(v1x, v1y);
    const norm2 = Math.hypot(v2x, v2y);
    if (norm1 < 1e-6 || norm2 < 1e-6) continue;

    const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (norm1 * norm2)));
    const angleDeg = Math.acos(cosTheta) * (180 / Math.PI);
    if (angleDeg >= 115) turns += 1;
  }

  return turns;
}

function computeMstLowerBoundKm(points: Array<{ latitude: number; longitude: number }>): number {
  const n = points.length;
  if (n <= 1) return 0;

  const visited = new Array<boolean>(n).fill(false);
  const bestEdge = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  bestEdge[0] = 0;
  let total = 0;

  for (let step = 0; step < n; step++) {
    let u = -1;
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && bestEdge[i] < min) {
        min = bestEdge[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = true;
    total += min;

    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      const dist = calculateDistance(
        points[u].latitude,
        points[u].longitude,
        points[v].latitude,
        points[v].longitude
      );
      if (dist < bestEdge[v]) bestEdge[v] = dist;
    }
  }

  return total;
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

function isIntentionalGapAnchor(item: TripItem): boolean {
  if (item.type === 'free_time' || item.type === 'checkin' || item.type === 'checkout') {
    return true;
  }
  if (item.type === 'flight') {
    return true;
  }
  if (item.type === 'transport' && (
    item.transportRole === 'longhaul' ||
    item.transportRole === 'hotel_depart' ||
    item.transportRole === 'hotel_return'
  )) {
    return true;
  }
  return false;
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

function normalizePlaceName(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isInterCityTrip(trip: Trip): boolean {
  const origin = normalizePlaceName(trip.preferences.origin);
  const destination = normalizePlaceName(trip.preferences.destination);
  if (!origin || !destination) return false;
  return origin !== destination;
}

function isLonghaulItem(item: TripItem): boolean {
  if ((item.type === 'transport' || item.type === 'flight') && item.transportRole === 'longhaul') return true;
  if (item.id.startsWith('transport-out-') || item.id.startsWith('transport-ret-')) return true;
  if (item.id.startsWith('flight-out-') || item.id.startsWith('flight-ret-')) return true;
  return false;
}

function ensureInterCityLonghaulCoverage(
  trip: Trip,
  warnings: string[],
  autoFixes: string[],
  addPenalty: (penalty: number) => void
): void {
  const firstDay = trip.days[0];
  const lastDay = trip.days[trip.days.length - 1];
  if (!firstDay || !lastDay) return;

  const hasOutbound = firstDay.items.some((item) => isLonghaulItem(item));
  const hasReturn = lastDay.items.some((item) => isLonghaulItem(item));

  if (!hasOutbound) {
    warnings.push(`Day ${firstDay.dayNumber}: missing explicit inter-city outbound transport`);
    addPenalty(8);
    insertFallbackLonghaulItem(firstDay, 'outbound', trip.preferences.origin, trip.preferences.destination, {
      transport: resolveFallbackTransportOption(trip),
      groupSize: Math.max(1, trip.preferences.groupSize || 1),
      date: firstDay.date,
    });
    autoFixes.push(`Day ${firstDay.dayNumber}: inserted fallback outbound longhaul transport`);
  }

  if (!hasReturn) {
    warnings.push(`Day ${lastDay.dayNumber}: missing explicit inter-city return transport`);
    addPenalty(8);
    insertFallbackLonghaulItem(lastDay, 'return', trip.preferences.destination, trip.preferences.origin, {
      transport: resolveFallbackTransportOption(trip),
      groupSize: Math.max(1, trip.preferences.groupSize || 1),
      date: lastDay.date,
    });
    autoFixes.push(`Day ${lastDay.dayNumber}: inserted fallback return longhaul transport`);
  }
}

function resolveFallbackTransportOption(trip: Trip): Trip['selectedTransport'] | null {
  if (trip.selectedTransport) return trip.selectedTransport;
  if (!trip.transportOptions?.length) return null;
  return trip.transportOptions.find((option) => option.recommended) || trip.transportOptions[0] || null;
}

function normalizeFallbackBookingDate(rawUrl: string | undefined, date: Date): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const dateStr = formatDateForUrl(date);
    if (url.searchParams.has('departure_date')) {
      url.searchParams.set('departure_date', dateStr);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function insertFallbackLonghaulItem(
  day: TripDay,
  direction: 'outbound' | 'return',
  from: string,
  to: string,
  context: {
    transport: Trip['selectedTransport'] | null;
    groupSize: number;
    date: Date;
  }
): void {
  const sorted = [...day.items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const fallbackStartMinutes = direction === 'outbound'
    ? Math.max(6 * 60, (sorted[0] ? timeToMinutes(sorted[0].startTime) - 150 : 8 * 60))
    : Math.min(22 * 60, (sorted[sorted.length - 1] ? timeToMinutes(sorted[sorted.length - 1].endTime) + 30 : 15 * 60));
  const fallbackEndMinutes = Math.min(23 * 60 + 59, fallbackStartMinutes + 150);
  const fallbackIdPrefix = direction === 'outbound' ? 'transport-out' : 'transport-ret';
  const fallbackStartDate = new Date(context.date);
  const fallbackHour = Math.floor(fallbackStartMinutes / 60);
  const fallbackMinute = fallbackStartMinutes % 60;
  fallbackStartDate.setHours(fallbackHour, fallbackMinute, 0, 0);
  const fallbackDateStr = formatDateForUrl(fallbackStartDate);

  const qualityFlags = ['longhaul_fallback_injected'];
  let title = `Transport inter-ville ${direction === 'outbound' ? 'aller' : 'retour'}`;
  let bookingUrl: string | undefined;
  let aviasalesUrl: string | undefined;
  let omioFlightUrl: string | undefined;
  const estimatedCost = context.transport?.totalPrice || 0;

  if (context.transport?.mode === 'plane') {
    title = `✈️ Vol ${direction === 'outbound' ? 'aller' : 'retour'}`;
    aviasalesUrl = generateFlightLink(
      { origin: from, destination: to },
      { date: fallbackDateStr, passengers: context.groupSize }
    );

    const preferredBooking = direction === 'return'
      ? (context.transport.aviasalesUrl || aviasalesUrl)
      : (context.transport.bookingUrl || context.transport.aviasalesUrl || aviasalesUrl);
    bookingUrl = direction === 'return'
      ? normalizeFallbackBookingDate(preferredBooking, fallbackStartDate)
      : preferredBooking;
    omioFlightUrl = direction === 'return'
      ? normalizeFallbackBookingDate(
        context.transport.omioFlightUrl || generateFlightOmioLink(from, to, fallbackDateStr),
        fallbackStartDate
      )
      : (context.transport.omioFlightUrl || generateFlightOmioLink(from, to, fallbackDateStr));
    qualityFlags.push('plane_transport_fallback');
    if ((bookingUrl || aviasalesUrl || '').includes('aviasales.com')) {
      qualityFlags.push('aviasales_fallback_link');
    }
  } else {
    bookingUrl = direction === 'return'
      ? normalizeFallbackBookingDate(context.transport?.bookingUrl, fallbackStartDate)
      : context.transport?.bookingUrl;
  }

  const fallback: TripItem = {
    id: `${fallbackIdPrefix}-${day.dayNumber}-fallback`,
    dayNumber: day.dayNumber,
    startTime: minutesToTime(fallbackStartMinutes),
    endTime: minutesToTime(fallbackEndMinutes),
    type: 'transport',
    title,
    description: context.transport?.mode === 'plane'
      ? `${from} → ${to} (estimation, lien vols recommandé)`
      : `${from} → ${to} (estimation)`,
    locationName: `${from} → ${to}`,
    latitude: day.items[0]?.latitude || 0,
    longitude: day.items[0]?.longitude || 0,
    orderIndex: 0,
    duration: fallbackEndMinutes - fallbackStartMinutes,
    estimatedCost,
    bookingUrl,
    aviasalesUrl,
    omioFlightUrl,
    transportMode: 'transit',
    transportRole: 'longhaul',
    dataReliability: 'estimated',
    qualityFlags,
  };

  day.items.push(fallback);
  day.items = day.items
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    .map((item, index) => ({ ...item, orderIndex: index }));
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

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function isGoogleRestaurantPhoto(url?: string): boolean {
  if (!url) return false;
  return url.includes('/api/place-photo?') || url.includes('maps.googleapis.com/maps/api/place/photo');
}

function hasNonGoogleRestaurantPhoto(item: TripItem): boolean {
  if (item.type !== 'restaurant') return false;
  const photoCandidates = [
    item.imageUrl,
    ...(item.restaurant?.photos || []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (photoCandidates.length === 0) return false;
  return photoCandidates.some((photo) => !isGoogleRestaurantPhoto(photo));
}

function inferRestaurantCuisineFamily(item: TripItem): string | null {
  if (item.type !== 'restaurant') return null;
  const restaurant = item.restaurant;
  const text = [
    restaurant?.name || '',
    ...(restaurant?.cuisineTypes || []),
    restaurant?.description || '',
    item.title || '',
  ].join(' ').toLowerCase();

  const families: Array<{ key: string; keywords: string[] }> = [
    { key: 'french', keywords: ['français', 'french', 'brasserie', 'bistro'] },
    { key: 'italian', keywords: ['italien', 'italian', 'trattoria', 'pizzeria', 'osteria'] },
    { key: 'japanese', keywords: ['japonais', 'japanese', 'sushi', 'ramen', 'izakaya'] },
    { key: 'chinese', keywords: ['chinois', 'chinese', 'dim sum', 'szechuan'] },
    { key: 'indian', keywords: ['indien', 'indian', 'curry', 'tandoori'] },
    { key: 'thai', keywords: ['thai', 'thaï', 'thaïlandais'] },
    { key: 'mexican', keywords: ['mexicain', 'mexican', 'taco', 'taqueria'] },
    { key: 'middle-eastern', keywords: ['libanais', 'lebanese', 'mezze', 'shawarma'] },
    { key: 'bakery-cafe', keywords: ['boulangerie', 'bakery', 'café', 'coffee', 'brunch', 'salon de thé'] },
    { key: 'seafood', keywords: ['seafood', 'fruits de mer', 'poisson', 'fish'] },
  ];

  for (const family of families) {
    if (family.keywords.some((keyword) => text.includes(keyword))) {
      return family.key;
    }
  }

  return 'generic';
}
