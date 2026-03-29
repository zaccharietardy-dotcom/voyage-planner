import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TripRow, TripListItem } from '@/lib/api/trips';

const INDEX_KEY = '@narae/trip-index';
const TRIP_PREFIX = '@narae/trip/';

// ─── Index (list of cached trip summaries) ───

export async function getCachedTripIndex(): Promise<TripListItem[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function updateIndex(trips: TripListItem[]) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(trips));
}

// ─── Cache a full trip ───

export async function cacheTripLocally(tripRow: TripRow): Promise<void> {
  // Save full trip data
  await AsyncStorage.setItem(`${TRIP_PREFIX}${tripRow.id}`, JSON.stringify(tripRow));

  // Update index
  const index = await getCachedTripIndex();
  const existing = index.findIndex((t) => t.id === tripRow.id);
  const summary: TripListItem = {
    id: tripRow.id,
    name: tripRow.name,
    title: tripRow.title,
    destination: tripRow.destination,
    start_date: tripRow.start_date,
    end_date: tripRow.end_date,
    duration_days: tripRow.duration_days,
    preferences: tripRow.preferences,
    visibility: tripRow.visibility,
    created_at: tripRow.created_at,
    updated_at: tripRow.updated_at,
    owner_id: tripRow.owner_id,
  };

  if (existing >= 0) {
    index[existing] = summary;
  } else {
    index.unshift(summary);
  }

  await updateIndex(index);
}

// ─── Read cached trip ───

export async function getCachedTrip(id: string): Promise<TripRow | null> {
  try {
    const raw = await AsyncStorage.getItem(`${TRIP_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Check if trip is cached ───

export async function isTripCached(id: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(`${TRIP_PREFIX}${id}`);
  return raw !== null;
}

// ─── Cache all user trips (for offline list) ───

export async function cacheAllTrips(trips: TripListItem[]): Promise<void> {
  await updateIndex(trips);
}

// ─── Remove cached trip ───

export async function removeCachedTrip(id: string): Promise<void> {
  await AsyncStorage.removeItem(`${TRIP_PREFIX}${id}`);
  const index = await getCachedTripIndex();
  await updateIndex(index.filter((t) => t.id !== id));
}
