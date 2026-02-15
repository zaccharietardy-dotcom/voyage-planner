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

