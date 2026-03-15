/**
 * planner-v31.ts — Phase 3: Inter-day planner with beam search
 *
 * Replaces the hierarchical clustering + balance/diversify/swap pipeline
 * with a deterministic beam search that assigns activities to days while
 * respecting roles, constraints, and quality objectives.
 *
 * Entry point: buildPlannerClustersV31()
 * Output: ActivityCluster[] (same shape as v3.0)
 */

import type { ScoredActivity, ActivityCluster, CityDensityProfile, DayTripPack } from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
import { calculateDistance } from '../services/geocoding';
import { timeToMin } from './utils/time';
import type { V31RescueStage } from './v31-rescue';
import { getActivityHoursForDay } from './utils/opening-hours';

// ============================================
// DayRole
// ============================================

export type DayRole = 'arrival' | 'full_city' | 'day_trip' | 'recovery' | 'departure';
type PlannerProfile = 'v3.1' | 'v3.2';
type ArrivalFatigueRole = 'standard' | 'long_haul';
const MIN_DAY_TRIP_WINDOW_MIN = 420;

export interface DaySlot {
  dayNumber: number;
  role: DayRole;
  windowMin: number; // available minutes for activities
  timeWindow: DayTimeWindow;
}

/**
 * Assign roles to each day based on time windows and trip structure.
 */
export function assignDayRoles(
  numDays: number,
  timeWindows: DayTimeWindow[]
): DaySlot[] {
  const slots: DaySlot[] = [];

  for (let d = 1; d <= numDays; d++) {
    const tw = timeWindows.find(w => w.dayNumber === d) || {
      dayNumber: d,
      activityStartTime: '08:30',
      activityEndTime: '22:00',
      hasArrivalTransport: false,
      hasDepartureTransport: false,
    };

    const startMin = timeToMin(tw.activityStartTime);
    const endMin = timeToMin(tw.activityEndTime);
    const windowMin = Math.max(0, endMin - startMin);

    let role: DayRole;

    if (tw.hasArrivalTransport && (windowMin < 360 || startMin >= 12 * 60)) {
      role = 'arrival';
    } else if (tw.hasDepartureTransport && (windowMin < 300 || endMin <= 18 * 60)) {
      role = 'departure';
    } else {
      role = 'full_city';
    }

    slots.push({ dayNumber: d, role, windowMin, timeWindow: tw });
  }

  // Recovery day: max 1, only if durationDays >= 6 and >= 4 city days remain
  if (numDays >= 6) {
    const cityDaysCount = slots.filter(s => s.role === 'full_city').length;
    if (cityDaysCount >= 5) {
      // Check if there's overload: more than 6 activities per city day on average
      // This is a heuristic — actual overload detection happens during beam search
      // For now, just mark the slot. Recovery will only be used if beam search needs it.
      // Don't assign automatically per plan: "Jamais automatique"
    }
  }

  return slots;
}

// ============================================
// Role Compatibility (for cross-day moves)
// ============================================

const ROLE_COMPAT: Record<DayRole, DayRole[]> = {
  arrival: ['arrival', 'full_city'],
  departure: ['departure', 'full_city'],
  recovery: ['recovery', 'full_city'],
  full_city: ['full_city', 'recovery'],
  day_trip: [], // never move items out of day trips
};

function isRoleCompatible(from: DayRole, to: DayRole): boolean {
  return ROLE_COMPAT[from].includes(to);
}

// ============================================
// Beam Search State
// ============================================

interface BeamState {
  /** Activities assigned to each day (index = daySlot index) */
  assignments: ScoredActivity[][];
  /** Penalty scores for comparison */
  penalties: BeamPenalties;
  /** Stable tie-break key */
  stableTieBreakKey: string;
}

interface BeamPenalties {
  hardViolations: number;
  missingProtectedMustSees: number;
  protectedViolations: number;
  missingMustSees: number;
  daysOverRoleBudget: number;
  dayTripBoundaryPenalty: number;
  urbanLongLegCount: number;
  zigzagTurnsTotal: number;
  routeInefficiencyPenalty: number;
  rhythmPenalty: number;
  diversityPenalty: number;
  fillerPenalty: number;
  totalTravelMinutes: number;
}

interface PlannerV32Context {
  arrivalFatigueRole?: ArrivalFatigueRole;
}

function emptyPenalties(): BeamPenalties {
  return {
    hardViolations: 0,
    missingProtectedMustSees: 0,
    protectedViolations: 0,
    missingMustSees: 0,
    daysOverRoleBudget: 0,
    dayTripBoundaryPenalty: 0,
    urbanLongLegCount: 0,
    zigzagTurnsTotal: 0,
    routeInefficiencyPenalty: 0,
    rhythmPenalty: 0,
    diversityPenalty: 0,
    fillerPenalty: 0,
    totalTravelMinutes: 0,
  };
}

// ============================================
// Lexicographic Comparator
// ============================================

/**
 * Compare two beam states lexicographically.
 * Returns negative if a is better, positive if b is better, 0 if equal.
 */
function compareStates(a: BeamState, b: BeamState): number {
  return compareStatesWithStage(a, b, 0, 'v3.1');
}

