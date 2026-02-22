/**
 * Pipeline V2 — Step 8: Post-Generation Quality Gate
 *
 * Scores the generated trip on 5 dimensions that reflect ACTUAL traveler experience:
 *   1. Complétude (25pts) — Does the trip have everything a traveler needs?
 *   2. Rythme (25pts) — Is the pacing comfortable and realistic?
 *   3. Géographie (25pts) — Are things walkable, routes logical?
 *   4. Données (15pts) — Are coordinates, URLs, images present?
 *   5. Cohérence (10pts) — No overlaps, duplicates, or hallucinations?
 *
 * Also applies auto-fixes (transport fallbacks, theme regeneration, dedup).
 * Non-blocking: logs warnings but never prevents trip delivery.
 */

import type { Trip, TripDay, TripItem } from '../types';
import { calculateDistance, getCityCenterCoords } from '../services/geocoding';
import { formatDateForUrl, generateFlightLink, generateFlightOmioLink } from '../services/linkGenerator';
import { getHotelHardCapKmForProfile, resolveQualityCityProfile, RESTAURANT_ABSOLUTE_MAX_KM } from './qualityPolicy';
import {
  buildTrainDescription,
  inferLonghaulDirectionFromItem,
  normalizeReturnTransportBookingUrl,
  rebaseTransitLegsToTimeline,
} from './utils/longhaulConsistency';
import { getCuisineFamilyFromItem } from './utils/cuisine';
import { nearestNonRestaurantDistKm } from './utils/restaurant-proximity';

const LOGISTICS_TYPES: TripItem['type'][] = ['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage'];

export interface ValidationResult {
  score: number; // 0-100 quality score
  warnings: string[];
  autoFixes: string[];
  breakdown?: ScoreBreakdown;
}

export interface ScoreBreakdown {
  completude: { score: number; max: 25; details: string[] };
  rythme: { score: number; max: 25; details: string[] };
  geo: { score: number; max: 25; details: string[] };
  donnees: { score: number; max: 15; details: string[] };
  coherence: { score: number; max: 10; details: string[] };
}

export function validateAndFixTrip(trip: Trip): ValidationResult {
  const warnings: string[] = [];
  const autoFixes: string[] = [];

  // ============================================
  // Phase 1: Auto-fixes (mutate trip before scoring)
  // ============================================
  applyAutoFixes(trip, warnings, autoFixes);

  // ============================================
  // Phase 2: Score across 5 dimensions
  // ============================================
  const completude = scoreCompletude(trip, warnings);
  const rythme = scoreRythme(trip, warnings);
  const geo = scoreGeo(trip, warnings);
  const donnees = scoreDonnees(trip, warnings);
  const coherence = scoreCoherence(trip, warnings);

  const score = completude.score + rythme.score + geo.score + donnees.score + coherence.score;

  const breakdown: ScoreBreakdown = { completude, rythme, geo, donnees, coherence };

  // ============================================
  // Logging
  // ============================================
  console.log(`[Pipeline V2] Step 8 Quality Gate: Score ${score}/100`);
  console.log(`  📦 Complétude: ${completude.score}/${completude.max}`);
  console.log(`  ⏱️  Rythme:     ${rythme.score}/${rythme.max}`);
  console.log(`  🗺️  Géo:        ${geo.score}/${geo.max}`);
  console.log(`  📊 Données:    ${donnees.score}/${donnees.max}`);
  console.log(`  🔗 Cohérence:  ${coherence.score}/${coherence.max}`);
  if (warnings.length > 0) {
    warnings.forEach(w => console.log(`  ⚠️ ${w}`));
  }
  if (autoFixes.length > 0) {
    autoFixes.forEach(f => console.log(`  🔧 ${f}`));
  }
  const qualityMetrics = buildQualityHardeningMetrics(trip, autoFixes);
  console.log(`[Pipeline V2] Quality hardening metrics: ${JSON.stringify(qualityMetrics)}`);

  return { score, warnings, autoFixes, breakdown };
}

function buildQualityHardeningMetrics(trip: Trip, autoFixes: string[]): {
  meal_label_autofix_count: number;
  longhaul_leg_rebased_count: number;
  narrative_hallucination_fix_count: number;
  longhaul_zero_coords_count: number;
} {
  let longhaulRebasedCount = 0;
  let longhaulZeroCoordsCount = 0;

  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'transport' || item.transportRole !== 'longhaul') continue;
      if (item.transitLegs?.length && item.transportTimeSource === 'rebased') {
        longhaulRebasedCount += 1;
      }
      if (Number(item.latitude) === 0 && Number(item.longitude) === 0) {
        longhaulZeroCoordsCount += 1;
      }
    }
  }

  const mealLabelAutofixCount = autoFixes.filter((fix) => fix.includes('mealType corrigé')).length;
  const narrativeHallucinationFixCount = autoFixes.filter((fix) => fix.toLowerCase().includes('narrative')).length;

  return {
    meal_label_autofix_count: mealLabelAutofixCount,
    longhaul_leg_rebased_count: longhaulRebasedCount,
    narrative_hallucination_fix_count: narrativeHallucinationFixCount,
    longhaul_zero_coords_count: longhaulZeroCoordsCount,
  };
}

function mealTypeFromStartMinutes(startMinutes: number): TripItem['mealType'] {
  if (startMinutes < 10 * 60 + 30) return 'breakfast';
  if (startMinutes < 18 * 60) return 'lunch';
  return 'dinner';
}

function mealLabelFromType(mealType: TripItem['mealType']): string {
  if (mealType === 'breakfast') return 'Petit-déjeuner';
  if (mealType === 'lunch') return 'Déjeuner';
  return 'Dîner';
}

function toDayDateTime(dayDate: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const date = new Date(dayDate);
  date.setHours(h || 0, m || 0, 0, 0);
  return date;
}

