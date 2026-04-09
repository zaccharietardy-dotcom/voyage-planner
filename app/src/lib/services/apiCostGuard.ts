/**
 * API Cost Guard — hard cap on Google API spending per pipeline run.
 * Tracks estimated cost of each API call and throws when budget exceeded.
 */

const ABSOLUTE_HARD_CAP_EUR = parseFloat(process.env.API_BUDGET_EUR || '0.50');

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
let blockedCalls: Record<string, number> = {};
let runBudgetProfile: BudgetProfile = 'dense';

export class ApiBudgetExceededError extends Error {
  readonly reasonCode = 'budget_over_burst_cap';
  readonly profile: BudgetProfile;
  readonly hardCapEur: number;
  readonly burstCapEur: number;
  readonly targetEur: number;
  readonly currentCostEur: number;
  readonly attemptedCostEur: number;
  readonly callType: string;

  constructor(
    callType: string,
    currentCost: number,
    attemptedCost: number,
    limits: { profile: BudgetProfile; hardCapEur: number; burstCapEur: number; targetEur: number },
  ) {
    super(
      `[API Cost Guard] budget_over_burst_cap (profile=${limits.profile}) ` +
      `current=€${currentCost.toFixed(3)} attempted=€${attemptedCost.toFixed(3)} ` +
      `hardCap=€${limits.hardCapEur.toFixed(3)} burst=€${limits.burstCapEur.toFixed(3)} ` +
      `target=€${limits.targetEur.toFixed(3)} blocked=${callType}. ` +
      `Breakdown: ${JSON.stringify(callCounts)}`
    );
    this.name = 'ApiBudgetExceededError';
    this.profile = limits.profile;
    this.hardCapEur = limits.hardCapEur;
    this.burstCapEur = limits.burstCapEur;
    this.targetEur = limits.targetEur;
    this.currentCostEur = currentCost;
    this.attemptedCostEur = attemptedCost;
    this.callType = callType;
  }
}

export class ApiBudgetSoftLimitBlockedError extends Error {
  readonly reasonCode = 'budget_over_target_soft_block';
  readonly profile: BudgetProfile;
  readonly targetEur: number;
  readonly currentCostEur: number;
  readonly attemptedCostEur: number;
  readonly callType: string;

  constructor(
    callType: string,
    currentCost: number,
    attemptedCost: number,
    limits: { profile: BudgetProfile; targetEur: number },
  ) {
    super(
      `[API Cost Guard] budget_over_target_soft_block (profile=${limits.profile}) ` +
      `current=€${currentCost.toFixed(3)} attempted=€${attemptedCost.toFixed(3)} ` +
      `target=€${limits.targetEur.toFixed(3)} blocked=${callType}`
    );
    this.name = 'ApiBudgetSoftLimitBlockedError';
    this.profile = limits.profile;
    this.targetEur = limits.targetEur;
    this.currentCostEur = currentCost;
    this.attemptedCostEur = attemptedCost;
    this.callType = callType;
  }
}

const NON_CRITICAL_CALLS = new Set<string>([
  'places-details',
  'places-details-legacy',
  'directions',
]);

function resolveBudgetLimits(profile: BudgetProfile): {
  profile: BudgetProfile;
  targetEur: number;
  burstCapEur: number;
  hardCapEur: number;
} {
  const profileBudget = BUDGET_TARGETS[profile];
  return {
    profile,
    targetEur: profileBudget.targetEur,
    burstCapEur: profileBudget.burstCapEur,
    hardCapEur: Math.min(ABSOLUTE_HARD_CAP_EUR, profileBudget.burstCapEur),
  };
}

function registerBlockedCall(label: string): void {
  blockedCalls[label] = (blockedCalls[label] || 0) + 1;
}

/**
 * Call BEFORE every Google API request. Throws if budget would be exceeded.
 */
