export interface BoundedCacheOptions {
  maxEntries: number;
  ttlMs: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class BoundedTtlCache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(options: BoundedCacheOptions) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = Math.max(1, options.ttlMs);
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Touch key to keep insertion order aligned with LRU policy.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  size(): number {
    return this.store.size;
  }
}
