'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { FollowButton } from '@/components/social/FollowButton';

interface RecommendedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  trips_count: number;
}

export function RecommendedUsers() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<RecommendedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchRecommendations = async () => {
      try {
        const res = await fetch('/api/users/recommendations?limit=5');
        if (res.ok) setUsers(await res.json());
      } catch (e) {
        console.error('Error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRecommendations();
  }, [user]);

  if (!user || isLoading || users.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white/70 flex items-center gap-2">
        <UserPlus className="h-4 w-4" />
        Voyageurs à suivre
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-col items-center gap-2 min-w-[100px] bg-white/10 backdrop-blur-sm rounded-xl p-3"
          >
            <button onClick={() => router.push(`/user/${u.id}`)}>
              <Avatar className="h-14 w-14 border-2 border-white/20">
                <AvatarImage src={u.avatar_url || undefined} />
                <AvatarFallback className="text-lg">
                  {(u.display_name || '?')[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
            <button
              onClick={() => router.push(`/user/${u.id}`)}
              className="text-white text-xs font-medium text-center truncate w-full"
            >
              {u.display_name || u.username || 'Voyageur'}
            </button>
            <span className="text-white/50 text-[10px] flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {u.trips_count} voyages
            </span>
            <FollowButton
              userId={u.id}
              initialIsFollowing={false}
              initialIsCloseFriend={false}
              size="sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