function normalizeMealSemantics(day: TripDay, autoFixes: string[]): void {
  const sorted = [...day.items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const seenMealSlots = new Set<TripItem['mealType']>();
  const kept: TripItem[] = [];

  for (const item of sorted) {
    if (item.type !== 'restaurant') {
      kept.push(item);
      continue;
    }

    const startMin = timeToMinutes(item.startTime);
    const mealType = mealTypeFromStartMinutes(startMin);
    const mealLabel = mealLabelFromType(mealType);
    const normalizedTitle = (item.title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const isHotelMeal = normalizedTitle.includes("a l'hotel") || normalizedTitle.includes('at hotel');
    const restaurantName = item.restaurant?.name
      || item.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner)\s*(—)?\s*/i, '').trim()
      || 'Restaurant local';
    const previousLabel = item.mealType || mealTypeFromStartMinutes(timeToMinutes(item.startTime));

    item.mealType = mealType;
    item.title = isHotelMeal ? `${mealLabel} à l'hôtel` : `${mealLabel} — ${restaurantName}`;
    if (item.description) {
      item.description = item.description.replace(/^(Petit-déjeuner|Déjeuner|Dîner)/, mealLabel);
    }

    if (previousLabel !== mealType) {
      autoFixes.push(`Jour ${day.dayNumber}: mealType corrigé (${previousLabel} -> ${mealType})`);
    }

    if (seenMealSlots.has(mealType)) {
      autoFixes.push(`Jour ${day.dayNumber}: doublon repas supprimé (${mealType})`);
      continue;
    }
    seenMealSlots.add(mealType);
    kept.push(item);
  }

  day.items = kept.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  day.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

function enforceLonghaulConsistency(day: TripDay, autoFixes: string[]): void {
  for (const item of day.items) {
    if (item.type !== 'transport' || item.transportRole !== 'longhaul' || !item.transitLegs?.length) continue;

    const itemStart = toDayDateTime(day.date, item.startTime);
    let itemEnd = toDayDateTime(day.date, item.endTime);
    if (itemEnd.getTime() < itemStart.getTime()) {
      itemEnd = new Date(itemEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    const direction = inferLonghaulDirectionFromItem(item);
    item.transportDirection = direction;

    const rebased = rebaseTransitLegsToTimeline({
      transitLegs: item.transitLegs,
      startTime: itemStart,
      direction,
    });
    if (!rebased?.length) continue;

    const firstDep = new Date(rebased[0].departure);
    const lastArr = new Date(rebased[rebased.length - 1].arrival);
    const mismatchMinutes = Math.max(
      Math.abs(firstDep.getTime() - itemStart.getTime()) / 60000,
      Math.abs(lastArr.getTime() - itemEnd.getTime()) / 60000
    );

    let finalLegs = rebased;
    if (mismatchMinutes > 15) {
      finalLegs = rebaseTransitLegsToTimeline({
        transitLegs: item.transitLegs,
        startTime: itemStart,
        direction,
        windowEndTime: itemEnd,
        fitToWindow: true,
      }) || rebased;
      autoFixes.push(`Jour ${day.dayNumber}: transitLegs ${item.id} réalignés sur le créneau item`);
    }

    item.transitLegs = finalLegs;
    item.transportTimeSource = 'rebased';

    if (item.transportMode === 'train') {
      item.description = buildTrainDescription(
        direction === 'return' ? 'Train retour' : 'Train',
        finalLegs.map((leg) => leg.operator)
      );
    }

    if (direction === 'return') {
      item.bookingUrl = normalizeReturnTransportBookingUrl(item.bookingUrl, itemStart, { swapOmioDirection: true });
    }
  }
}

// ============================================
// 1. COMPLÉTUDE (25 pts)
// Does the trip have everything a traveler needs?
// ============================================
function scoreCompletude(
  trip: Trip,
  warnings: string[]
): { score: number; max: 25; details: string[] } {
  let score = 0;
  const details: string[] = [];
  const numDays = trip.days.length;
  const interCity = isInterCityTrip(trip);

  // 1a. Activities: every day should have at least some (5 pts)
  // Full days: 3+ activities = 1pt, boundary days: 1+ = 1pt
  let activityPoints = 0;
  for (const day of trip.days) {
    const isBoundary = day.dayNumber === 1 || day.dayNumber === numDays;
    const activities = day.items.filter(i => i.type === 'activity');
    const hasTravelDay = day.items.some(i => i.type === 'flight' || (i.type === 'transport' && i.transportRole === 'longhaul'));
    if (isBoundary || hasTravelDay) {
      if (activities.length >= 1) activityPoints += 1;
    } else {
      if (activities.length >= 3) activityPoints += 1;
      else if (activities.length >= 1) activityPoints += 0.5;
    }
  }
  const actScore = Math.round(Math.min(5, (activityPoints / numDays) * 5));
  score += actScore;
  details.push(`Activités: ${actScore}/5`);

  // 1b. Meals: every full day should have 3 meals, boundary days at least 1 (7 pts)
  // NOTE: Hotel breakfast counts as a valid meal for completeness — traveler does eat breakfast.
  // (But hotel meals are still excluded from meal timing scoring since they have no restaurant data)
  let mealPoints = 0;
  for (const day of trip.days) {
    const isBoundary = day.dayNumber === 1 || day.dayNumber === numDays;
    const restaurants = day.items.filter(i => i.type === 'restaurant');
    if (isBoundary) {
      if (restaurants.length >= 1) mealPoints += 1;
    } else {
      if (restaurants.length >= 3) mealPoints += 1;
      else if (restaurants.length >= 2) mealPoints += 0.7;
      else if (restaurants.length >= 1) mealPoints += 0.3;
      else {
        warnings.push(`Jour ${day.dayNumber}: aucun restaurant prévu`);
      }
    }
  }
  const mealScore = Math.round(Math.min(7, (mealPoints / numDays) * 7));
  score += mealScore;
  details.push(`Repas: ${mealScore}/7`);

  // 1c. Hotel check-in/out present (3 pts)
  const hasCheckin = trip.days[0]?.items.some(i => i.type === 'checkin');
  const hasCheckout = trip.days[numDays - 1]?.items.some(i => i.type === 'checkout');
  const hotelScore = (hasCheckin ? 1.5 : 0) + (hasCheckout ? 1.5 : 0);
  score += hotelScore;
  details.push(`Hôtel: ${hotelScore}/3`);
  if (!hasCheckin) warnings.push('Jour 1: pas de check-in hôtel');
  if (!hasCheckout) warnings.push(`Jour ${numDays}: pas de check-out hôtel`);

  // 1d. Inter-city transport present (5 pts, only for inter-city trips)
  if (interCity) {
    const hasOutbound = trip.days[0]?.items.some(i => isLonghaulItem(i));
    const hasReturn = trip.days[numDays - 1]?.items.some(i => isLonghaulItem(i));
    const transportScore = (hasOutbound ? 2.5 : 0) + (hasReturn ? 2.5 : 0);
    score += transportScore;
    details.push(`Transport inter-ville: ${transportScore}/5`);
  } else {
    score += 5;
    details.push(`Transport inter-ville: 5/5 (local trip)`);
  }

  // 1e. Cuisine diversity across the trip (5 pts)
  const cuisineFamilies = new Set<string>();
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'restaurant') {
        const family = getCuisineFamilyFromItem(item);
        if (family !== 'generic') cuisineFamilies.add(family);
      }
    }
  }
  // 3+ distinct cuisine families = full marks, 2 = 3pts, 1 = 1pt, 0 = 0pts
  const diversityScore = cuisineFamilies.size >= 3 ? 5 : cuisineFamilies.size === 2 ? 3 : cuisineFamilies.size === 1 ? 1 : 0;
  score += diversityScore;
  details.push(`Diversité cuisine: ${diversityScore}/5 (${cuisineFamilies.size} familles)`);

  return { score: Math.round(score), max: 25, details };
}

