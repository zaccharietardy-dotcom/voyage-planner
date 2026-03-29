'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export function useGoBack(fallback = '/') {
  const router = useRouter();

  return useCallback(() => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(fallback);
    }
  }, [router, fallback]);
}