function compareStatesWithStage(
  a: BeamState,
  b: BeamState,
  rescueStage: V31RescueStage,
  plannerProfile: PlannerProfile
): number {
  const pa = a.penalties;
  const pb = b.penalties;

  if (plannerProfile === 'v3.2') {
    if (pa.hardViolations !== pb.hardViolations) return pa.hardViolations - pb.hardViolations;
    if (pa.missingProtectedMustSees !== pb.missingProtectedMustSees) return pa.missingProtectedMustSees - pb.missingProtectedMustSees;
    if (pa.dayTripBoundaryPenalty !== pb.dayTripBoundaryPenalty) return pa.dayTripBoundaryPenalty - pb.dayTripBoundaryPenalty;
    if (pa.urbanLongLegCount !== pb.urbanLongLegCount) return pa.urbanLongLegCount - pb.urbanLongLegCount;
    if (pa.zigzagTurnsTotal !== pb.zigzagTurnsTotal) return pa.zigzagTurnsTotal - pb.zigzagTurnsTotal;
    if (pa.routeInefficiencyPenalty !== pb.routeInefficiencyPenalty) return pa.routeInefficiencyPenalty - pb.routeInefficiencyPenalty;
    if (pa.rhythmPenalty !== pb.rhythmPenalty) return pa.rhythmPenalty - pb.rhythmPenalty;
    if (pa.totalTravelMinutes !== pb.totalTravelMinutes) return pa.totalTravelMinutes - pb.totalTravelMinutes;
    return a.stableTieBreakKey.localeCompare(b.stableTieBreakKey);
  }

  // 1. hardViolations
  if (pa.hardViolations !== pb.hardViolations) return pa.hardViolations - pb.hardViolations;
  // 2. protectedViolations
  if (pa.protectedViolations !== pb.protectedViolations) return pa.protectedViolations - pb.protectedViolations;
  // 3. missingMustSees
  if (pa.missingMustSees !== pb.missingMustSees) return pa.missingMustSees - pb.missingMustSees;
  // 4. daysOverRoleBudget
  if (pa.daysOverRoleBudget !== pb.daysOverRoleBudget) return pa.daysOverRoleBudget - pb.daysOverRoleBudget;
  // 5. dayTripBoundaryPenalty
  if (pa.dayTripBoundaryPenalty !== pb.dayTripBoundaryPenalty) return pa.dayTripBoundaryPenalty - pb.dayTripBoundaryPenalty;
  // 6. urbanLongLegCount
  if (pa.urbanLongLegCount !== pb.urbanLongLegCount) return pa.urbanLongLegCount - pb.urbanLongLegCount;
  // 7. zigzagTurnsTotal
  if (pa.zigzagTurnsTotal !== pb.zigzagTurnsTotal) return pa.zigzagTurnsTotal - pb.zigzagTurnsTotal;
  // 8. routeInefficiencyPenalty
  if (rescueStage < 3 && pa.routeInefficiencyPenalty !== pb.routeInefficiencyPenalty) {
    return pa.routeInefficiencyPenalty - pb.routeInefficiencyPenalty;
  }
  // 9. rhythmPenalty
  if (pa.rhythmPenalty !== pb.rhythmPenalty) return pa.rhythmPenalty - pb.rhythmPenalty;
  // 10. diversityPenalty
  if (rescueStage < 3 && pa.diversityPenalty !== pb.diversityPenalty) {
    return pa.diversityPenalty - pb.diversityPenalty;
  }
  // 11. fillerPenalty
  if (rescueStage < 3 && pa.fillerPenalty !== pb.fillerPenalty) return pa.fillerPenalty - pb.fillerPenalty;
  // 12. totalTravelMinutes
  if (pa.totalTravelMinutes !== pb.totalTravelMinutes) return pa.totalTravelMinutes - pb.totalTravelMinutes;
  // 13. stableTieBreakKey (lexicographic on sorted activity IDs)
  return a.stableTieBreakKey.localeCompare(b.stableTieBreakKey);
}

function normalizePlannerText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferPoiFamily(activity: ScoredActivity): string {
  const text = normalizePlannerText(`${activity.name || ''} ${(activity.description || '')} ${activity.type || ''}`);
  if (/disney|theme park|amusement|water park|universal/.test(text)) return 'theme_park';
  if (/basilica|basilique|church|eglise|église|cathedral|cathedrale|cathédrale|abbey|abbaye/.test(text)) return 'church_basilica';
  if (/column|colonne|memorial|victor emmanuel|monument a|monument à/.test(text)) return 'column_memorial';
  if (/(^| )park( |$)|parc|garden|jardin/.test(text)) return 'generic_park';
  if (/piazza|square|place /.test(text)) return 'generic_square';
  if (/museum|musee|musée|gallery|galerie|galleria/.test(text)) return 'museum_gallery';
  if (/pantheon|forum|colossee|colisee|colisee|colosseum|ruin|ruines|historic|historique|archaeolog/.test(text)) return 'historic_site';
  if (/tower|tour|sky|viewpoint|belvedere|observatory/.test(text)) return 'viewpoint_tower';
  return 'general_landmark';
}

function isSecondaryPoiFamily(family?: string): boolean {
  return family === 'church_basilica'
    || family === 'column_memorial'
    || family === 'generic_park'
    || family === 'generic_square';
}

function inferMacroZoneId(
  activity: ScoredActivity,
  cityCenter: { lat: number; lng: number }
): string {
  const latKm = (activity.latitude - cityCenter.lat) * 111;
  const lngKm = (activity.longitude - cityCenter.lng) * 111 * Math.cos((cityCenter.lat * Math.PI) / 180);
  const distKm = Math.hypot(latKm, lngKm);
  if (distKm < 2) return 'core';

  const vertical = latKm >= 1 ? 'n' : latKm <= -1 ? 's' : '';
  const horizontal = lngKm >= 1 ? 'e' : lngKm <= -1 ? 'w' : '';
  return `${vertical}${horizontal}` || (Math.abs(latKm) >= Math.abs(lngKm) ? (latKm >= 0 ? 'n' : 's') : (lngKm >= 0 ? 'e' : 'w'));
}

