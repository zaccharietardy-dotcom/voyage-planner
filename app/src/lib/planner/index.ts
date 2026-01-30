/**
 * Planner Module - Architecture modulaire de planification de voyage
 *
 * Remplace la logique monolithique de generateDayWithScheduler dans ai.ts
 */

export { TripPlanner } from './TripPlanner';
export type { TripPlannerConfig } from './TripPlanner';
export { LogisticsHandler } from './LogisticsHandler';
export { MealScheduler } from './MealScheduler';
export type { RestaurantFinder, MealResult } from './MealScheduler';
export { ActivityPlanner } from './ActivityPlanner';
export { ClaudeAdvisor } from './ClaudeAdvisor';
export { applyFallbackRules } from './FallbackRules';
export { BudgetTracker } from './BudgetTracker';
export type { BudgetCategory, BudgetBreakdown } from './BudgetTracker';
export type {
  DayType,
  TravelerState,
  PlannerContext,
  DayResult,
  DayParams,
  LateFlightData,
  LogisticsResult,
  AdvisorRequest,
  AdvisorResponse,
} from './types';
