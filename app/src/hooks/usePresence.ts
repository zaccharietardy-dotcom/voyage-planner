'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  currentView?: string;
  joinedAt: string;
}

export function usePresence(tripId: string, currentUser?: { id: string; displayName?: string; avatarUrl?: string | null }) {
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!tripId || !currentUser?.id) return;

    const supabase = createClient();
    const ch = supabase.channel(`presence:trip:${tripId}`, {
      config: { presence: { key: currentUser.id } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceUser>();
      const users: PresenceUser[] = [];
      for (const [, presences] of Object.entries(state)) {
        if (presences.length > 0) {
          const p = presences[0] as unknown as PresenceUser;
          if (p.userId !== currentUser.id) {
            users.push(p);
          }
        }
      }
      setPresenceUsers(users);
    });

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          userId: currentUser.id,
          displayName: currentUser.displayName || 'Voyageur',
          avatarUrl: currentUser.avatarUrl,
          currentView: 'planning',
          joinedAt: new Date().toISOString(),
        });
      }
    });

    setChannel(ch);

    return () => {
      ch.untrack();
      supabase.removeChannel(ch);
    };
  }, [tripId, currentUser?.id]);

  const updateView = useCallback((view: string) => {
    if (channel && currentUser) {
      channel.track({
        userId: currentUser.id,
        displayName: currentUser.displayName || 'Voyageur',
        avatarUrl: currentUser.avatarUrl,
        currentView: view,
        joinedAt: new Date().toISOString(),
      });
    }
  }, [channel, currentUser]);

  return { presenceUsers, updateView };
}
