/**
 * API Cost Guard — hard cap on Google API spending per pipeline run.
 * Tracks estimated cost of each API call and throws when budget exceeded.
 */

const BUDGET_EUR = parseFloat(process.env.API_BUDGET_EUR || '5');

// Estimated cost per request (EUR, based on Google Maps Platform pricing)
const COST_PER_REQUEST = {
  'places-text-search': 0.032,     // Places (New) Text Search
  'places-nearby-search': 0.032,   // Places (New) Nearby Search
  'places-details': 0.017,         // Places Details (Basic fields)
  'places-text-search-legacy': 0.032, // Places (Legacy) Text Search
  'places-details-legacy': 0.017,  // Places (Legacy) Details
  'directions': 0.005,             // Directions API
} as const;

export type ApiCallType = keyof typeof COST_PER_REQUEST;

let totalCostEur = 0;
let callCounts: Record<string, number> = {};

export class ApiBudgetExceededError extends Error {
  constructor(callType: ApiCallType, currentCost: number, budget: number) {
    super(
      `[API Cost Guard] Budget exceeded! Current: €${currentCost.toFixed(2)}, ` +
      `limit: €${budget.toFixed(2)}. Blocked call: ${callType}. ` +
      `Breakdown: ${JSON.stringify(callCounts)}`
    );
    this.name = 'ApiBudgetExceededError';
  }
}

/**
 * Call BEFORE every Google API request. Throws if budget would be exceeded.
 */
export function trackApiCost(callType: ApiCallType): void {
  const cost = COST_PER_REQUEST[callType];
  if (totalCostEur + cost > BUDGET_EUR) {
    throw new ApiBudgetExceededError(callType, totalCostEur, BUDGET_EUR);
  }
  totalCostEur += cost;
  callCounts[callType] = (callCounts[callType] || 0) + 1;
}

export function getApiCostSummary(): { totalEur: number; budget: number; calls: Record<string, number> } {
  return { totalEur: Math.round(totalCostEur * 1000) / 1000, budget: BUDGET_EUR, calls: { ...callCounts } };
}

export function resetApiCostTracker(): void {
  totalCostEur = 0;
  callCounts = {};
}
