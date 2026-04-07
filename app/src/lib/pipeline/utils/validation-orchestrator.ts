export interface ValidationTask<T> {
  key: string;
  provider: string;
  run: () => Promise<T>;
}

export interface ValidationProviderCallStats {
  scheduled: number;
  executed: number;
  deduped: number;
  succeeded: number;
  failed: number;
  retries: number;
}

export interface ValidationParallelismStats {
  scheduled: number;
  deduped: number;
  settled: number;
  fulfilled: number;
  rejected: number;
  retries: number;
  maxInFlight: number;
  maxInFlightByProvider: Record<string, number>;
}

export interface ValidationRunResult<T> {
  settledByKey: Map<string, PromiseSettledResult<T>>;
  latencyMs: number;
  providerCallBreakdown: Record<string, ValidationProviderCallStats>;
  parallelismStats: ValidationParallelismStats;
}

export interface ValidationRunOptions {
  defaultConcurrency?: number;
  providerConcurrency?: Record<string, number>;
  maxRetries?: number;
  baseBackoffMs?: number;
  hardCapMs?: number;
}

const DEFAULT_OPTIONS: Required<ValidationRunOptions> = {
  defaultConcurrency: 6,
  providerConcurrency: {},
  maxRetries: 1,
  baseBackoffMs: 150,
  hardCapMs: 180_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLimiter(maxConcurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  };
}

function getProviderStats(
  providerCallBreakdown: Record<string, ValidationProviderCallStats>,
  provider: string
): ValidationProviderCallStats {
  if (!providerCallBreakdown[provider]) {
    providerCallBreakdown[provider] = {
      scheduled: 0,
      executed: 0,
      deduped: 0,
      succeeded: 0,
      failed: 0,
      retries: 0,
    };
  }
  return providerCallBreakdown[provider];
}