export function trackApiCost(callType: ApiCallType, options?: { critical?: boolean }): void {
  const limits = resolveBudgetLimits(runBudgetProfile);
  const cost = COST_PER_REQUEST[callType];
  const attemptedCost = totalCostEur + cost;
  if (attemptedCost > limits.hardCapEur) {
    throw new ApiBudgetExceededError(callType, totalCostEur, attemptedCost, limits);
  }

  const critical = options?.critical ?? !NON_CRITICAL_CALLS.has(callType);
  if (!critical && attemptedCost > limits.targetEur) {
    registerBlockedCall(callType);
    throw new ApiBudgetSoftLimitBlockedError(callType, totalCostEur, attemptedCost, limits);
  }
  totalCostEur = attemptedCost;
  callCounts[callType] = (callCounts[callType] || 0) + 1;
}

/**
 * Track custom estimated costs (e.g. LLM architect calls) in the same run-level ledger.
 */
export function trackEstimatedCost(
  label: string,
  amountEur: number,
  options?: { critical?: boolean },
): void {
  const limits = resolveBudgetLimits(runBudgetProfile);
  const amount = Math.max(0, amountEur);
  if (amount === 0) return;
  const attemptedCost = totalCostEur + amount;
  if (attemptedCost > limits.hardCapEur) {
    throw new ApiBudgetExceededError(label, totalCostEur, attemptedCost, limits);
  }
  const critical = options?.critical ?? true;
  if (!critical && attemptedCost > limits.targetEur) {
    registerBlockedCall(label);
    throw new ApiBudgetSoftLimitBlockedError(label, totalCostEur, attemptedCost, limits);
  }
  totalCostEur = attemptedCost;
  callCounts[label] = (callCounts[label] || 0) + 1;
}

export function setRunBudgetProfile(profile: BudgetProfile): void {
  runBudgetProfile = profile;
}

export function getApiCostSummary(): {
  totalEur: number;
  budget: number;
  hardCapEur: number;
  calls: Record<string, number>;
  blockedCalls: Record<string, number>;
  profile: BudgetProfile;
  targetEur: number;
  burstCapEur: number;
  overTarget: boolean;
  overBurstCap: boolean;
} {
  const limits = resolveBudgetLimits(runBudgetProfile);
  const rounded = Math.round(totalCostEur * 1000) / 1000;
  return {
    totalEur: rounded,
    budget: limits.hardCapEur,
    hardCapEur: limits.hardCapEur,
    calls: { ...callCounts },
    blockedCalls: { ...blockedCalls },
    profile: runBudgetProfile,
    targetEur: limits.targetEur,
    burstCapEur: limits.burstCapEur,
    overTarget: rounded > limits.targetEur,
    overBurstCap: rounded > limits.burstCapEur || rounded > limits.hardCapEur,
  };
}

export function getBudgetPolicySnapshot(profile?: BudgetProfile): {
  profile: BudgetProfile;
  targetEur: number;
  burstCapEur: number;
  hardCapEur: number;
  absoluteHardCapEur: number;
} {
  const resolvedProfile = profile || runBudgetProfile;
  const limits = resolveBudgetLimits(resolvedProfile);
  return {
    profile: limits.profile,
    targetEur: limits.targetEur,
    burstCapEur: limits.burstCapEur,
    hardCapEur: limits.hardCapEur,
    absoluteHardCapEur: ABSOLUTE_HARD_CAP_EUR,
  };
}

export function isApiBudgetExceededError(error: unknown): error is ApiBudgetExceededError {
  return error instanceof ApiBudgetExceededError;
}

export function isApiBudgetSoftLimitError(error: unknown): error is ApiBudgetSoftLimitBlockedError {
  return error instanceof ApiBudgetSoftLimitBlockedError;
}

export function resetApiCostTracker(): void {
  totalCostEur = 0;
  callCounts = {};
  blockedCalls = {};
  runBudgetProfile = 'dense';
}
