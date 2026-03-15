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
  timeWindows: DayTimeWindow[],
  dayTripPacks: DayTripPack[]
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

  // Assign day_trip roles for days that will hold DayTripPacks
  // Place day trips on full_city days, preferring middle days
  const cityDayIndices = slots
    .map((s, i) => ({ idx: i, s }))
    .filter(x => x.s.role === 'full_city')
    .sort((a, b) => {
      // Prefer middle days
      const midDay = numDays / 2;
      return Math.abs(a.s.dayNumber - midDay) - Math.abs(b.s.dayNumber - midDay);
    });

  let dtAssigned = 0;
  for (const { idx } of cityDayIndices) {
    if (dtAssigned >= dayTripPacks.length) break;
    slots[idx].role = 'day_trip';
    dtAssigned++;
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

function emptyPenalties(): BeamPenalties {
  return {
    hardViolations: 0,
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
  return compareStatesWithStage(a, b, 0);
}

function compareStatesWithStage(a: BeamState, b: BeamState, rescueStage: V31RescueStage): number {
  const pa = a.penalties;
  const pb = b.penalties;

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
function getSlotMaxActivities(slot: DaySlot): number {
  const budget = getSlotBudget(slot);
  if (slot.role === 'recovery') return 2;
  if (slot.role === 'day_trip') return 6;
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
  startDate?: Date
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

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const acts = state.assignments[i] || [];
    const budget = getSlotBudget(slot);
    const maxActs = getSlotMaxActivities(slot);
    const dayDate = getSlotDate(startDate, slot.dayNumber);

    // Duration overrun
    const totalDuration = acts.reduce((s, a) => s + (a.duration || 60), 0);
    if (totalDuration > budget) {
      p.daysOverRoleBudget += Math.ceil((totalDuration - budget) / 60);
    }
    if (acts.length > maxActs) {
      p.daysOverRoleBudget += acts.length - maxActs;
    }

    // Day trip on boundary day penalty
    if (slot.role === 'day_trip' && (slot.dayNumber === 1 || slot.dayNumber === slots.length)) {
      p.dayTripBoundaryPenalty += 10;
    }

    // Geo penalties per day
    if (acts.length >= 2) {
      let prevAct = acts[0];
      for (let j = 1; j < acts.length; j++) {
        const dist = calculateDistance(
          prevAct.latitude, prevAct.longitude,
          acts[j].latitude, acts[j].longitude
        );
        // Urban long legs
        if (dist > urbanBudgetKm && slot.role !== 'day_trip') {
          p.urbanLongLegCount++;
        }
        // Travel time estimate (30km/h urban)
        p.totalTravelMinutes += Math.round((dist / 30) * 60);
        prevAct = acts[j];
      }
    }

    if (dayDate) {
      for (const act of acts) {
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

    // Type diversity: count excess same-type activities
    if (rescueStage < 3 && acts.length >= 3) {
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
      if (acts.length <= 1) p.rhythmPenalty += 2; // too light
      if (acts.length >= 7) p.rhythmPenalty += acts.length - 6; // too dense
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
  startDate?: Date
): ScoredActivity[][] {
  const assignments: ScoredActivity[][] = slots.map(() => []);

  // Sort: must-sees first, then by score desc
  const sorted = [...activities].sort((a, b) => {
    if (a.mustSee !== b.mustSee) return a.mustSee ? -1 : 1;
    return b.score - a.score;
  });

  for (const activity of sorted) {
    // Find best day for this activity
    let bestDay = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const dayDate = getSlotDate(startDate, slot.dayNumber);
      if (slot.role === 'day_trip') continue; // day trips handled separately
      if (slot.role === 'recovery') continue; // recovery days are minimal

      const dayActs = assignments[i];
      const maxActs = getSlotMaxActivities(slot);
      if (dayActs.length >= maxActs) continue;

      if (!canActivityFitDayWindow(activity, slot, dayDate)) continue;

      const totalDur = dayActs.reduce((s, a) => s + (a.duration || 60), 0);
      if (totalDur + (activity.duration || 60) > getSlotBudget(slot)) continue;
      if (rescueStage >= 1 && isLongDurationActivity(activity) && totalDur > 120) continue;

      if (
        rescueStage >= 1
        && isShortConstrainedSlot(slot)
        && (getActivityCloseMinForDate(activity, dayDate) ?? Infinity) <= 19 * 60
        && countEarlyCloseActivities(dayActs, dayDate) >= 1
      ) {
        continue;
      }

      // Score: prefer days where this activity is geographically close to existing
      let geoScore = 0;
      if (dayActs.length > 0) {
        const centroidLat = dayActs.reduce((s, a) => s + a.latitude, 0) / dayActs.length;
        const centroidLng = dayActs.reduce((s, a) => s + a.longitude, 0) / dayActs.length;
        const dist = calculateDistance(activity.latitude, activity.longitude, centroidLat, centroidLng);
        geoScore = -dist; // closer is better
      } else {
        // Empty day: prefer closer to city center
        const dist = calculateDistance(activity.latitude, activity.longitude, cityCenter.lat, cityCenter.lng);
        geoScore = -dist * 0.5; // less weight for first activity
      }

      // Prefer arrival day for close-to-hotel activities, departure for wrap-up
      let roleBonus = 0;
      if (rescueStage < 1) {
        if (slot.role === 'arrival' && dayActs.length < 2) roleBonus = 1;
        if (slot.role === 'departure' && dayActs.length < 2) roleBonus = 1;
      }

      const score = geoScore + roleBonus;
      if (score > bestScore) {
        bestScore = score;
        bestDay = i;
      }
    }

    if (bestDay >= 0) {
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
  startDate?: Date
): { assignments: ScoredActivity[][]; usedBeam: boolean; fellBackToGreedy: boolean } {
  const t0 = Date.now();

  const makeState = (assignments: ScoredActivity[][]): BeamState => ({
    assignments,
    penalties: computePenalties(
      { assignments, penalties: emptyPenalties(), stableTieBreakKey: '' },
      slots, allMustSeeIds, allProtectedIds, cityCenter, densityProfile, rescueStage, startDate
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
            if (!canActivityFitDayWindow(activity, toSlot, toDayDate)) continue;

            // Check capacity
            const toDayActs = state.assignments[toDay];
            if (toDayActs.length >= getSlotMaxActivities(toSlot)) continue;
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
            if (compareStatesWithStage(newState, state, rescueStage) < 0) {
              candidates.push(newState);
              expansions++;
            }
          }
        }
      }
    }

    if (candidates.length === 0) break;

    // Merge beam + candidates, keep top BEAM_WIDTH
    const merged = [...beam, ...candidates].sort((left, right) => compareStatesWithStage(left, right, rescueStage));
    beam = merged.slice(0, BEAM_WIDTH);
    improved = true;
  }

  const best = beam[0];
  const wasImproved = improved && compareStatesWithStage(best, baselineState, rescueStage) < 0;
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
  options: { rescueStage?: V31RescueStage; startDate?: Date } = {}
): PlannerV31Result {
  const rescueStage = options.rescueStage ?? 0;
  const startDate = options.startDate;
  // 1. Assign day roles
  const slots = assignDayRoles(numDays, timeWindows, dayTripPacks);
  console.log(
    `[Planner V3.1] Day roles: ${slots.map(s => `D${s.dayNumber}=${s.role}(${s.windowMin}min)`).join(', ')}`
  );

  // 2. Must-see IDs for penalty computation
  const allMustSeeIds = new Set(
    cityActivities.filter(a => a.mustSee).map(a => a.id || a.name)
  );
  const allProtectedIds = new Set(
    cityActivities
      .filter(a => a.protectedReason || a.mustSee)
      .map(a => a.id || a.name)
  );

  // 3. Greedy baseline
  const greedy = greedyAssign(cityActivities, slots, cityCenter, rescueStage, startDate);

  // 4. Beam search improvement
  const { assignments, usedBeam, fellBackToGreedy } = beamSearch(
    greedy, slots, allMustSeeIds, allProtectedIds, cityCenter, densityProfile, rescueStage, startDate
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
      // Find the corresponding DayTripPack
      const packIdx = slots.slice(0, i + 1).filter(s => s.role === 'day_trip').length - 1;
      const pack = dayTripPacks[packIdx];
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
