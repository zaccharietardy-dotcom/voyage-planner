'use client';

import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: 'AIzaSyDs3KZVBPajTYmkuINabbXMfUVDgC09wfI',
  authDomain: 'narre-ee011.firebaseapp.com',
  projectId: 'narre-ee011',
  storageBucket: 'narre-ee011.firebasestorage.app',
  messagingSenderId: '113387989960',
  appId: '1:113387989960:web:8e84b78b5d334d36ff2efd',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

let messaging: Messaging | null = null;

function getMessagingInstance(): Messaging | null {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window)) return null;
  if (!messaging) {
    messaging = getMessaging(app);
  }
  return messaging;
}

/**
 * Request notification permission and get FCM token.
 * Returns null if user denies or browser doesn't support notifications.
 */
export async function requestPushToken(vapidKey: string): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const msg = getMessagingInstance();
    if (!msg) return null;

    const token = await getToken(msg, { vapidKey });
    return token;
  } catch (err) {
    console.error('[firebase] Failed to get push token:', err);
    return null;
  }
}

/**
 * Listen for foreground messages (when app is open).
 */
export function onForegroundMessage(callback: (payload: { title?: string; body?: string; data?: Record<string, string> }) => void) {
  const msg = getMessagingInstance();
  if (!msg) return () => {};

  return onMessage(msg, (payload) => {
    callback({
      title: payload.notification?.title,
      body: payload.notification?.body,
      data: payload.data,
    });
  });
}