function annotatePlannerMetadata(
  activities: ScoredActivity[],
  cityCenter: { lat: number; lng: number },
  fatigueRole: ArrivalFatigueRole
): void {
  for (const activity of activities) {
    activity.poiFamily = activity.poiFamily || inferPoiFamily(activity);
    activity.macroZoneId = activity.macroZoneId || inferMacroZoneId(activity, cityCenter);
    activity.fatigueRole = fatigueRole;
  }
}

function getDominantMacroZone(activities: ScoredActivity[]): string | null {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    const zone = activity.macroZoneId;
    if (!zone) continue;
    counts.set(zone, (counts.get(zone) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [zone, count] of counts) {
    if (count > bestCount) {
      best = zone;
      bestCount = count;
    }
  }
  return best;
}

function isHighFrictionBoundaryActivity(activity: ScoredActivity): boolean {
  const text = normalizePlannerText(`${activity.name || ''} ${(activity.description || '')} ${activity.type || ''}`);
  return /disney|theme park|amusement|water park|universal|segway|workshop|cooking|photoshoot|cruise|excursion|tour /.test(text);
}

function isBoundaryFriendlyForPlanner(
  activity: ScoredActivity,
  slot: DaySlot,
  cityCenter: { lat: number; lng: number },
  plannerProfile: PlannerProfile,
  context: PlannerV32Context
): boolean {
  if (plannerProfile !== 'v3.2') return true;
  if (slot.role !== 'arrival' && slot.role !== 'departure') return true;
  if (activity.protectedReason === 'user_forced') return true;
  const duration = activity.duration || 60;
  const distKm = calculateDistance(activity.latitude, activity.longitude, cityCenter.lat, cityCenter.lng);
  const isDayTripLike = activity.protectedReason === 'day_trip'
    || activity.protectedReason === 'day_trip_anchor'
    || (activity.dayTripAffinity || 0) >= 0.7;
  if (isDayTripLike || isHighFrictionBoundaryActivity(activity)) return false;

  if (slot.role === 'arrival' && context.arrivalFatigueRole === 'long_haul') {
    return duration <= 60 && distKm <= 2;
  }

  if (slot.role === 'departure') {
    return duration <= 60 && distKm <= 2.5;
  }

  return duration <= 90 && distKm <= 3;
}

function buildApproxRoute(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  if (points.length <= 2) return points;
  const remaining = points.slice(1);
  const path = [points[0]];
  let current = points[0];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const dist = calculateDistance(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }
    current = remaining.splice(bestIndex, 1)[0];
    path.push(current);
  }
  return path;
}

function computeApproxRouteMetrics(
  acts: ScoredActivity[],
  cityCenter: { lat: number; lng: number }
): { longLegCount: number; zigzagTurns: number; ineffPenalty: number; travelMinutes: number } {
  if (acts.length <= 1) {
    return { longLegCount: 0, zigzagTurns: 0, ineffPenalty: 0, travelMinutes: 0 };
  }

  const centroid = {
    lat: acts.reduce((sum, act) => sum + act.latitude, 0) / acts.length,
    lng: acts.reduce((sum, act) => sum + act.longitude, 0) / acts.length,
  };
  const seed = acts
    .map((act) => ({ lat: act.latitude, lng: act.longitude, dist: calculateDistance(act.latitude, act.longitude, centroid.lat, centroid.lng) }))
    .sort((a, b) => a.dist - b.dist)[0];
  const route = buildApproxRoute([{ lat: seed.lat, lng: seed.lng }, ...acts
    .filter((act) => act.latitude !== seed.lat || act.longitude !== seed.lng)
    .map((act) => ({ lat: act.latitude, lng: act.longitude }))]);

  let totalKm = 0;
  let zigzagTurns = 0;
  let longLegCount = 0;
  const legs: number[] = [];
  for (let i = 1; i < route.length; i++) {
    const dist = calculateDistance(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng);
    totalKm += dist;
    legs.push(dist);
    if (dist > 3) longLegCount++;
  }
  for (let i = 1; i < route.length - 1; i++) {
    const v1x = route[i].lng - route[i - 1].lng;
    const v1y = route[i].lat - route[i - 1].lat;
    const v2x = route[i + 1].lng - route[i].lng;
    const v2y = route[i + 1].lat - route[i].lat;
    const norm1 = Math.hypot(v1x, v1y);
    const norm2 = Math.hypot(v2x, v2y);
    if (norm1 < 1e-6 || norm2 < 1e-6) continue;
    const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (norm1 * norm2)));
    const angle = Math.acos(cosTheta) * (180 / Math.PI);
    if (angle >= 115) zigzagTurns++;
  }

  let mstLowerBoundKm = 0;
  if (route.length > 1) {
    const visited = new Array<boolean>(route.length).fill(false);
    const bestEdge = new Array<number>(route.length).fill(Number.POSITIVE_INFINITY);
    bestEdge[0] = 0;
    for (let step = 0; step < route.length; step++) {
      let bestIndex = -1;
      let bestValue = Number.POSITIVE_INFINITY;
      for (let i = 0; i < route.length; i++) {
        if (!visited[i] && bestEdge[i] < bestValue) {
          bestValue = bestEdge[i];
          bestIndex = i;
        }
      }
      if (bestIndex < 0) break;
      visited[bestIndex] = true;
      mstLowerBoundKm += bestValue;
      for (let i = 0; i < route.length; i++) {
        if (visited[i]) continue;
        const dist = calculateDistance(route[bestIndex].lat, route[bestIndex].lng, route[i].lat, route[i].lng);
        if (dist < bestEdge[i]) bestEdge[i] = dist;
      }
    }
  }

  const ineffRatio = mstLowerBoundKm > 0.05 ? totalKm / mstLowerBoundKm : 1;
  return {
    longLegCount,
    zigzagTurns,
    ineffPenalty: Math.max(0, Math.round((ineffRatio - 1) * 10)),
    travelMinutes: Math.round((totalKm / 30) * 60),
  };
}

