/**
 * intra-day-router.ts — Phase 4: Weighted intra-day routing
 *
 * Applies weighted nearest-neighbor + 2-opt to order activities within a day.
 * Cost model:
 *   cost = travelMinutes + closeRiskPenalty + returnAnchorPenalty
 *
 * closeRiskPenalty: urgency to visit before closing
 *   - 40 if slack < 45min
 *   - 15 if slack < 90min
 *   - 0 otherwise
 *
 * returnAnchorPenalty: cost of being far from anchor at day's end
 *   estimatedMinutesToAnchorOut * 0.35
 */

import type { ScoredActivity, ActivityCluster } from './types';
import { calculateDistance } from '../services/geocoding';
import { timeToMin } from './utils/time';

// ============================================
// Cost Model
// ============================================

interface RoutingContext {
  /** Day start time (minutes from midnight) */
  dayStartMin: number;
  /** Day end time (minutes from midnight) */
  dayEndMin: number;
  /** Anchor point (hotel or cluster centroid) for return penalty */
  anchorLat: number;
  anchorLng: number;
}

function travelMinutesBetween(a: ScoredActivity, b: ScoredActivity): number {
  const dist = calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
  // Urban speed ~30km/h average (walk + transit mix)
  return Math.max(5, Math.round((dist / 30) * 60));
}

function closeRiskPenalty(
  activity: ScoredActivity,
  arrivalTimeMin: number
): number {
  // If activity has no closing time, no penalty
  const closeStr = activity.openingHours?.close;
  if (!closeStr || closeStr === '23:59' || closeStr === '00:00') return 0;

  const closeMin = timeToMin(closeStr);
  const endOfVisit = arrivalTimeMin + (activity.duration || 60);
  const slack = closeMin - endOfVisit;

  if (slack < 45) return 40;
  if (slack < 90) return 15;
  return 0;
}

function returnAnchorPenalty(
  activity: ScoredActivity,
  ctx: RoutingContext
): number {
  const dist = calculateDistance(
    activity.latitude, activity.longitude,
    ctx.anchorLat, ctx.anchorLng
  );
  const estimatedMinutes = Math.round((dist / 30) * 60);
  return estimatedMinutes * 0.35;
}

// ============================================
// Weighted Nearest Neighbor
// ============================================

function weightedNearestNeighbor(
  activities: ScoredActivity[],
  ctx: RoutingContext
): ScoredActivity[] {
  if (activities.length <= 1) return [...activities];

  const remaining = new Set(activities.map((_, i) => i));
  const route: number[] = [];

  // Start with must-see that has earliest closing time, or first activity
  let startIdx = 0;
  let earliestClose = Infinity;
  for (let i = 0; i < activities.length; i++) {
    if (activities[i].mustSee) {
      const closeStr = activities[i].openingHours?.close;
      if (closeStr && closeStr !== '23:59') {
        const closeMin = timeToMin(closeStr);
        if (closeMin < earliestClose) {
          earliestClose = closeMin;
          startIdx = i;
        }
      }
    }
  }

  route.push(startIdx);
  remaining.delete(startIdx);

  let currentTimeMin = ctx.dayStartMin + (activities[startIdx].duration || 60);

  while (remaining.size > 0) {
    const lastIdx = route[route.length - 1];
    const lastAct = activities[lastIdx];

    let bestIdx = -1;
    let bestCost = Infinity;

    for (const candidateIdx of remaining) {
      const candidate = activities[candidateIdx];
      const travel = travelMinutesBetween(lastAct, candidate);
      const arrivalTime = currentTimeMin + travel;
      const closeRisk = closeRiskPenalty(candidate, arrivalTime);
      const returnPenalty = remaining.size === 1
        ? returnAnchorPenalty(candidate, ctx) // last activity: penalize distance from anchor
        : 0;

      const cost = travel + closeRisk + returnPenalty;
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = candidateIdx;
      }
    }

    if (bestIdx === -1) break;
    route.push(bestIdx);
    remaining.delete(bestIdx);
    const travel = travelMinutesBetween(activities[lastIdx], activities[bestIdx]);
    currentTimeMin += travel + (activities[bestIdx].duration || 60);
  }

  return route.map(i => activities[i]);
}

// ============================================
// 2-opt Improvement
// ============================================

function routeCost(
  activities: ScoredActivity[],
  ctx: RoutingContext
): number {
  let cost = 0;
  let timeMin = ctx.dayStartMin;

  for (let i = 0; i < activities.length; i++) {
    if (i > 0) {
      const travel = travelMinutesBetween(activities[i - 1], activities[i]);
      timeMin += travel;
      cost += travel;
    }
    cost += closeRiskPenalty(activities[i], timeMin);
    timeMin += activities[i].duration || 60;
  }

  // Return anchor penalty on last activity
  if (activities.length > 0) {
    cost += returnAnchorPenalty(activities[activities.length - 1], ctx);
  }

  return cost;
}

function twoOptImprove(
  activities: ScoredActivity[],
  ctx: RoutingContext
): ScoredActivity[] {
  if (activities.length <= 2) return activities;

  let improved = true;
  let route = [...activities];
  let bestCost = routeCost(route, ctx);
  let passes = 0;

  while (improved && passes < 5) {
    improved = false;
    passes++;

    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        // Reverse segment [i, j]
        const newRoute = [...route];
        const segment = newRoute.slice(i, j + 1).reverse();
        newRoute.splice(i, j - i + 1, ...segment);

        const newCost = routeCost(newRoute, ctx);
        if (newCost < bestCost) {
          route = newRoute;
          bestCost = newCost;
          improved = true;
        }
      }
    }
  }

  return route;
}

// ============================================
// Public API
// ============================================

/**
 * Optimize visit order within each cluster using weighted NN + 2-opt.
 * Mutates cluster activities in place.
 */
export function optimizeClusterRouting(
  clusters: ActivityCluster[],
  hotelCoords?: { lat: number; lng: number },
  dayStartTime: string = '08:30',
  dayEndTime: string = '22:00'
): void {
  const dayStartMin = timeToMin(dayStartTime);
  const dayEndMin = timeToMin(dayEndTime);

  for (const cluster of clusters) {
    if (cluster.isDayTrip) continue; // day trips have their own routing
    if (cluster.activities.length <= 2) continue;

    const anchor = hotelCoords || cluster.centroid;
    const ctx: RoutingContext = {
      dayStartMin,
      dayEndMin,
      anchorLat: anchor.lat,
      anchorLng: anchor.lng,
    };

    // Step 1: Weighted nearest neighbor
    const nnRoute = weightedNearestNeighbor(cluster.activities, ctx);
    // Step 2: 2-opt improvement
    cluster.activities = twoOptImprove(nnRoute, ctx);
  }
}
