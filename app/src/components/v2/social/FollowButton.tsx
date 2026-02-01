'use client';

import { useState } from 'react';
import { UserPlus, UserCheck, Users, Loader2 } from 'lucide-react';

interface FollowButtonProps {
  userId: string;
  initialIsFollowing: boolean;
  initialIsCloseFriend: boolean;
  size?: 'sm' | 'md';
  onFollowChange?: (isFollowing: boolean) => void;
}

export function FollowButton({
  userId,
  initialIsFollowing,
  initialIsCloseFriend,
  size = 'md',
  onFollowChange,
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isCloseFriend, setIsCloseFriend] = useState(initialIsCloseFriend);
  const [loading, setLoading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const handleFollow = async () => {
    setLoading(true);
    try {
      if (isFollowing) {
        await fetch(`/api/follows/${userId}`, { method: 'DELETE' });
        setIsFollowing(false);
        setIsCloseFriend(false);
        onFollowChange?.(false);
      } else {
        await fetch('/api/follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ following_id: userId }),
        });
        setIsFollowing(true);
        onFollowChange?.(true);
      }
    } catch (e) {
      console.error('Follow error:', e);
    } finally {
      setLoading(false);
      setShowMenu(false);
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
      setShowMenu(false);
    }
  };

  const sizeClasses = size === 'sm'
    ? 'px-3 py-1.5 text-xs gap-1'
    : 'px-4 py-2 text-sm gap-1.5';

  if (loading) {
    return (
      <button disabled className={`${sizeClasses} rounded-xl bg-[#1a1a24] text-gray-400 flex items-center`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      </button>
    );
  }

  if (isFollowing) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className={`${sizeClasses} rounded-xl bg-[#1a1a24] border border-[#2a2a38] text-white flex items-center font-medium hover:border-indigo-500/50 transition-colors`}
        >
          {isCloseFriend ? (
            <><Users className="w-3.5 h-3.5 text-indigo-400" /> Ami proche</>
          ) : (
            <><UserCheck className="w-3.5 h-3.5 text-indigo-400" /> Abonné</>
          )}
        </button>

        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a24] border border-[#2a2a38] rounded-xl overflow-hidden shadow-xl min-w-[160px]">
              {!isCloseFriend && (
                <button
                  onClick={handleCloseFriendRequest}
                  className="w-full px-4 py-2.5 text-sm text-left text-gray-300 hover:bg-[#2a2a38] flex items-center gap-2"
                >
                  <Users className="w-4 h-4" /> Ami proche
                </button>
              )}
              <button
                onClick={handleFollow}
                className="w-full px-4 py-2.5 text-sm text-left text-red-400 hover:bg-[#2a2a38] flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" /> Se désabonner
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleFollow}
      className={`${sizeClasses} rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white flex items-center font-medium shadow-lg shadow-indigo-500/20`}
    >
      <UserPlus className="w-3.5 h-3.5" /> Suivre
    </button>
  );
}