// ============================================
// 2. RYTHME (25 pts)
// Is the pacing comfortable for a real traveler?
// ============================================
function scoreRythme(
  trip: Trip,
  warnings: string[]
): { score: number; max: 25; details: string[] } {
  let score = 0;
  const details: string[] = [];
  const numDays = trip.days.length;

  // 2a. No temporal overlaps (8 pts — overlaps are deal-breakers)
  let overlapCount = 0;
  for (const day of trip.days) {
    const sorted = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = timeToMinutes(sorted[i - 1].endTime);
      const currStart = timeToMinutes(sorted[i].startTime);
      if (prevEnd > currStart) {
        overlapCount++;
        warnings.push(`Jour ${day.dayNumber}: chevauchement ${sorted[i - 1].title} / ${sorted[i].title}`);
      }
    }
  }
  const overlapScore = overlapCount === 0 ? 8 : Math.max(0, 8 - overlapCount * 3);
  score += overlapScore;
  details.push(`Pas de chevauchements: ${overlapScore}/8`);

  // 2b. Meal timing is realistic (7 pts)
  // Breakfast 7:00-9:30, lunch 11:30-14:00, dinner 18:30-21:30
  let goodMealTiming = 0;
  let totalMeals = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'restaurant' || isHotelMeal(item)) continue;
      totalMeals++;
      const start = timeToMinutes(item.startTime);
      const title = item.title || '';
      const mealType: TripItem['mealType'] =
        item.mealType
        || (title.includes('Petit-déjeuner') ? 'breakfast' : title.includes('Déjeuner') ? 'lunch' : title.includes('Dîner') ? 'dinner' : mealTypeFromStartMinutes(start));
      if (mealType === 'breakfast') {
        // Breakfast: 7:00-9:30
        if (start >= 420 && start <= 570) goodMealTiming++;
        else warnings.push(`Jour ${day.dayNumber}: petit-déjeuner à ${item.startTime} (inhabituel)`);
      } else if (mealType === 'lunch') {
        // Lunch: 11:30-16:00 (includes late lunches that slipped past 15:00)
        if (start >= 690 && start <= 960) goodMealTiming++;
        else warnings.push(`Jour ${day.dayNumber}: déjeuner à ${item.startTime} (inhabituel)`);
      } else {
        // Dinner: 18:30-21:30
        if (start >= 1110 && start <= 1290) goodMealTiming++;
        else warnings.push(`Jour ${day.dayNumber}: dîner à ${item.startTime} (inhabituel)`);
      }
    }
  }
  const mealTimingScore = totalMeals > 0
    ? Math.round((goodMealTiming / totalMeals) * 7)
    : 0;
  score += mealTimingScore;
  details.push(`Timing repas: ${mealTimingScore}/7`);

  // 2c. Day load balance — not too packed, not too empty (5 pts)
  // Ideal: 4-6 activities+meals per full day
  let balancePoints = 0;
  for (const day of trip.days) {
    const isBoundary = day.dayNumber === 1 || day.dayNumber === numDays;
    const meaningful = day.items.filter(i => i.type === 'activity' || i.type === 'restaurant').length;
    if (isBoundary) {
      // Boundary: 2-5 items is fine
      if (meaningful >= 2 && meaningful <= 5) balancePoints += 1;
      else if (meaningful >= 1) balancePoints += 0.5;
    } else {
      // Full day: 5-8 items ideal (3 meals + 3-5 activities)
      if (meaningful >= 5 && meaningful <= 8) balancePoints += 1;
      else if (meaningful >= 3 && meaningful <= 10) balancePoints += 0.5;
      else {
        warnings.push(`Jour ${day.dayNumber}: ${meaningful} items (trop ${meaningful < 3 ? 'peu' : 'chargé'})`);
      }
    }
  }
  const balanceScore = Math.round(Math.min(5, (balancePoints / numDays) * 5));
  score += balanceScore;
  details.push(`Équilibre journées: ${balanceScore}/5`);

  // 2d. No massive dead time during the day (5 pts)
  // Gaps between activities during active hours penalized on a sliding scale.
  // Reasonable gap ≤ 90min (walking, rest, coffee) — no penalty.
  // 90-120min = mild penalty, 120-180min = medium, >180min = severe.
  // Skip gap penalty on day-trip days (transport takes time, gaps are normal).
  let gapPenaltyPts = 0;
  for (const day of trip.days) {
    const sorted = [...day.items]
      .filter(i => (!isLogisticsItem(i) || i.type === 'checkin' || i.type === 'checkout') && !isHotelMeal(i))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevEnd = timeToMinutes(prev.endTime);
      const currStart = timeToMinutes(curr.startTime);
      const gap = currStart - prevEnd;

      // Gaps ≤ 90min are totally normal (walking, metro, coffee break)
      if (gap <= 90) continue;

      // Gap just before dinner (prev ends after 17:30 AND curr is dinner) is free time
      const isDinnerGap = curr.type === 'restaurant'
        && (curr.mealType === 'dinner' || currStart >= 1140) // dinner or starts after 19:00
        && prevEnd >= 1050; // prev ends after 17:30
      if (isDinnerGap && gap <= 150) continue; // max 2.5h free time before dinner

      // Gap before longhaul departure on last day: allow up to 2h buffer
      const isLastDayDeparture = day.dayNumber === trip.days.length
        && curr.type === 'transport'
        && (curr.transportRole === 'longhaul' || curr.transportRole === 'hotel_depart');
      if (isLastDayDeparture && gap <= 120) continue;

      // Flights always have buffer time — allow generous gap
      if (curr.type === 'flight' || prev.type === 'flight') continue;

      // Arrival day: gap after checkin is ok if ≤ 90min (already handled above)
      // But larger gaps after checkin still get penalized proportionally.
      // Free_time items always exempt their side of the gap
      if (prev.type === 'free_time' || curr.type === 'free_time') continue;

      // Sliding scale penalty
      if (gap > 180) {
        gapPenaltyPts += 2;
        warnings.push(`Jour ${day.dayNumber}: trou de ${gap}min entre ${prev.title} et ${curr.title}`);
      } else if (gap >= 120) {
        gapPenaltyPts += 1;
        warnings.push(`Jour ${day.dayNumber}: trou de ${gap}min entre ${prev.title} et ${curr.title}`);
      } else {
        // 90-119min: half penalty
        gapPenaltyPts += 0.5;
      }
    }
  }
  const gapScore = Math.max(0, 5 - gapPenaltyPts);
  score += gapScore;
  details.push(`Pas de temps mort: ${gapScore}/5`);

  return { score: Math.round(score), max: 25, details };
}

