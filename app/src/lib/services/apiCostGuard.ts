/**
 * API Cost Guard — hard cap on Google API spending per pipeline run.
 * Tracks estimated cost of each API call and throws when budget exceeded.
 */

const BUDGET_EUR = parseFloat(process.env.API_BUDGET_EUR || '5');

type BudgetProfile = 'dense' | 'medium' | 'spread';
const BUDGET_TARGETS: Record<BudgetProfile, { targetEur: number; burstCapEur: number }> = {
  dense: { targetEur: 0.12, burstCapEur: 0.20 },
  medium: { targetEur: 0.18, burstCapEur: 0.35 },
  spread: { targetEur: 0.25, burstCapEur: 0.50 },
};

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
let runBudgetProfile: BudgetProfile = 'dense';

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

/**
 * Track custom estimated costs (e.g. LLM architect calls) in the same run-level ledger.
 */
export function trackEstimatedCost(label: string, amountEur: number): void {
  const amount = Math.max(0, amountEur);
  if (amount === 0) return;
  totalCostEur += amount;
  callCounts[label] = (callCounts[label] || 0) + 1;
}

export function setRunBudgetProfile(profile: BudgetProfile): void {
  runBudgetProfile = profile;
}

export function getApiCostSummary(): {
  totalEur: number;
  budget: number;
  calls: Record<string, number>;
  profile: BudgetProfile;
  targetEur: number;
  burstCapEur: number;
  overTarget: boolean;
  overBurstCap: boolean;
} {
  const profileBudget = BUDGET_TARGETS[runBudgetProfile];
  const rounded = Math.round(totalCostEur * 1000) / 1000;
  return {
    totalEur: rounded,
    budget: BUDGET_EUR,
    calls: { ...callCounts },
    profile: runBudgetProfile,
    targetEur: profileBudget.targetEur,
    burstCapEur: profileBudget.burstCapEur,
    overTarget: rounded > profileBudget.targetEur,
    overBurstCap: rounded > profileBudget.burstCapEur,
  };
}

export function resetApiCostTracker(): void {
  totalCostEur = 0;
  callCounts = {};
  runBudgetProfile = 'dense';
}
