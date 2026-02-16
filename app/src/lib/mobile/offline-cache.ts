const TRIPS_CACHE_KEY = 'voyage-offline-trips-v1';
const TRIP_CACHE_PREFIX = 'voyage-offline-trip-v1:';
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

interface CacheEnvelope<T> {
  savedAt: number;
  data: T;
}

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > MAX_CACHE_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CacheEnvelope<T> = {
      savedAt: Date.now(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / serialization errors.
  }
}

export function cacheTripsList<T>(trips: T[]): void {
  writeEnvelope(TRIPS_CACHE_KEY, trips);
}

export function readCachedTripsList<T>(): T[] {
  return readEnvelope<T[]>(TRIPS_CACHE_KEY)?.data || [];
}

export function cacheTripById<T>(tripId: string, trip: T): void {
  writeEnvelope(`${TRIP_CACHE_PREFIX}${tripId}`, trip);
}

export function readCachedTripById<T>(tripId: string): T | null {
  return readEnvelope<T>(`${TRIP_CACHE_PREFIX}${tripId}`)?.data || null;
}