export async function runValidationTasks<T>(
  tasks: ValidationTask<T>[],
  options: ValidationRunOptions = {}
): Promise<ValidationRunResult<T>> {
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
    providerConcurrency: {
      ...DEFAULT_OPTIONS.providerConcurrency,
      ...(options.providerConcurrency || {}),
    },
  };

  const startedAt = Date.now();
  const providerCallBreakdown: Record<string, ValidationProviderCallStats> = {};
  const parallelismStats: ValidationParallelismStats = {
    scheduled: tasks.length,
    deduped: 0,
    settled: 0,
    fulfilled: 0,
    rejected: 0,
    retries: 0,
    maxInFlight: 0,
    maxInFlightByProvider: {},
  };

  if (tasks.length === 0) {
    return {
      settledByKey: new Map(),
      latencyMs: 0,
      providerCallBreakdown,
      parallelismStats,
    };
  }

  const uniqueTasks = new Map<string, ValidationTask<T>>();
  for (const task of tasks) {
    const providerStats = getProviderStats(providerCallBreakdown, task.provider);
    providerStats.scheduled += 1;
    if (uniqueTasks.has(task.key)) {
      providerStats.deduped += 1;
      parallelismStats.deduped += 1;
      continue;
    }
    uniqueTasks.set(task.key, task);
  }

  const limiters = new Map<string, <V>(fn: () => Promise<V>) => Promise<V>>();
  const getLimiter = (provider: string) => {
    if (limiters.has(provider)) return limiters.get(provider)!;
    const maxConcurrency = Math.max(
      1,
      config.providerConcurrency[provider] ?? config.defaultConcurrency
    );
    const limiter = createLimiter(maxConcurrency);
    limiters.set(provider, limiter);
    return limiter;
  };

  let activeGlobal = 0;
  const activeByProvider = new Map<string, number>();

  const runTaskWithRetry = async (task: ValidationTask<T>): Promise<T> => {
    const providerStats = getProviderStats(providerCallBreakdown, task.provider);
    providerStats.executed += 1;

    let attempt = 0;
    while (true) {
      if (Date.now() - startedAt > config.hardCapMs) {
        providerStats.failed += 1;
        throw new Error(`[ValidationOrchestrator] hard cap exceeded (${config.hardCapMs}ms)`);
      }
      try {
        const value = await task.run();
        providerStats.succeeded += 1;
        return value;
      } catch (error) {
        if (attempt >= config.maxRetries) {
          providerStats.failed += 1;
          throw error;
        }
        attempt += 1;
        providerStats.retries += 1;
        parallelismStats.retries += 1;
        const delay = config.baseBackoffMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  };

  const scheduledTasks = Array.from(uniqueTasks.values()).map(async (task) => {
    const limiter = getLimiter(task.provider);
    const settled = await limiter(async () => {
      activeGlobal += 1;
      const providerActive = (activeByProvider.get(task.provider) || 0) + 1;
      activeByProvider.set(task.provider, providerActive);

      parallelismStats.maxInFlight = Math.max(parallelismStats.maxInFlight, activeGlobal);
      const providerPeak = parallelismStats.maxInFlightByProvider[task.provider] || 0;
      parallelismStats.maxInFlightByProvider[task.provider] = Math.max(providerPeak, providerActive);

      try {
        const value = await runTaskWithRetry(task);
        return { status: 'fulfilled', value } as PromiseFulfilledResult<T>;
      } catch (reason) {
        return { status: 'rejected', reason } as PromiseRejectedResult;
      } finally {
        activeGlobal -= 1;
        const nextProviderActive = (activeByProvider.get(task.provider) || 1) - 1;
        if (nextProviderActive <= 0) {
          activeByProvider.delete(task.provider);
        } else {
          activeByProvider.set(task.provider, nextProviderActive);
        }
      }
    });
    return { key: task.key, settled };
  });

  const settledByKey = new Map<string, PromiseSettledResult<T>>();
  const settledRecords = await Promise.all(scheduledTasks);
  for (const record of settledRecords) {
    settledByKey.set(record.key, record.settled);
    parallelismStats.settled += 1;
    if (record.settled.status === 'fulfilled') parallelismStats.fulfilled += 1;
    else parallelismStats.rejected += 1;
  }

  return {
    settledByKey,
    latencyMs: Date.now() - startedAt,
    providerCallBreakdown,
    parallelismStats,
  };
}

export function mergeValidationProviderBreakdowns(
  breakdowns: Array<Record<string, ValidationProviderCallStats> | undefined>
): Record<string, ValidationProviderCallStats> {
  const merged: Record<string, ValidationProviderCallStats> = {};
  for (const breakdown of breakdowns) {
    if (!breakdown) continue;
    for (const [provider, stats] of Object.entries(breakdown)) {
      if (!merged[provider]) {
        merged[provider] = {
          scheduled: 0,
          executed: 0,
          deduped: 0,
          succeeded: 0,
          failed: 0,
          retries: 0,
        };
      }
      merged[provider].scheduled += stats.scheduled;
      merged[provider].executed += stats.executed;
      merged[provider].deduped += stats.deduped;
      merged[provider].succeeded += stats.succeeded;
      merged[provider].failed += stats.failed;
      merged[provider].retries += stats.retries;
    }
  }
  return merged;
}

export function mergeValidationParallelismStats(
  statsList: Array<ValidationParallelismStats | undefined>
): ValidationParallelismStats {
  const merged: ValidationParallelismStats = {
    scheduled: 0,
    deduped: 0,
    settled: 0,
    fulfilled: 0,
    rejected: 0,
    retries: 0,
    maxInFlight: 0,
    maxInFlightByProvider: {},
  };

  for (const stats of statsList) {
    if (!stats) continue;
    merged.scheduled += stats.scheduled;
    merged.deduped += stats.deduped;
    merged.settled += stats.settled;
    merged.fulfilled += stats.fulfilled;
    merged.rejected += stats.rejected;
    merged.retries += stats.retries;
    merged.maxInFlight = Math.max(merged.maxInFlight, stats.maxInFlight);
    for (const [provider, peak] of Object.entries(stats.maxInFlightByProvider || {})) {
      merged.maxInFlightByProvider[provider] = Math.max(
        merged.maxInFlightByProvider[provider] || 0,
        peak
      );
    }
  }

  return merged;
}
