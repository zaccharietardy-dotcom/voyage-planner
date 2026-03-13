import { BoundedTtlCache } from '@/lib/server/boundedCache';

describe('BoundedTtlCache', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('evicts least recently used entries when max size is reached', () => {
    const cache = new BoundedTtlCache<number>({ maxEntries: 2, ttlMs: 60_000 });

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // Touch a (a becomes most recently used)

    cache.set('c', 3); // Should evict b

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBe(3);
  });

  it('expires entries after ttl', () => {
    jest.useFakeTimers();
    const cache = new BoundedTtlCache<number>({ maxEntries: 2, ttlMs: 1000 });

    cache.set('x', 42);
    jest.advanceTimersByTime(1001);

    expect(cache.get('x')).toBeNull();
  });
});
