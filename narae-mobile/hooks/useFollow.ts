import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
  followUser as apiFollow,
  unfollowUser as apiUnfollow,
  fetchFollowers,
  fetchFollowing,
  fetchUserStats,
  type FollowUser,
  type UserStats,
} from '@/lib/api/social';

interface UseFollowResult {
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  followers: FollowUser[];
  following: FollowUser[];
  stats: UserStats | null;
  isLoading: boolean;
  toggleFollow: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useFollow(targetUserId: string): UseFollowResult {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!targetUserId) return;
    setIsLoading(true);
    try {
      const [followersRes, followingRes, statsRes] = await Promise.all([
        fetchFollowers(targetUserId),
        fetchFollowing(targetUserId),
        fetchUserStats(targetUserId).catch(() => null),
      ]);
      setFollowers(followersRes);
      setFollowing(followingRes);
      setFollowerCount(statsRes?.followerCount ?? followersRes.length);
      setFollowingCount(statsRes?.followingCount ?? followingRes.length);
      setStats(statsRes);
      if (user) {
        setIsFollowing(followersRes.some((f) => f.id === user.id));
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleFollow = useCallback(async () => {
    if (!user) return;
    const wasFollowing = isFollowing;
    // Optimistic
    setIsFollowing(!wasFollowing);
    setFollowerCount((c) => (wasFollowing ? c - 1 : c + 1));
    try {
      if (wasFollowing) {
        await apiUnfollow(targetUserId);
      } else {
        await apiFollow(targetUserId);
      }
    } catch {
      // Revert
      setIsFollowing(wasFollowing);
      setFollowerCount((c) => (wasFollowing ? c + 1 : c - 1));
    }
  }, [user, isFollowing, targetUserId]);

  return {
    isFollowing,
    followerCount,
    followingCount,
    followers,
    following,
    stats,
    isLoading,
    toggleFollow,
    refetch: fetchData,
  };
}