// ============================================
// 3. GÉOGRAPHIE (25 pts)
// Are things walkable and routes logical?
// ============================================
function scoreGeo(
  trip: Trip,
  warnings: string[]
): { score: number; max: 25; details: string[] } {
  let score = 0;
  const details: string[] = [];

  // Compute geo diagnostics for each day first
  for (const day of trip.days) {
    const legMetrics = computeLegMetrics(day);
    const distances = legMetrics.map(l => l.distanceKm).sort((a, b) => a - b);
    const totalLegKm = legMetrics.reduce((sum, l) => sum + l.distanceKm, 0);
    const maxLegKm = distances.length > 0 ? distances[distances.length - 1] : 0;
    const p95LegKm = distances.length > 0 ? percentile(distances, 0.95) : 0;
    const totalTravelMin = legMetrics.reduce((sum, l) => sum + l.travelMin, 0);
    const routePoints = computeRoutePoints(day);
    const zigzagTurns = computeZigzagTurns(routePoints);
    const mstLowerBoundKm = computeMstLowerBoundKm(routePoints);
    const routeInefficiencyRatio = mstLowerBoundKm > 0.05
      ? totalLegKm / mstLowerBoundKm : 1;

    day.geoDiagnostics = {
      maxLegKm: round2(maxLegKm),
      p95LegKm: round2(p95LegKm),
      totalTravelMin: Math.round(totalTravelMin),
      totalLegKm: round2(totalLegKm),
      zigzagTurns,
      routeInefficiencyRatio: round2(routeInefficiencyRatio),
      mstLowerBoundKm: round2(mstLowerBoundKm),
    };
  }

  // 3a. Restaurant proximity — lunch/dinner within profile thresholds (8 pts)
  const cityProfile = resolveQualityCityProfile({ destination: trip.preferences?.destination });
  const closeKm = cityProfile.restaurantCloseKm;
  const partialKm = cityProfile.restaurantPartialKm;
  let closeRestaurants = 0;
  let totalLunchDinners = 0;
  for (const day of trip.days) {
    const sorted = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      if (item.type !== 'restaurant' || isHotelMeal(item)) continue;
      const mealType = item.mealType || mealTypeFromStartMinutes(timeToMinutes(item.startTime));
      if (mealType === 'breakfast') continue; // breakfast anchored to hotel
      totalLunchDinners++;

      const minDist = nearestNonRestaurantDistKm(item, sorted, i, trip.accommodation);
      if (minDist <= closeKm) closeRestaurants++;
      else if (minDist <= partialKm) closeRestaurants += 0.5;
      else {
        warnings.push(`Jour ${day.dayNumber}: ${item.title} est à ${(minDist * 1000).toFixed(0)}m de l'activité la plus proche`);
      }
    }
  }
  const restoProxScore = totalLunchDinners > 0
    ? Math.round((closeRestaurants / totalLunchDinners) * 8)
    : 8;
  score += restoProxScore;
  details.push(`Proximité restaurants: ${restoProxScore}/8`);

  // 3b. No impossible transitions — can't teleport (7 pts)
  // Skip day-trip days (transport legs are intentional long-distance moves)
  let impossibleCount = 0;
  for (const day of trip.days) {
    if (day.isDayTrip) continue;
    const legMetrics = computeLegMetrics(day);
    for (const leg of legMetrics) {
      const speedKmh = leg.travelMin > 0 ? (leg.distanceKm / leg.travelMin) * 60 : 0;
      const impossibleByGap = leg.distanceKm > 4 && leg.gapMin >= 0 && leg.gapMin < 15;
      const impossibleBySpeed = leg.distanceKm > 1.5 && speedKmh > 65;
      if (impossibleByGap || impossibleBySpeed) {
        impossibleCount++;
        warnings.push(`Jour ${day.dayNumber}: transition impossible ${leg.fromTitle} → ${leg.toTitle} (${leg.distanceKm.toFixed(1)}km en ${leg.gapMin}min)`);
      }
    }
  }
  const impossibleScore = impossibleCount === 0 ? 7 : Math.max(0, 7 - impossibleCount * 3);
  score += impossibleScore;
  details.push(`Transitions réalistes: ${impossibleScore}/7`);

  // 3c. Average walk distance between consecutive items (5 pts)
  // Ideal: < 1km average leg. Acceptable: < 2km. Bad: > 3km
  // Exclude excursion legs (> 10km) — these are intentional day trips
  // (e.g., Golden Circle from Reykjavik, temple excursions in Bali) that use
  // car/bus transport and should not penalize the walkability average.
  const EXCURSION_THRESHOLD_KM = 10;
  const allLegs: number[] = [];
  for (const day of trip.days) {
    if (day.isDayTrip) continue; // Exclude day-trip days from walk distance average
    const legMetrics = computeLegMetrics(day);
    allLegs.push(...legMetrics.map(l => l.distanceKm));
  }
  const walkableLegs = allLegs.filter(d => d <= EXCURSION_THRESHOLD_KM);
  const excursionLegsCount = allLegs.length - walkableLegs.length;
  const avgLeg = walkableLegs.length > 0 ? walkableLegs.reduce((a, b) => a + b, 0) / walkableLegs.length : 0;
  let walkScore: number;
  if (avgLeg <= 0.8) walkScore = 5;
  else if (avgLeg <= 1.2) walkScore = 4;
  else if (avgLeg <= 1.8) walkScore = 3;
  else if (avgLeg <= 2.5) walkScore = 2;
  else { walkScore = 1; warnings.push(`Distance moyenne entre items: ${avgLeg.toFixed(1)}km (élevée)`); }
  score += walkScore;
  const excursionNote = excursionLegsCount > 0 ? `, ${excursionLegsCount} excursions exclues` : '';
  details.push(`Distance marche moy: ${walkScore}/5 (${avgLeg.toFixed(1)}km${excursionNote})`);

  // 3d. Hotel position — within reasonable distance of activities (5 pts)
  // Exclude excursion outliers (> 10km from centroid) when computing the centroid.
  // For destinations with day trips (Reykjavik→Golden Circle, Bali→distant temples),
  // the centroid gets pulled far from the city, making a well-placed hotel look distant.
  const allActivityCoords = trip.days.flatMap(d =>
    d.items.filter(i => i.type === 'activity' && i.latitude && i.longitude && i.latitude !== 0)
  );
  const hotelItem = trip.days[0]?.items.find(i => i.type === 'checkin');
  let hotelScore = 0;
  if (hotelItem && hotelItem.latitude && allActivityCoords.length > 0) {
    const OUTLIER_THRESHOLD_KM = 10;
    const rawCentroid = {
      lat: allActivityCoords.reduce((s, a) => s + a.latitude, 0) / allActivityCoords.length,
      lng: allActivityCoords.reduce((s, a) => s + a.longitude, 0) / allActivityCoords.length,
    };
    const urbanActivities = allActivityCoords.filter(a =>
      calculateDistance(rawCentroid.lat, rawCentroid.lng, a.latitude, a.longitude) <= OUTLIER_THRESHOLD_KM
    );
    const centroidSource = urbanActivities.length > 0 ? urbanActivities : allActivityCoords;
    const centroid = {
      lat: centroidSource.reduce((s, a) => s + a.latitude, 0) / centroidSource.length,
      lng: centroidSource.reduce((s, a) => s + a.longitude, 0) / centroidSource.length,
    };

    const hotelDist = calculateDistance(centroid.lat, centroid.lng, hotelItem.latitude, hotelItem.longitude);
    if (hotelDist <= 1.5) hotelScore = 5;
    else if (hotelDist <= 2.5) hotelScore = 4;
    else if (hotelDist <= 4.0) hotelScore = 3;
    else { hotelScore = 1; warnings.push(`Hôtel à ${hotelDist.toFixed(1)}km du centre des activités`); }
  } else {
    hotelScore = 3; // Can't verify
  }
  score += hotelScore;
  details.push(`Position hôtel: ${hotelScore}/5`);

  return { score: Math.round(score), max: 25, details };
}

