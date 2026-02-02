'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

interface SubscriptionState {
  isPro: boolean;
  status: 'free' | 'pro' | 'canceled';
  expiresAt: string | null;
  loading: boolean;
}

export function useSubscription(): SubscriptionState {
  const { user } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    isPro: false,
    status: 'free',
    expiresAt: null,
    loading: true,
  });

  useEffect(() => {
    if (!user) {
      setState({ isPro: false, status: 'free', expiresAt: null, loading: false });
      return;
    }

    fetch('/api/billing/status')
      .then((res) => res.json())
      .then((data) => {
        setState({
          isPro: data.status === 'pro',
          status: data.status || 'free',
          expiresAt: data.expiresAt,
          loading: false,
        });
      })
      .catch(() => {
        setState((prev) => ({ ...prev, loading: false }));
      });
  }, [user]);

  return state;
}
