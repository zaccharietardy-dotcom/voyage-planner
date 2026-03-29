import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Calls `refetch` every time the screen gains focus,
 * skipping the first invocation (data is already loaded on mount).
 */
export function useRefreshOnFocus(refetch: () => void) {
  const isFirstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      refetch();
    }, [refetch]),
  );
}
