import type { TripDay, TripItem } from '../types/trip';

export type V31RescueStage = 0 | 1 | 2 | 3;
export type PlanningProtectedReason =
  | 'must_see'
  | 'day_trip_anchor'
  | 'day_trip'
  | 'user_forced';
export type PlannerRole = 'arrival' | 'full_city' | 'day_trip' | 'recovery' | 'departure' | 'short_full_day';

export interface PlanningMeta {
  planningToken?: string;
  protectedReason?: PlanningProtectedReason;
  sourcePackId?: string;
  plannerRole?: PlannerRole;
  originalDayNumber?: number;
}

const ROLE_COMPAT: Record<PlannerRole, PlannerRole[]> = {
  arrival: ['arrival', 'full_city', 'short_full_day'],
  departure: ['departure', 'full_city', 'short_full_day'],
  recovery: ['recovery', 'full_city'],
  full_city: ['full_city', 'recovery', 'short_full_day'],
  short_full_day: ['short_full_day', 'full_city'],
  day_trip: [],
};

export function getV31RescueStage(raw: string | undefined = process.env.V31_RESCUE_STAGE): V31RescueStage {
  const parsed = Number(raw);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return 0;
}

export function rescueStageAtLeast(stage: number | undefined, minimum: V31RescueStage): boolean {
  return (stage ?? 0) >= minimum;
}

export function isProtectedReason(reason?: string): reason is PlanningProtectedReason {
  return reason === 'must_see'
    || reason === 'day_trip_anchor'
    || reason === 'day_trip'
    || reason === 'user_forced';
}

export function isProtectedTripItem(item: Pick<TripItem, 'mustSee' | 'planningMeta'> | undefined | null): boolean {
  if (!item) return false;
  return !!item.mustSee || isProtectedReason(item.planningMeta?.protectedReason);
}

export function arePlannerRolesCompatible(from?: string, to?: string): boolean {
  if (!from || !to) return true;
  const fromRole = from as PlannerRole;
  const toRole = to as PlannerRole;
  return (ROLE_COMPAT[fromRole] || []).includes(toRole);
}

export function getDayPlannerRole(day: TripDay): PlannerRole | undefined {
  for (const item of day.items) {
    if (item.planningMeta?.plannerRole) return item.planningMeta.plannerRole;
  }
  return undefined;
}

export function stripPlanningMetaFromDays(days: TripDay[]): TripDay[] {
  return days.map((day) => ({
    ...day,
    items: day.items.map(({ planningMeta, ...item }) => item),
  }));
}
