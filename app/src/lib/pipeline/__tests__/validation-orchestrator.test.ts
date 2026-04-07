import { runValidationTasks } from '../utils/validation-orchestrator';

describe('validation orchestrator', () => {
  it('dedupes tasks by key and keeps provider stats', async () => {
    let calls = 0;
    const result = await runValidationTasks([
      {
        key: 'poi:a',
        provider: 'coords',
        run: async () => {
          calls += 1;
          return 'A';
        },
      },
      {
        key: 'poi:a',
        provider: 'coords',
        run: async () => {
          calls += 1;
          return 'A-duplicate';
        },
      },
      {
        key: 'poi:b',
        provider: 'coords',
        run: async () => {
          calls += 1;
          return 'B';
        },
      },
    ]);

    expect(calls).toBe(2);
    expect(result.settledByKey.size).toBe(2);
    expect(result.parallelismStats.deduped).toBe(1);
    expect(result.providerCallBreakdown.coords.scheduled).toBe(3);
    expect(result.providerCallBreakdown.coords.executed).toBe(2);
    expect(result.providerCallBreakdown.coords.deduped).toBe(1);
  });

  it('retries failing tasks with backoff before succeeding', async () => {
    let attempt = 0;
    const result = await runValidationTasks(
      [
        {
          key: 'retry:key',
          provider: 'coords',
          run: async () => {
            attempt += 1;
            if (attempt < 2) throw new Error('transient');
            return 42;
          },
        },
      ],
      { maxRetries: 2, baseBackoffMs: 1 }
    );

    const settled = result.settledByKey.get('retry:key');
    expect(attempt).toBe(2);
    expect(settled?.status).toBe('fulfilled');
    expect(result.providerCallBreakdown.coords.retries).toBe(1);
    expect(result.parallelismStats.retries).toBe(1);
  });

  it('respects provider concurrency caps', async () => {
    let inFlight = 0;
    let maxSeen = 0;

    const tasks = Array.from({ length: 6 }, (_, index) => ({
      key: `task:${index}`,
      provider: 'coords',
      run: async () => {
        inFlight += 1;
        maxSeen = Math.max(maxSeen, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 8));
        inFlight -= 1;
        return index;
      },
    }));

    const result = await runValidationTasks(tasks, {
      defaultConcurrency: 2,
      providerConcurrency: { coords: 2 },
    });

    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(result.parallelismStats.maxInFlightByProvider.coords).toBeLessThanOrEqual(2);
  });
});
