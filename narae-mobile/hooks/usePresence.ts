import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  currentView: string;
  joinedAt: string;
}

interface UsePresenceResult {
  onlineUsers: PresenceUser[];
}

export function usePresence(
  tripId: string | undefined,
  currentUser: { id: string; displayName: string; avatarUrl: string | null } | null,
): UsePresenceResult {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!tripId || !currentUser) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase.channel(`presence:trip:${tripId}`, {
        config: { presence: { key: currentUser.id } },
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel!.presenceState<PresenceUser>();
          const users: PresenceUser[] = [];
          for (const [key, presences] of Object.entries(state)) {
            if (key !== currentUser.id && presences[0]) {
              users.push(presences[0]);
            }
        }
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel!.track({
            userId: currentUser.id,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
            currentView: 'trip',
            joinedAt: new Date().toISOString(),
          });
        }
      });
    } catch {
      // Realtime not available — silent fallback
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [tripId, currentUser?.id]);

  return { onlineUsers };
}
