'use client';

import { useState, useEffect } from 'react';

const CONSENT_KEY = 'narae-cookie-consent';

type ConsentValue = 'accepted' | 'refused';

export function getConsentStatus(): ConsentValue | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CONSENT_KEY) as ConsentValue | null;
}

export function hasAnalyticsConsent(): boolean {
  return getConsentStatus() === 'accepted';
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = getConsentStatus();
    if (!consent) {
      setVisible(true);
    }
  }, []);

  function handleAccept() {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    setVisible(false);
    window.dispatchEvent(new Event('cookie-consent-change'));
  }

  function handleRefuse() {
    localStorage.setItem(CONSENT_KEY, 'refused');
    setVisible(false);
    window.dispatchEvent(new Event('cookie-consent-change'));
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] p-4 md:p-6">
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-background/95 backdrop-blur-sm p-4 shadow-lg">
        <p className="text-sm text-muted-foreground mb-3">
          Nous utilisons des cookies analytiques pour améliorer votre expérience.
          Les cookies essentiels (connexion, préférences) sont toujours actifs.{' '}
          <a href="/privacy" className="underline hover:text-foreground">
            En savoir plus
          </a>
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleRefuse}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Refuser
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
