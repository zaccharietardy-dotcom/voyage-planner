import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { api } from '@/lib/api/client';
import { supabase } from '@/lib/supabase/client';

export type NotificationType = 'follow' | 'like' | 'comment' | 'reply' | 'proposal' | 'trip_invite' | 'message';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string> | null;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await api.get<{ notifications: Notification[]; unreadCount: number }>(
        '/api/notifications?limit=30',
      );
      setNotifications(res.notifications ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    } catch {}
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Poll for new notifications every 30s (realtime optional — table may not be enabled)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchNotifications();
    }, 30000);
    return () => clearInterval(interval);
  }, [user, fetchNotifications]);

  const markAsRead = useCallback(async (ids: string[]) => {
    try {
      await api.patch('/api/notifications', { ids });
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - ids.length));
    } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await api.patch('/api/notifications', { all: true });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  }, []);

  return { notifications, unreadCount, isLoading, refetch: fetchNotifications, markAsRead, markAllRead };
}
