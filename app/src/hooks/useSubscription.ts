'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { BillingSource } from '@/lib/types';

interface SubscriptionState {
  isPro: boolean;
  status: 'free' | 'pro' | 'canceled';
  expiresAt: string | null;
  source: BillingSource;
  canManageInApp: boolean;
  canManageOnWeb: boolean;
  loading: boolean;
}

export function useSubscription(): SubscriptionState {
  const { user } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    isPro: false,
    status: 'free',
    expiresAt: null,
    source: 'none',
    canManageInApp: false,
    canManageOnWeb: true,
    loading: true,
  });

  const defaultFreeState: SubscriptionState = {
    isPro: false,
    status: 'free',
    expiresAt: null,
    source: 'none',
    canManageInApp: false,
    canManageOnWeb: true,
    loading: false,
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    fetch('/api/billing/status')
      .then((res) => res.json())
      .then((data) => {
        setState({
          isPro: data.status === 'pro',
          status: data.status || 'free',
          expiresAt: data.expiresAt,
          source: data.source || 'none',
          canManageInApp: Boolean(data.canManageInApp),
          canManageOnWeb: data.canManageOnWeb !== false,
          loading: false,
        });
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false }));
      });
  }, [user]);

  return user ? state : defaultFreeState;
}