// ============================================
// 4. DONNÉES (15 pts)
// Is the data reliable and complete?
// ============================================
function scoreDonnees(
  trip: Trip,
  warnings: string[]
): { score: number; max: 15; details: string[] } {
  let score = 0;
  const details: string[] = [];

  // 4a. All activities/restaurants have valid coordinates (5 pts)
  let totalGeoItems = 0;
  let validGeoItems = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'activity' || item.type === 'restaurant') {
        totalGeoItems++;
        if (item.latitude && item.longitude && item.latitude !== 0 && item.longitude !== 0) {
          validGeoItems++;
        } else {
          warnings.push(`Jour ${day.dayNumber}: "${item.title}" n'a pas de coordonnées GPS`);
        }
      }
    }
  }
  const coordScore = totalGeoItems > 0 ? Math.round((validGeoItems / totalGeoItems) * 5) : 0;
  score += coordScore;
  details.push(`Coordonnées GPS: ${coordScore}/5 (${validGeoItems}/${totalGeoItems})`);

  // 4b. Activities have images (4 pts)
  let totalActivities = 0;
  let activitiesWithImages = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        totalActivities++;
        if (item.imageUrl) activitiesWithImages++;
      }
    }
  }
  const imageScore = totalActivities > 0
    ? Math.round((activitiesWithImages / totalActivities) * 4)
    : 0;
  score += imageScore;
  details.push(`Images activités: ${imageScore}/4 (${activitiesWithImages}/${totalActivities})`);

  // 4c. Restaurants have real data (not placeholder) (3 pts)
  let totalRestos = 0;
  let restosWithData = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'restaurant') {
        totalRestos++;
        if (item.restaurant && item.restaurant.name) restosWithData++;
      }
    }
  }
  const restoDataScore = totalRestos > 0 ? Math.round((restosWithData / totalRestos) * 3) : 0;
  score += restoDataScore;
  details.push(`Données restaurants: ${restoDataScore}/3 (${restosWithData}/${totalRestos})`);

  // 4d. Activities have Google Maps URL (3 pts)
  let activitiesWithMaps = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'activity' && item.googleMapsUrl) activitiesWithMaps++;
    }
  }
  const mapsScore = totalActivities > 0
    ? Math.round((activitiesWithMaps / totalActivities) * 3)
    : 0;
  score += mapsScore;
  details.push(`Google Maps URLs: ${mapsScore}/3 (${activitiesWithMaps}/${totalActivities})`);

  return { score: Math.round(score), max: 15, details };
}