// ============================================
// Penalty Computation
// ============================================

/** Fallback activity duration budget per role (minutes) — used when windowMin is 0 */
const ROLE_BUDGET_FALLBACKS: Record<DayRole, number> = {
  arrival: 300,
  full_city: 600,
  day_trip: 600,
  recovery: 240,
  departure: 240,
};

/** Get effective budget for a slot — use real window, with 60min buffer for meals/transport */
function getSlotBudget(slot: DaySlot): number {
  if (slot.windowMin > 0) {
    return Math.max(0, slot.windowMin - 60); // reserve 60min for meals/transitions
  }
  return ROLE_BUDGET_FALLBACKS[slot.role];
}

/** Get max activities for a slot — derived from available time */
function getSlotMaxActivities(
  slot: DaySlot,
  plannerProfile: PlannerProfile = 'v3.1',
  context: PlannerV32Context = {}
): number {
  const budget = getSlotBudget(slot);
  if (slot.role === 'recovery') return 2;
  if (slot.role === 'day_trip') return 6;
  if (plannerProfile === 'v3.2') {
    if (slot.role === 'departure') return 1;
    if (slot.role === 'arrival' && context.arrivalFatigueRole === 'long_haul') return 1;
    if (slot.role === 'arrival') return 2;
  }
  // ~75min average per activity (duration + transition)
  return Math.max(1, Math.floor(budget / 75));
}

function getSlotDate(startDate: Date | undefined, dayNumber: number): Date | undefined {
  if (!startDate) return undefined;
  const slotDate = new Date(startDate);
  slotDate.setDate(slotDate.getDate() + dayNumber - 1);
  return slotDate;
}

function getActivityCloseMinForDate(activity: ScoredActivity, dayDate: Date | undefined): number | null {
  if (!dayDate) return null;
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (!dayHours?.close) return null;
  return timeToMin(dayHours.close);
}

function canActivityFitDayWindow(activity: ScoredActivity, slot: DaySlot, dayDate: Date | undefined): boolean {
  if (!dayDate) return true;
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (dayHours === null) return false;
  if (!dayHours) return true;

  const slotStart = timeToMin(slot.timeWindow.activityStartTime);
  const slotEnd = timeToMin(slot.timeWindow.activityEndTime);
  const openMin = timeToMin(dayHours.open);
  let closeMin = timeToMin(dayHours.close);
  if (dayHours.close === '00:00' && dayHours.open !== '00:00') {
    closeMin = 24 * 60;
  }
  const earliestStart = Math.max(slotStart, openMin);
  const latestEnd = Math.min(slotEnd, closeMin);
  return earliestStart + (activity.duration || 60) <= latestEnd;
}

function isShortConstrainedSlot(slot: DaySlot): boolean {
  return slot.role === 'arrival' || slot.role === 'departure' || slot.windowMin < 360;
}

function countEarlyCloseActivities(
  activities: ScoredActivity[],
  dayDate: Date | undefined
): number {
  return activities.filter((activity) => {
    const closeMin = getActivityCloseMinForDate(activity, dayDate);
    return closeMin !== null && closeMin <= 19 * 60;
  }).length;
}

function isLongDurationActivity(activity: ScoredActivity): boolean {
  return (activity.duration || 60) >= 180;
}

