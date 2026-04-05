import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { fetchTrip, type TripRow } from '@/lib/api/trips';

export function useRealtimeTrip(tripId: string | undefined) {
  const [trip, setTrip] = useState<TripRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrip = useCallback(async () => {
    if (!tripId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTrip(tripId);
      setTrip(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    }
    setIsLoading(false);
  }, [tripId]);

  useEffect(() => {
    loadTrip();
  }, [loadTrip]);

  // Subscribe to trip data changes
  // Realtime sync — gracefully degrade if tables aren't enabled for realtime
  useEffect(() => {
    if (!tripId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`realtime-trip:${tripId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
          (payload) => {
            const updated = payload.new as TripRow;
            setTrip((prev) => prev ? { ...prev, ...updated } : updated);
          },
        )
        .subscribe();
    } catch {
      // Realtime not available — silent fallback
    }
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [tripId, loadTrip]);

  const updateLocal = useCallback((updater: (prev: TripRow) => TripRow) => {
    setTrip((prev) => prev ? updater(prev) : prev);
  }, []);

  return { trip, isLoading, error, refetch: loadTrip, updateLocal };
}
