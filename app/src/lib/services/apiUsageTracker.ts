export type SerpApiUsageSnapshot = {
  totalRequests: number;
  byEngine: Record<string, number>;
};

const serpApiUsage = {
  totalRequests: 0,
  byEngine: new Map<string, number>(),
};

export function trackSerpApiRequest(engine?: string): void {
  const normalizedEngine = (engine || 'unknown').trim() || 'unknown';
  serpApiUsage.totalRequests += 1;
  serpApiUsage.byEngine.set(
    normalizedEngine,
    (serpApiUsage.byEngine.get(normalizedEngine) || 0) + 1
  );
}

export function getSerpApiUsageSnapshot(): SerpApiUsageSnapshot {
  return {
    totalRequests: serpApiUsage.totalRequests,
    byEngine: Object.fromEntries(serpApiUsage.byEngine.entries()),
  };
}

export function diffSerpApiUsage(
  before: SerpApiUsageSnapshot,
  after: SerpApiUsageSnapshot
): SerpApiUsageSnapshot {
  const allKeys = new Set<string>([
    ...Object.keys(before.byEngine || {}),
    ...Object.keys(after.byEngine || {}),
  ]);

  const byEngine: Record<string, number> = {};
  for (const key of allKeys) {
    const delta = (after.byEngine[key] || 0) - (before.byEngine[key] || 0);
    if (delta > 0) byEngine[key] = delta;
  }

  return {
    totalRequests: Math.max(0, (after.totalRequests || 0) - (before.totalRequests || 0)),
    byEngine,
  };
}

// ============================================
// SerpAPI Quota Guard
// ============================================

const SERPAPI_WEEKLY_QUOTA = 300;
const SERPAPI_CRITICAL_THRESHOLD = 20; // Below this, only allow critical queries
const SERPAPI_WARNING_THRESHOLD = 50;  // Below this, log warnings

/**
 * Check if we have enough SerpAPI budget for the estimated number of calls.
 * Returns true if calls are allowed, false if quota would be exceeded.
 */
export function canUseSerpApi(estimatedCalls: number = 1): boolean {
  const remaining = SERPAPI_WEEKLY_QUOTA - serpApiUsage.totalRequests;

  if (remaining < SERPAPI_CRITICAL_THRESHOLD) {
    console.warn(`[SerpAPI Quota] ⚠️ CRITICAL: Only ${remaining} requests remaining (threshold: ${SERPAPI_CRITICAL_THRESHOLD}). Blocking non-critical calls.`);
    return false;
  }

  if (remaining < estimatedCalls) {
    console.warn(`[SerpAPI Quota] ⚠️ Insufficient budget: ${remaining} remaining, ${estimatedCalls} requested.`);
    return false;
  }

  if (remaining < SERPAPI_WARNING_THRESHOLD) {
    console.warn(`[SerpAPI Quota] ⚡ Warning: ${remaining} requests remaining this week.`);
  }

  return true;
}

/**
 * Get remaining SerpAPI quota for the current process run.
 */
export function getSerpApiRemainingQuota(): number {
  return Math.max(0, SERPAPI_WEEKLY_QUOTA - serpApiUsage.totalRequests);
}

/**
 * Check if we're in "critical quota" mode (only essential queries allowed).
 */
export function isSerpApiCriticalMode(): boolean {
  return (SERPAPI_WEEKLY_QUOTA - serpApiUsage.totalRequests) < SERPAPI_CRITICAL_THRESHOLD;
}

