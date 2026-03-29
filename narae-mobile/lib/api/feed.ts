import { api } from './client';

export interface FeedTrip {
  id: string;
  title: string | null;
  destination: string;
  start_date: string;
  duration_days: number;
  visibility: 'public' | 'friends' | 'private';
  cover_url: string | null;
  created_at: string;
  owner: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  likes_count: number;
  user_liked: boolean;
}

interface FeedResponse {
  trips: FeedTrip[];
  hasMore: boolean;
}

export async function fetchFeed(
  tab: 'discover' | 'following',
  page: number,
  sort: 'recent' | 'trending' = 'recent',
): Promise<FeedResponse> {
  return api.get<FeedResponse>(
    `/api/feed?tab=${tab}&page=${page}&limit=10&sort=${sort}`,
  );
}

export async function likeTrip(id: string): Promise<void> {
  await api.post(`/api/trips/${id}/like`);
}

export async function unlikeTrip(id: string): Promise<void> {
  await api.del(`/api/trips/${id}/like`);
}

export async function cloneTrip(id: string): Promise<{ id: string }> {
  return api.post<{ id: string }>(`/api/trips/${id}/clone`);
}