// ============================================
// 5. COHÉRENCE (10 pts)
// Is the itinerary internally consistent?
// ============================================
function scoreCoherence(
  trip: Trip,
  warnings: string[]
): { score: number; max: 10; details: string[] } {
  let score = 0;
  const details: string[] = [];

  // 5a. No duplicate activities across the trip (3 pts)
  const activityIds = new Set<string>();
  let dupeActivities = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        // Use title as dedup key since IDs might differ
        const key = (item.title || '').toLowerCase().trim();
        if (activityIds.has(key)) {
          dupeActivities++;
          warnings.push(`Jour ${day.dayNumber}: activité en double "${item.title}"`);
        }
        activityIds.add(key);
      }
    }
  }
  const dupeActScore = dupeActivities === 0 ? 3 : Math.max(0, 3 - dupeActivities);
  score += dupeActScore;
  details.push(`Pas de doublons activités: ${dupeActScore}/3`);

  // 5b. No duplicate restaurants (same name + same meal) within same day (3 pts)
  let dupeRestos = 0;
  for (const day of trip.days) {
    const seen = new Set<string>();
    for (const item of day.items) {
      if (item.type === 'restaurant') {
        const cleanName = (item.title || '').replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, '').toLowerCase().trim();
        const mealType = item.mealType || mealTypeFromStartMinutes(timeToMinutes(item.startTime));
        const key = `${cleanName}-${mealType}`;
        if (seen.has(key)) {
          dupeRestos++;
          warnings.push(`Jour ${day.dayNumber}: restaurant en double "${item.title}"`);
        }
        seen.add(key);
      }
    }
  }
  const dupeRestoScore = dupeRestos === 0 ? 3 : Math.max(0, 3 - dupeRestos);
  score += dupeRestoScore;
  details.push(`Pas de doublons restaurants: ${dupeRestoScore}/3`);

  // 5c. Days are in order and complete (2 pts)
  let orderOk = true;
  for (let i = 0; i < trip.days.length; i++) {
    if (trip.days[i].dayNumber !== i + 1) orderOk = false;
  }
  const expectedDays = trip.preferences?.durationDays || trip.days.length;
  const daysComplete = trip.days.length === expectedDays;
  const orderScore = (orderOk ? 1 : 0) + (daysComplete ? 1 : 0);
  score += orderScore;
  details.push(`Structure jours: ${orderScore}/2`);

  // 5d. Themes are present and relevant (2 pts)
  let daysWithTheme = 0;
  for (const day of trip.days) {
    if (day.theme && day.theme.length > 3) daysWithTheme++;
  }
  const themeScore = trip.days.length > 0
    ? Math.round((daysWithTheme / trip.days.length) * 2)
    : 0;
  score += themeScore;
  details.push(`Thèmes: ${themeScore}/2 (${daysWithTheme}/${trip.days.length})`);

  return { score: Math.round(score), max: 10, details };
}

// ============================================
// AUTO-FIXES (applied before scoring)
// ============================================
function applyAutoFixes(trip: Trip, warnings: string[], autoFixes: string[]): void {
  const interCity = isInterCityTrip(trip);

  // Fix 1: Canonicalize meal semantics + remove duplicates within the same meal slot
  for (const day of trip.days) {
    normalizeMealSemantics(day, autoFixes);
    enforceLonghaulConsistency(day, autoFixes);

    const seenRestoNames = new Set<string>();
    const itemsToRemove: number[] = [];
    day.items.forEach((item, idx) => {
      if (item.type === 'restaurant') {
        const cleanName = item.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, '');
        const mealType = item.mealType || mealTypeFromStartMinutes(timeToMinutes(item.startTime));
        const key = `${cleanName}-${mealType}`;
        if (seenRestoNames.has(key)) {
          itemsToRemove.push(idx);
          autoFixes.push(`Jour ${day.dayNumber}: doublon supprimé "${item.title}"`);
        } else {
          seenRestoNames.add(key);
        }
      }
    });
    for (const idx of itemsToRemove.reverse()) {
      day.items.splice(idx, 1);
    }
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  // Fix 2: Ensure inter-city transport
  if (interCity) {
    ensureInterCityLonghaulCoverage(trip, warnings, autoFixes);
  }

  // Fix 3: Fix themes and narratives
  fixThemesAndNarratives(trip, autoFixes, warnings);
}