function computePenalties(
  state: BeamState,
  slots: DaySlot[],
  allMustSeeIds: Set<string>,
  allProtectedIds: Set<string>,
  cityCenter: { lat: number; lng: number },
  densityProfile?: CityDensityProfile,
  rescueStage: V31RescueStage = 0,
  startDate?: Date,
  plannerProfile: PlannerProfile = 'v3.1',
  context: PlannerV32Context = {}
): BeamPenalties {
  const p = emptyPenalties();
  const urbanBudgetKm = densityProfile?.urbanLegBudgetKm ?? 3.5;

  const assignedIds = new Set<string>();
  for (const dayActs of state.assignments) {
    for (const a of dayActs) assignedIds.add(a.id || a.name);
  }

  // Missing must-sees
  for (const msId of allMustSeeIds) {
    if (!assignedIds.has(msId)) p.missingMustSees++;
  }
  for (const protectedId of allProtectedIds) {
    if (!assignedIds.has(protectedId)) p.missingProtectedMustSees++;
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const acts = state.assignments[i] || [];
    const budget = getSlotBudget(slot);
    const maxActs = getSlotMaxActivities(slot, plannerProfile, context);
    const dayDate = getSlotDate(startDate, slot.dayNumber);

    // Duration overrun
    const totalDuration = acts.reduce((s, a) => s + (a.duration || 60), 0);
    if (totalDuration > budget) {
      p.daysOverRoleBudget += Math.ceil((totalDuration - budget) / 60);
    }
    if (acts.length > maxActs) {
      p.daysOverRoleBudget += acts.length - maxActs;
    }

    // Day trip on boundary day or on a too-short window
    if (slot.role === 'day_trip' && ((slot.dayNumber === 1 || slot.dayNumber === slots.length) || slot.windowMin < MIN_DAY_TRIP_WINDOW_MIN)) {
      p.dayTripBoundaryPenalty += 10;
    }

    // Geo penalties per day
    if (acts.length >= 2) {
      const routeMetrics = computeApproxRouteMetrics(acts, cityCenter);
      p.zigzagTurnsTotal += routeMetrics.zigzagTurns;
      p.routeInefficiencyPenalty += routeMetrics.ineffPenalty;
      p.totalTravelMinutes += routeMetrics.travelMinutes;
      if (slot.role !== 'day_trip') {
        p.urbanLongLegCount += routeMetrics.longLegCount;
      }
    }

    if (dayDate) {
      for (const act of acts) {
        if (!isBoundaryFriendlyForPlanner(act, slot, cityCenter, plannerProfile, context)) {
          p.hardViolations++;
        }
        if (!canActivityFitDayWindow(act, slot, dayDate)) {
          p.hardViolations++;
        }
      }
      if (rescueStage >= 1 && isShortConstrainedSlot(slot)) {
        const earlyCloseCount = countEarlyCloseActivities(acts, dayDate);
        if (earlyCloseCount > 1) {
          p.hardViolations += earlyCloseCount - 1;
        }
      }
    }

    if (plannerProfile === 'v3.2' && acts.length >= 2) {
      const secondaryFamilyCounts = new Map<string, number>();
      const uniqueZones = new Set<string>();
      for (const activity of acts) {
        if (activity.macroZoneId) uniqueZones.add(activity.macroZoneId);
        if (isSecondaryPoiFamily(activity.poiFamily)) {
          secondaryFamilyCounts.set(activity.poiFamily!, (secondaryFamilyCounts.get(activity.poiFamily!) || 0) + 1);
        }
      }
      for (const count of secondaryFamilyCounts.values()) {
        if (count > 1) p.rhythmPenalty += (count - 1) * 2;
      }
      if (uniqueZones.size > 1) {
        p.routeInefficiencyPenalty += uniqueZones.size - 1;
      }
    } else if (rescueStage < 3 && acts.length >= 3) {
      const typeCounts = new Map<string, number>();
      for (const a of acts) {
        typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
      }
      for (const count of typeCounts.values()) {
        if (count > 2) p.diversityPenalty += count - 2;
      }
    }

    // Rhythm: penalize very dense or very light days
    if (slot.role === 'full_city') {
      if (acts.length <= 1) p.rhythmPenalty += plannerProfile === 'v3.2' ? 5 : 2;
      if (acts.length >= 7) p.rhythmPenalty += acts.length - 6; // too dense
    }
  }

  if (plannerProfile === 'v3.2') {
    const zoneDays = new Map<string, number[]>();
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (slot.role !== 'full_city') continue;
      const dominantZone = getDominantMacroZone(state.assignments[index] || []);
      if (!dominantZone) continue;
      if (!zoneDays.has(dominantZone)) zoneDays.set(dominantZone, []);
      zoneDays.get(dominantZone)!.push(slot.dayNumber);
    }
    for (const dayNumbers of zoneDays.values()) {
      dayNumbers.sort((left, right) => left - right);
      for (let i = 1; i < dayNumbers.length; i++) {
        if (dayNumbers[i] - dayNumbers[i - 1] > 1) {
          p.routeInefficiencyPenalty += dayNumbers[i] - dayNumbers[i - 1] - 1;
        }
      }
    }
  }

  // Protected violations: protected activities not assigned
  for (const protectedId of allProtectedIds) {
    if (!assignedIds.has(protectedId)) p.protectedViolations++;
  }

  return p;
}

function computeStableTieBreakKey(assignments: ScoredActivity[][]): string {
  return assignments
    .map(dayActs => dayActs.map(a => a.id || a.name).sort().join(','))
    .join('|');
}

// ============================================
// Greedy Baseline
// ============================================

/**
 * Greedy assignment: assign activities to days by nearest-to-centroid,
 * respecting role budgets and must-see priority.
 */
