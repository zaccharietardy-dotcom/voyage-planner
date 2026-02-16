'use client';

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/mobile/runtime';

interface ConnectivityState {
  isOnline: boolean;
  isOffline: boolean;
}

export function useConnectivity(): ConnectivityState {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    let removeListener: (() => void) | null = null;

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (isNativeApp()) {
      const networkPlugin = (window as Window & {
        Capacitor?: {
          Plugins?: {
            Network?: {
              getStatus?: () => Promise<{ connected: boolean }>;
              addListener?: (
                event: 'networkStatusChange',
                cb: (nextStatus: { connected: boolean }) => void
              ) => Promise<{ remove: () => Promise<void> }>;
              removeAllListeners?: () => Promise<void>;
            };
          };
        };
      }).Capacitor?.Plugins?.Network;

      if (networkPlugin?.getStatus) {
        void networkPlugin.getStatus().then((status) => {
          setIsOnline(Boolean(status?.connected));
        });
      }

      if (networkPlugin?.addListener) {
        void networkPlugin
          .addListener('networkStatusChange', (nextStatus) => {
            setIsOnline(Boolean(nextStatus?.connected));
          })
          .then((handle) => {
            removeListener = () => {
              void handle.remove();
            };
          })
          .catch(() => {
            // Ignore plugin listener setup errors.
          });
      }
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      removeListener?.();
    };
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
  };
}
