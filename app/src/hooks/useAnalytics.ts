'use client';

import { useEffect, useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { initAnalytics, stopAnalytics, trackPageView, trackEvent } from '@/lib/analytics';
import { hasAnalyticsConsent } from '@/components/CookieConsentBanner';

/**
 * Hook to initialize analytics and track page views on route changes.
 * Respects cookie consent — only initializes if user accepted analytics cookies.
 */
export function useAnalytics() {
  const pathname = usePathname();
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setConsented(hasAnalyticsConsent());

    function onConsentChange() {
      const accepted = hasAnalyticsConsent();
      setConsented(accepted);
      if (!accepted) {
        stopAnalytics();
      }
    }

    window.addEventListener('cookie-consent-change', onConsentChange);
    return () => window.removeEventListener('cookie-consent-change', onConsentChange);
  }, []);

  useEffect(() => {
    if (consented) {
      initAnalytics();
    }
  }, [consented]);

  useEffect(() => {
    if (consented && pathname) {
      trackPageView(pathname);
    }
  }, [pathname, consented]);

  const safeTrackEvent = useCallback(
    (name: string, properties?: Record<string, string | number | boolean | null>) => {
      if (consented) trackEvent(name, properties);
    },
    [consented],
  );

  return { trackEvent: safeTrackEvent };
}
