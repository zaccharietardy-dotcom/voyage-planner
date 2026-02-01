'use client';

import { useState } from 'react';
import { UserPlus, UserCheck, Users, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface FollowButtonProps {
  userId: string;
  initialIsFollowing: boolean;
  initialIsCloseFriend: boolean;
  size?: 'sm' | 'default';
  onFollowChange?: (isFollowing: boolean) => void;
}

export function FollowButton({
  userId,
  initialIsFollowing,
  initialIsCloseFriend,
  size = 'default',
  onFollowChange,
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isCloseFriend, setIsCloseFriend] = useState(initialIsCloseFriend);
  const [loading, setLoading] = useState(false);

  const handleFollow = async () => {
    setLoading(true);
    const wasFollowing = isFollowing;
    try {
      if (isFollowing) {
        const res = await fetch(`/api/follows/${userId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Unfollow failed');
        setIsFollowing(false);
        setIsCloseFriend(false);
        onFollowChange?.(false);
      } else {
        const res = await fetch('/api/follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ following_id: userId }),
        });
        if (!res.ok) {
          // If 409 (already following), set state to true
          if (res.status === 409) {
            setIsFollowing(true);
            onFollowChange?.(true);
            return;
          }
          throw new Error('Follow failed');
        }
        setIsFollowing(true);
        onFollowChange?.(true);
      }
    } catch (e) {
      console.error('Follow error:', e);
      // Rollback state on error
      setIsFollowing(wasFollowing);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseFriendRequest = async () => {
    setLoading(true);
    try {
      await fetch('/api/close-friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: userId }),
      });
      setIsCloseFriend(true);
    } catch (e) {
      console.error('Close friend error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Button variant="outline" size={size} disabled>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </Button>
    );
  }

  if (isFollowing) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} className="gap-1.5">
            {isCloseFriend ? (
              <><Users className="w-3.5 h-3.5 text-primary" /> Ami proche</>
            ) : (
              <><UserCheck className="w-3.5 h-3.5 text-primary" /> Abonné</>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isCloseFriend && (
            <DropdownMenuItem onClick={handleCloseFriendRequest}>
              <Users className="w-4 h-4 mr-2" /> Demander ami proche
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleFollow} className="text-destructive">
            <UserPlus className="w-4 h-4 mr-2" /> Se désabonner
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button size={size} onClick={handleFollow} className="gap-1.5">
      <UserPlus className="w-3.5 h-3.5" /> Suivre
    </Button>
  );
}
