export interface FeedTripBase {
  id: string;
  title: string | null;
  name: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  visibility: 'public' | 'friends' | 'private' | null;
  created_at: string;
  preferences: unknown;
  owner_id: string;
}

export function toFeedTripPublicPayload(trip: FeedTripBase): FeedTripBase {
  const {
    id,
    title,
    name,
    destination,
    start_date,
    end_date,
    duration_days,
    visibility,
    created_at,
    preferences,
    owner_id,
  } = trip;

  return {
    id,
    title,
    name,
    destination,
    start_date,
    end_date,
    duration_days,
    visibility,
    created_at,
    preferences,
    owner_id,
  };
}