function greedyAssign(
  activities: ScoredActivity[],
  slots: DaySlot[],
  cityCenter: { lat: number; lng: number },
  rescueStage: V31RescueStage,
  startDate?: Date,
  plannerProfile: PlannerProfile = 'v3.1',
  context: PlannerV32Context = {}
): ScoredActivity[][] {
  const assignments: ScoredActivity[][] = slots.map(() => []);

  const protectedActivities = activities
    .filter((activity) => activity.mustSee || activity.protectedReason)
    .sort((a, b) => {
      if (Boolean(a.mustSee) !== Boolean(b.mustSee)) return a.mustSee ? -1 : 1;
      if (Boolean(a.protectedReason) !== Boolean(b.protectedReason)) return a.protectedReason ? -1 : 1;
      return b.score - a.score;
    });
  const optionalActivities = activities
    .filter((activity) => !protectedActivities.includes(activity))
    .sort((a, b) => b.score - a.score);

  const sorted = [...protectedActivities, ...optionalActivities];
  const isProtected = (activity: ScoredActivity) => Boolean(activity.mustSee || activity.protectedReason);

  const findBestDay = (activity: ScoredActivity, allowEviction: boolean): number => {
    let bestDay = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const dayDate = getSlotDate(startDate, slot.dayNumber);
      if (slot.role === 'day_trip') continue;
      if (slot.role === 'recovery' && plannerProfile === 'v3.2' && isProtected(activity)) continue;
      if (!isBoundaryFriendlyForPlanner(activity, slot, cityCenter, plannerProfile, context)) continue;
      if (!canActivityFitDayWindow(activity, slot, dayDate)) continue;

      const dayActs = assignments[i];
      const totalDur = dayActs.reduce((s, a) => s + (a.duration || 60), 0);
      const dayHasCapacity = dayActs.length < getSlotMaxActivities(slot, plannerProfile, context);
      const dayHasDuration = totalDur + (activity.duration || 60) <= getSlotBudget(slot);

      let canPlace = dayHasCapacity && dayHasDuration;
      if (!canPlace && allowEviction && isProtected(activity)) {
        const victim = [...dayActs]
          .filter((candidate) => !isProtected(candidate))
          .sort((a, b) => a.score - b.score)[0];
        if (victim) {
          const adjustedDur = totalDur - (victim.duration || 60) + (activity.duration || 60);
          canPlace = dayActs.length <= getSlotMaxActivities(slot, plannerProfile, context) && adjustedDur <= getSlotBudget(slot);
        }
      }
      if (!canPlace) continue;

      if (rescueStage >= 1 && isLongDurationActivity(activity) && totalDur > 120) continue;
      if (
        rescueStage >= 1
        && isShortConstrainedSlot(slot)
        && (getActivityCloseMinForDate(activity, dayDate) ?? Infinity) <= 19 * 60
        && countEarlyCloseActivities(dayActs, dayDate) >= 1
      ) {
        continue;
      }

      let geoScore = 0;
      if (dayActs.length > 0) {
        const centroidLat = dayActs.reduce((s, a) => s + a.latitude, 0) / dayActs.length;
        const centroidLng = dayActs.reduce((s, a) => s + a.longitude, 0) / dayActs.length;
        const dist = calculateDistance(activity.latitude, activity.longitude, centroidLat, centroidLng);
        geoScore = -dist;
      } else {
        const dist = calculateDistance(activity.latitude, activity.longitude, cityCenter.lat, cityCenter.lng);
        geoScore = -dist * 0.5;
      }

      let zoneScore = 0;
      if (plannerProfile === 'v3.2') {
        const actZone = activity.macroZoneId || inferMacroZoneId(activity, cityCenter);
        const dominantZone = getDominantMacroZone(dayActs);
        if (dominantZone && actZone === dominantZone) zoneScore += 2.5;
        if (dominantZone && actZone !== dominantZone) zoneScore -= 2;

        if (!dominantZone) {
          const prevZone = i > 0 ? getDominantMacroZone(assignments[i - 1] || []) : null;
          const nextZone = i < assignments.length - 1 ? getDominantMacroZone(assignments[i + 1] || []) : null;
          if (actZone && (prevZone === actZone || nextZone === actZone)) zoneScore += 1.5;
        }

        if (!isProtected(activity) && isSecondaryPoiFamily(activity.poiFamily)) {
          const sameFamilyCount = dayActs.filter((candidate) => candidate.poiFamily === activity.poiFamily).length;
          if (sameFamilyCount > 0) zoneScore -= 3 * sameFamilyCount;
        }
      }

      let roleBonus = 0;
      if (plannerProfile === 'v3.2') {
        if (slot.role === 'full_city') roleBonus += 3;
        if ((slot.role === 'arrival' || slot.role === 'departure') && isProtected(activity)) roleBonus -= 1;
      } else {
        if (slot.role === 'arrival' && dayActs.length < 2) roleBonus += 1;
        if (slot.role === 'departure' && dayActs.length < 2) roleBonus += 1;
      }

      const score = geoScore + zoneScore + roleBonus;
      if (score > bestScore) {
        bestScore = score;
        bestDay = i;
      }
    }

    return bestDay;
  };

  // Sort: must-sees first, then by score desc
  sorted.sort((a, b) => {
    if (a.mustSee !== b.mustSee) return a.mustSee ? -1 : 1;
    return b.score - a.score;
  });

  for (const activity of sorted) {
    const bestDay = findBestDay(activity, plannerProfile === 'v3.2');

    if (bestDay >= 0) {
      if (plannerProfile === 'v3.2' && isProtected(activity)) {
        const slot = slots[bestDay];
        const victim = [...assignments[bestDay]]
          .filter((candidate) => !(candidate.mustSee || candidate.protectedReason))
          .sort((a, b) => a.score - b.score)[0];
        const totalDur = assignments[bestDay].reduce((sum, candidate) => sum + (candidate.duration || 60), 0);
        if (
          victim
          && (
            assignments[bestDay].length >= getSlotMaxActivities(slot, plannerProfile, context)
            || totalDur + (activity.duration || 60) > getSlotBudget(slot)
          )
        ) {
          assignments[bestDay] = assignments[bestDay].filter((candidate) => candidate !== victim);
        }
      }
      assignments[bestDay].push(activity);
    }
  }

  return assignments;
}

// ============================================
// Beam Search
// ============================================

const BEAM_WIDTH = 24;
const MAX_EXPANSIONS_PER_STATE = 6;
const BEAM_BUDGET_MS = 500;
const TOP_FINAL_STATES = 3;

/**
 * Beam search: try swapping activities between days to find better arrangements.
 * Starts from greedy baseline, explores swap moves.
 */
