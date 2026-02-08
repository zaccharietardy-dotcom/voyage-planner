'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook pour gérer l'état d'un tour guidé (onboarding).
 * Stocke la progression dans localStorage pour ne l'afficher qu'une fois.
 */
export function useOnboarding(storageKey: string, totalSteps: number) {
  const [isActive, setIsActive] = useState(false);
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Délai pour laisser la page se charger avant de démarrer le tour
    const timer = setTimeout(() => {
      const seen = localStorage.getItem(storageKey);
      if (!seen) {
        setIsActive(true);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setIsActive(false);
    setStep(0);
    localStorage.setItem(storageKey, 'true');
  }, [storageKey]);

  const next = useCallback(() => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }, [step, totalSteps, dismiss]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const goTo = useCallback((stepIndex: number) => {
    setStep(Math.max(0, Math.min(stepIndex, totalSteps - 1)));
  }, [totalSteps]);

  return {
    isActive: mounted && isActive,
    step,
    totalSteps,
    next,
    prev,
    goTo,
    dismiss,
  };
}
