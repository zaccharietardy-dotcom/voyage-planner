import { api } from './client';

export interface FollowUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username?: string;
  bio?: string;
  isFollowing?: boolean;
}

export interface UserStats {
  tripCount: number;
  countryCount: number;
  reviewCount: number;
  photoCount: number;
  followerCount: number;
  followingCount: number;
  likeCount: number;
  commentCount: number;
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  badges: string[];
  memberSince: string;
}

export async function fetchFollowers(userId: string): Promise<FollowUser[]> {
  const res = await api.get<{ users: FollowUser[] }>(
    `/api/follows?type=followers&user_id=${userId}`,
  );
  return res.users ?? [];
}

export async function fetchFollowing(userId: string): Promise<FollowUser[]> {
  const res = await api.get<{ users: FollowUser[] }>(
    `/api/follows?type=following&user_id=${userId}`,
  );
  return res.users ?? [];
}

export async function followUser(followingId: string): Promise<void> {
  await api.post('/api/follows', { followingId });
}

export async function unfollowUser(followingId: string): Promise<void> {
  await api.del(`/api/follows?followingId=${followingId}`);
}

export async function searchUsers(query: string): Promise<FollowUser[]> {
  if (query.length < 2) return [];
  const res = await api.get<{ users: FollowUser[] }>(
    `/api/users/search?q=${encodeURIComponent(query)}`,
  );
  return res.users ?? [];
}

export async function fetchUserStats(userId: string): Promise<UserStats> {
  return api.get<UserStats>(`/api/users/${userId}/stats`);
}

export async function fetchRecommendedUsers(): Promise<FollowUser[]> {
  const res = await api.get<{ users: FollowUser[] }>('/api/users/recommendations');
  return res.users ?? [];
}
