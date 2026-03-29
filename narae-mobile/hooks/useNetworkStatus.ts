import { useState, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Simple network status hook.
 * Uses fetch to a known URL to detect connectivity (more reliable than NetInfo on some devices).
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch('https://naraevoyage.com/api/health', {
          method: 'HEAD',
          cache: 'no-store',
        });
        if (mounted) setIsOnline(res.ok);
      } catch {
        if (mounted) setIsOnline(false);
      }
    };

    check();

    // Re-check when app comes to foreground
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });

    // Periodic check every 30s
    const interval = setInterval(check, 30000);

    return () => {
      mounted = false;
      sub.remove();
      clearInterval(interval);
    };
  }, []);

  return { isOnline };
}
