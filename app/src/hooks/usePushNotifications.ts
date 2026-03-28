'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { isNativeApp } from '@/lib/mobile/runtime';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';

export function usePushNotifications() {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    if (!user || isNativeApp()) return false;
    if (!('Notification' in window)) return false;

    try {
      const { requestPushToken, onForegroundMessage } = await import('@/lib/firebase/client');

      const token = await requestPushToken(VAPID_KEY);
      if (!token) {
        setPermission(Notification.permission);
        return false;
      }

      // Register token with backend
      await fetch('/api/notifications/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, platform: 'web' }),
      });

      // Listen for foreground messages
      onForegroundMessage((payload) => {
        if (payload.title) {
          new Notification(payload.title, {
            body: payload.body,
            icon: '/logo-narae.png',
          });
        }
      });

      setPermission('granted');
      return true;
    } catch (err) {
      console.error('[push] Error requesting permission:', err);
      return false;
    }
  };

  return { permission, requestPermission };
}