function fixThemesAndNarratives(trip: Trip, autoFixes: string[], warnings: string[]): void {
  const lastDayNumber = trip.days[trip.days.length - 1]?.dayNumber || 0;

  for (const day of trip.days) {
    const actualActivities = day.items.filter(i => i.type === 'activity');
    const actualActivityNames = actualActivities.map(i => i.title);
    const hasLonghaul = day.items.some((item) => item.type === 'transport' && item.transportRole === 'longhaul');
    const isReturnDay = day.dayNumber === lastDayNumber && hasLonghaul;

    if (isReturnDay) {
      if (day.theme !== 'Retour') {
        const oldTheme = day.theme;
        day.theme = 'Retour';
        autoFixes.push(`Jour ${day.dayNumber}: thème forcé "${oldTheme || '∅'}" -> "Retour"`);
      }
      const returnNarrative = 'Journée de retour et logistique de départ.';
      if (day.dayNarrative !== returnNarrative) {
        day.dayNarrative = returnNarrative;
        autoFixes.push(`Jour ${day.dayNumber}: narrative logistique de retour appliquée`);
      }
      continue;
    }

    if (actualActivities.length === 0) {
      const restaurants = day.items.filter(i => i.type === 'restaurant');
      const isArrivalDay = hasLonghaul && day.dayNumber === 1;

      if (isArrivalDay) {
        day.theme = 'Arrivée et installation';
        day.dayNarrative = 'Journée logistique d’arrivée et installation.';
      } else if (hasLonghaul) {
        day.theme = 'Retour';
        day.dayNarrative = 'Journée logistique de départ.';
      } else if (restaurants.length > 0) {
        day.theme = day.theme || 'Découverte gastronomique';
        day.dayNarrative = 'Journée centrée sur les repas et la découverte locale.';
      } else {
        day.theme = day.theme || 'Journée libre';
        day.dayNarrative = 'Journée libre sans activité planifiée.';
      }
      autoFixes.push(`Jour ${day.dayNumber}: thème/narrative recalculés (aucune activité)`);
      continue;
    }

    // Fix narrative activity count
    if (day.dayNarrative) {
      const countMatch = day.dayNarrative.match(/(\d+)\s+activités?\s+prévues?/);
      if (countMatch) {
        const claimedCount = parseInt(countMatch[1]);
        if (claimedCount !== actualActivities.length) {
          if (actualActivities.length === 0) {
            day.dayNarrative = '';
            autoFixes.push(`Jour ${day.dayNumber}: narrative effacée (aucune activité)`);
          } else {
            day.dayNarrative = day.dayNarrative.replace(
              /\d+\s+activités?\s+prévues?/,
              `${actualActivities.length} activité${actualActivities.length > 1 ? 's' : ''} prévue${actualActivities.length > 1 ? 's' : ''}`
            );
            autoFixes.push(`Jour ${day.dayNumber}: compteur activités corrigé dans la narrative`);
          }
        }
      }
    }

    // Regenerate theme if it doesn't match actual activities
    if (day.theme && actualActivities.length > 0) {
      const themeLower = day.theme.toLowerCase();
      const anyMatch = actualActivityNames.some(name => {
        const words = name.toLowerCase().split(/[\s,'-]+/).filter(w => w.length > 3);
        return words.some(word => themeLower.includes(word));
      });
      if (!anyMatch) {
        const oldTheme = day.theme;
        const topActivities = actualActivities.slice(0, 2).map(a => a.title);
        day.theme = topActivities.join(' et ');
        autoFixes.push(`Jour ${day.dayNumber}: thème régénéré "${oldTheme}" → "${day.theme}"`);
      }
    } else if (!day.theme || actualActivities.length === 0) {
      const restaurants = day.items.filter(i => i.type === 'restaurant');
      const hasTransport = day.items.some(i => i.type === 'transport' && i.transportRole === 'longhaul');
      if (hasTransport && day.dayNumber === 1) day.theme = 'Arrivée et installation';
      else if (hasTransport) day.theme = 'Retour';
      else if (restaurants.length > 0) day.theme = 'Découverte gastronomique';
    }

    // Fix hallucinated narrative
    if (day.dayNarrative && actualActivities.length > 0) {
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
      const noActualMention = !actualActivityNames.some((name) => narrativeLower.includes(name.toLowerCase()));
      const suspiciousTemplate = /journee\s*\d+\s*:/i.test(day.dayNarrative) || day.dayNarrative.includes('&');

      if (mentionedButMissing.length > 0 || (noActualMention && suspiciousTemplate)) {
        const actNames = actualActivities.map(a => a.title).join(', ');
        day.dayNarrative = `Journée consacrée à ${actNames}. ${actualActivities.length} activité${actualActivities.length > 1 ? 's' : ''} prévue${actualActivities.length > 1 ? 's' : ''}.`;
        autoFixes.push(
          `Jour ${day.dayNumber}: narrative reconstruite (hallucination: ${mentionedButMissing.join(', ') || 'template incohérent'})`
        );
      }
    }
  }
}

// ============================================
// Inter-city transport coverage
// ============================================
function ensureInterCityLonghaulCoverage(
  trip: Trip,
  warnings: string[],
  autoFixes: string[]
): void {
  const firstDay = trip.days[0];
  const lastDay = trip.days[trip.days.length - 1];
  if (!firstDay || !lastDay) return;

  const hasOutbound = firstDay.items.some(item => isLonghaulItem(item));
  const hasReturn = lastDay.items.some(item => isLonghaulItem(item));

  if (!hasOutbound) {
    warnings.push(`Jour ${firstDay.dayNumber}: transport aller manquant`);
    insertFallbackLonghaulItem(firstDay, 'outbound', trip.preferences.origin, trip.preferences.destination, {
      transport: resolveFallbackTransportOption(trip),
      groupSize: Math.max(1, trip.preferences.groupSize || 1),
      date: firstDay.date,
    });
    autoFixes.push(`Jour ${firstDay.dayNumber}: transport aller inséré (fallback)`);
  }

  if (!hasReturn) {
    warnings.push(`Jour ${lastDay.dayNumber}: transport retour manquant`);
    insertFallbackLonghaulItem(lastDay, 'return', trip.preferences.destination, trip.preferences.origin, {
      transport: resolveFallbackTransportOption(trip),
      groupSize: Math.max(1, trip.preferences.groupSize || 1),
      date: lastDay.date,
    });
    autoFixes.push(`Jour ${lastDay.dayNumber}: transport retour inséré (fallback)`);
  }
}

// ============================================
// Helper functions (unchanged)
// ============================================

function computeLegMetrics(day: TripDay): LegMetric[] {
  const sortedItems = [...day.items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const routeItems = sortedItems.filter(item => !isLogisticsItem(item) && !isHotelMeal(item));
  const legs: LegMetric[] = [];

  for (let i = 1; i < routeItems.length; i++) {
    const from = routeItems[i - 1];
    const to = routeItems[i];
    if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) continue;
    if (from.latitude === 0 || to.latitude === 0) continue;

    const directDistanceKm = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    const reportedDistanceKm =
      typeof to.distanceFromPrevious === 'number' && to.distanceFromPrevious > 0
        ? to.distanceFromPrevious : null;
    const canTrustReported =
      typeof reportedDistanceKm === 'number'
      && Math.abs(reportedDistanceKm - directDistanceKm) <= 0.75;
    const distanceKm = canTrustReported ? reportedDistanceKm : directDistanceKm;

    const reportedTravelMin =
      typeof to.timeFromPrevious === 'number' && to.timeFromPrevious > 0
        ? to.timeFromPrevious : null;
    const estimatedTravelMin = Math.max(5, Math.round(distanceKm * 12));
    const travelMin = reportedTravelMin && canTrustReported
      ? reportedTravelMin : estimatedTravelMin;

    const gapMin = timeToMinutes(to.startTime) - timeToMinutes(from.endTime);

    legs.push({ fromTitle: from.title, toTitle: to.title, distanceKm, travelMin, gapMin });
  }

  return legs;
}

function computeRoutePoints(day: TripDay): Array<{ latitude: number; longitude: number }> {
  return [...day.items]
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
    .filter(item => !isLogisticsItem(item) && !isHotelMeal(item))
    .filter(item => !!item.latitude && !!item.longitude && item.latitude !== 0 && item.longitude !== 0)
    .map(item => ({ latitude: item.latitude, longitude: item.longitude }));
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
      if (!visited[i] && bestEdge[i] < min) { min = bestEdge[i]; u = i; }
    }
    if (u === -1) break;
    visited[u] = true;
    total += min;
    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      const dist = calculateDistance(points[u].latitude, points[u].longitude, points[v].latitude, points[v].longitude);
      if (dist < bestEdge[v]) bestEdge[v] = dist;
    }
  }
  return total;
}