function beamSearch(
  baseline: ScoredActivity[][],
  slots: DaySlot[],
  allMustSeeIds: Set<string>,
  allProtectedIds: Set<string>,
  cityCenter: { lat: number; lng: number },
  densityProfile?: CityDensityProfile,
  rescueStage: V31RescueStage = 0,
  startDate?: Date,
  plannerProfile: PlannerProfile = 'v3.1',
  context: PlannerV32Context = {}
): { assignments: ScoredActivity[][]; usedBeam: boolean; fellBackToGreedy: boolean } {
  const t0 = Date.now();

  const makeState = (assignments: ScoredActivity[][]): BeamState => ({
    assignments,
    penalties: computePenalties(
      { assignments, penalties: emptyPenalties(), stableTieBreakKey: '' },
      slots, allMustSeeIds, allProtectedIds, cityCenter, densityProfile, rescueStage, startDate, plannerProfile, context
    ),
    stableTieBreakKey: computeStableTieBreakKey(assignments),
  });

  const baselineState = makeState(baseline);
  let beam: BeamState[] = [baselineState];
  let improved = false;

  // Iterative improvement rounds
  for (let round = 0; round < 5; round++) {
    if (Date.now() - t0 > BEAM_BUDGET_MS) break;

    const candidates: BeamState[] = [];

    for (const state of beam) {
      if (Date.now() - t0 > BEAM_BUDGET_MS) break;

      let expansions = 0;

      // Generate swap moves: try moving each activity to each other compatible day
      for (let fromDay = 0; fromDay < slots.length && expansions < MAX_EXPANSIONS_PER_STATE; fromDay++) {
        const fromSlot = slots[fromDay];
        if (fromSlot.role === 'day_trip') continue; // atomic

        for (let actIdx = 0; actIdx < state.assignments[fromDay].length && expansions < MAX_EXPANSIONS_PER_STATE; actIdx++) {
          const activity = state.assignments[fromDay][actIdx];
          if (activity.protectedReason === 'day_trip_anchor' || activity.protectedReason === 'day_trip') continue;

          for (let toDay = 0; toDay < slots.length; toDay++) {
            if (toDay === fromDay) continue;
            if (Date.now() - t0 > BEAM_BUDGET_MS) break;

            const toSlot = slots[toDay];
            const toDayDate = getSlotDate(startDate, toSlot.dayNumber);
            if (toSlot.role === 'day_trip') continue;
            if (!isRoleCompatible(fromSlot.role, toSlot.role)) continue;
            if (!isBoundaryFriendlyForPlanner(activity, toSlot, cityCenter, plannerProfile, context)) continue;
            if (!canActivityFitDayWindow(activity, toSlot, toDayDate)) continue;

            // Check capacity
            const toDayActs = state.assignments[toDay];
            if (toDayActs.length >= getSlotMaxActivities(toSlot, plannerProfile, context)) continue;
            const toDur = toDayActs.reduce((s, a) => s + (a.duration || 60), 0);
            if (toDur + (activity.duration || 60) > getSlotBudget(toSlot)) continue;
            if (rescueStage >= 1 && isLongDurationActivity(activity) && toDur > 120) continue;
            if (
              rescueStage >= 1
              && isShortConstrainedSlot(toSlot)
              && (getActivityCloseMinForDate(activity, toDayDate) ?? Infinity) <= 19 * 60
              && countEarlyCloseActivities(toDayActs, toDayDate) >= 1
            ) {
              continue;
            }

            // Create new state with this move
            const newAssignments = state.assignments.map(day => [...day]);
            newAssignments[fromDay] = newAssignments[fromDay].filter((_, i) => i !== actIdx);
            newAssignments[toDay] = [...newAssignments[toDay], activity];

            const newState = makeState(newAssignments);
            if (compareStatesWithStage(newState, state, rescueStage, plannerProfile) < 0) {
              candidates.push(newState);
              expansions++;
            }
          }
        }
      }
    }

    if (candidates.length === 0) break;

    // Merge beam + candidates, keep top BEAM_WIDTH
    const merged = [...beam, ...candidates].sort((left, right) => compareStatesWithStage(left, right, rescueStage, plannerProfile));
    beam = merged.slice(0, BEAM_WIDTH);
    improved = true;
  }

  const best = beam[0];
  const wasImproved = improved && compareStatesWithStage(best, baselineState, rescueStage, plannerProfile) < 0;
  const elapsed = Date.now() - t0;

  console.log(
    `[Planner V3.1] Beam search: ${elapsed}ms, ${beam.length} states, ` +
    `improved=${wasImproved}, timeout=${elapsed > BEAM_BUDGET_MS}`
  );

  return {
    assignments: best.assignments,
    usedBeam: true,
    fellBackToGreedy: !wasImproved,
  };
}

// ============================================
// Public API
// ============================================

export interface PlannerV31Result {
  clusters: ActivityCluster[];
  beamUsed: boolean;
  beamFallbackUsed: boolean;
  dayRoles: DaySlot[];
  dayNumberMismatchCount: number;
}

/**
 * V3.1 inter-day planner.
 *
 * Replaces step3-cluster's hierarchical clustering + balance/diversify/swap
 * with a role-aware beam search that optimizes activity-to-day assignment.
 *
 * Output: standard ActivityCluster[] — same shape as v3.0.
 */
