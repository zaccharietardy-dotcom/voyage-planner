'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { initAnalytics, trackPageView, trackEvent } from '@/lib/analytics';

/**
 * Hook to initialize analytics and track page views on route changes.
 * Use in the root layout or a top-level provider.
 */
export function useAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (pathname) {
      trackPageView(pathname);
    }
  }, [pathname]);

  return { trackEvent };
}