type LegMetric = {
  fromTitle: string;
  toTitle: string;
  distanceKm: number;
  travelMin: number;
  gapMin: number;
};

function isLogisticsItem(item: TripItem): boolean {
  return LOGISTICS_TYPES.includes(item.type);
}

function isHotelMeal(item: TripItem): boolean {
  if (item.type !== 'restaurant') return false;
  const normalizedTitle = (item.title || '')
    .toLowerCase()
    .replace(/'/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalizedTitle.includes("a l'hotel") || normalizedTitle.includes('at hotel');
}

function isIntentionalGapAnchor(item: TripItem): boolean {
  // free_time items are always intentional (user chose to rest)
  if (item.type === 'free_time') return true;
  // Note: checkin/checkout are NOT intentional anchors — gaps after them
  // should still be penalized if they're too long (the main gap loop handles
  // reasonable post-checkin gaps via the ≤90min threshold).
  return false;
}

function isInterCityTrip(trip: Trip): boolean {
  const origin = normalizePlaceName(trip.preferences.origin);
  const destination = normalizePlaceName(trip.preferences.destination);
  if (!origin || !destination) return false;
  return origin !== destination;
}

function normalizePlaceName(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLonghaulItem(item: TripItem): boolean {
  if ((item.type === 'transport' || item.type === 'flight') && item.transportRole === 'longhaul') return true;
  if (item.id.startsWith('transport-out-') || item.id.startsWith('transport-ret-')) return true;
  if (item.id.startsWith('flight-out-') || item.id.startsWith('flight-ret-')) return true;
  return false;
}

function resolveFallbackTransportOption(trip: Trip): Trip['selectedTransport'] | null {
  if (trip.selectedTransport) return trip.selectedTransport;
  if (!trip.transportOptions?.length) return null;
  return trip.transportOptions.find(option => option.recommended) || trip.transportOptions[0] || null;
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

/**
 * Estimate realistic flight duration (minutes) based on great-circle distance.
 * Uses city center coordinates + distance bands with typical flight speeds.
 * Includes ~60min buffer for taxi/takeoff/landing/immigration.
 */
function estimateFlightDuration(from: string, to: string): number {
  const fromCoords = getCityCenterCoords(from);
  const toCoords = getCityCenterCoords(to);

  if (!fromCoords || !toCoords) {
    // Can't estimate — return a conservative default (medium-haul)
    return 300; // 5h
  }

  const distKm = calculateDistance(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng);

  // Distance bands → estimated flight duration (including ground time)
  if (distKm < 500) return 120;        // Short-haul: ~2h total
  if (distKm < 1500) return 180;       // Medium-short: ~3h
  if (distKm < 3000) return 300;       // Medium: ~5h (e.g., Paris→Istanbul)
  if (distKm < 5000) return 480;       // Medium-long: ~8h (e.g., Paris→Dubai)
  if (distKm < 8000) return 660;       // Long-haul: ~11h (e.g., Paris→Tokyo)
  return 780;                           // Ultra long-haul: ~13h (e.g., Paris→Sydney)
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
  const estimatedDuration = estimateFlightDuration(from, to);
  const sorted = [...day.items].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const fallbackStartMinutes = direction === 'outbound'
    ? Math.max(6 * 60, (sorted[0] ? timeToMinutes(sorted[0].startTime) - estimatedDuration : 8 * 60))
    : Math.min(22 * 60, (sorted[sorted.length - 1] ? timeToMinutes(sorted[sorted.length - 1].endTime) + 30 : 15 * 60));
  const fallbackEndMinutes = Math.min(23 * 60 + 59, fallbackStartMinutes + estimatedDuration);
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

// inferRestaurantCuisineFamily removed — now using getCuisineFamilyFromItem from utils/cuisine