export function buildPlannerClustersV31(
  cityActivities: ScoredActivity[],
  dayTripPacks: DayTripPack[],
  timeWindows: DayTimeWindow[],
  numDays: number,
  cityCenter: { lat: number; lng: number },
  densityProfile?: CityDensityProfile,
  options: {
    rescueStage?: V31RescueStage;
    startDate?: Date;
    plannerVersion?: PlannerProfile;
    arrivalFatigueRole?: ArrivalFatigueRole;
  } = {}
): PlannerV31Result {
  const rescueStage = options.rescueStage ?? 0;
  const startDate = options.startDate;
  const plannerProfile = options.plannerVersion ?? 'v3.1';
  const context: PlannerV32Context = {
    arrivalFatigueRole: options.arrivalFatigueRole ?? 'standard',
  };
  // 1. Assign day roles
  const slots = assignDayRoles(numDays, timeWindows);

  const eligibleDayTripSlots = slots
    .filter((slot) => slot.role === 'full_city' && slot.windowMin >= MIN_DAY_TRIP_WINDOW_MIN)
    .sort((left, right) => {
      const midDay = numDays / 2;
      const midDelta = Math.abs(left.dayNumber - midDay) - Math.abs(right.dayNumber - midDay);
      if (midDelta !== 0) return midDelta;
      return right.windowMin - left.windowMin;
    });
  const sortedDayTripPacks = [...dayTripPacks].sort((left, right) => {
    const leftProtected = left.anchor.mustSee ? 1 : 0;
    const rightProtected = right.anchor.mustSee ? 1 : 0;
    if (rightProtected !== leftProtected) return rightProtected - leftProtected;
    if ((right.requiredWindowMin ?? 0) !== (left.requiredWindowMin ?? 0)) {
      return (right.requiredWindowMin ?? 0) - (left.requiredWindowMin ?? 0);
    }
    return right.anchor.score - left.anchor.score;
  });
  const assignedDayTripPacks = new Map<number, DayTripPack>();
  const demotedDayTripActivities: ScoredActivity[] = [];
  const availableSlots = [...eligibleDayTripSlots];
  for (const pack of sortedDayTripPacks) {
    const slotIndex = availableSlots.findIndex((slot) => slot.windowMin >= (pack.requiredWindowMin ?? MIN_DAY_TRIP_WINDOW_MIN));
    if (slotIndex === -1) {
      const seen = new Set<string>();
      for (const candidate of pack.originalCandidates || pack.activities || [pack.anchor]) {
        const key = candidate.id || candidate.name;
        if (seen.has(key)) continue;
        seen.add(key);
        demotedDayTripActivities.push({
          ...candidate,
          protectedReason: candidate.mustSee ? 'must_see' : undefined,
          dayTripAffinity: 0,
          sourcePackId: undefined,
          planningToken: undefined,
        });
      }
      continue;
    }
    const slot = availableSlots.splice(slotIndex, 1)[0];
    slot.role = 'day_trip';
    assignedDayTripPacks.set(slot.dayNumber, pack);
  }
  console.log(
    `[Planner V3.1] Day roles: ${slots.map(s => `D${s.dayNumber}=${s.role}(${s.windowMin}min)`).join(', ')}`
  );

  // 2. Must-see IDs for penalty computation
  const plannerCityActivities = [...cityActivities, ...demotedDayTripActivities];
  if (plannerProfile === 'v3.2') {
    annotatePlannerMetadata(plannerCityActivities, cityCenter, context.arrivalFatigueRole || 'standard');
  }
  const allMustSeeIds = new Set(
    plannerCityActivities.filter(a => a.mustSee).map(a => a.id || a.name)
  );
  const allProtectedIds = new Set(
    plannerCityActivities
      .filter(a => a.protectedReason || a.mustSee)
      .map(a => a.id || a.name)
  );

  // 3. Greedy baseline
  const greedy = greedyAssign(plannerCityActivities, slots, cityCenter, rescueStage, startDate, plannerProfile, context);

  // 4. Beam search improvement
  const { assignments, usedBeam, fellBackToGreedy } = beamSearch(
    greedy, slots, allMustSeeIds, allProtectedIds, cityCenter, densityProfile, rescueStage, startDate, plannerProfile, context
  );

  // 5. Convert to ActivityCluster[]
  const clusters: ActivityCluster[] = [];
  let dayNumberMismatchCount = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!timeWindows.some(w => w.dayNumber === slot.dayNumber)) {
      dayNumberMismatchCount++;
    }

    if (slot.role === 'day_trip') {
      const pack = assignedDayTripPacks.get(slot.dayNumber);
      if (pack) {
        const packActs = pack.activities;
        clusters.push({
          dayNumber: slot.dayNumber,
          activities: packActs.map((act, actIdx) => ({
            ...act,
            plannerRole: slot.role,
            originalDayNumber: slot.dayNumber,
            planningToken: act.planningToken || `${pack.id}:${act.id || act.name}:${slot.dayNumber}:${actIdx}`,
            protectedReason: act.protectedReason || (act.id === pack.anchor.id ? 'day_trip_anchor' : 'day_trip'),
            sourcePackId: act.sourcePackId || pack.id,
          })),
          centroid: {
            lat: packActs.reduce((s, a) => s + a.latitude, 0) / packActs.length,
            lng: packActs.reduce((s, a) => s + a.longitude, 0) / packActs.length,
          },
          totalIntraDistance: 0,
          isFullDay: true,
          isDayTrip: true,
          dayTripDestination: pack.destination,
          plannerRole: slot.role,
        });
      }
      continue;
    }

    const dayActs = assignments[i] || [];
    const centroid = dayActs.length > 0
      ? {
          lat: dayActs.reduce((s, a) => s + a.latitude, 0) / dayActs.length,
          lng: dayActs.reduce((s, a) => s + a.longitude, 0) / dayActs.length,
        }
      : cityCenter;

    clusters.push({
      dayNumber: slot.dayNumber,
      activities: dayActs.map((act, actIdx) => ({
        ...act,
        plannerRole: slot.role,
        originalDayNumber: slot.dayNumber,
        protectedReason: act.protectedReason || (act.mustSee ? 'must_see' : undefined),
        planningToken: act.planningToken || `${act.id || act.name}:${slot.dayNumber}:${actIdx}`,
      })),
      centroid,
      totalIntraDistance: 0,
      plannerRole: slot.role,
    });
  }

  return {
    clusters,
    beamUsed: usedBeam,
    beamFallbackUsed: fellBackToGreedy,
    dayRoles: slots,
    dayNumberMismatchCount,
  };
}
