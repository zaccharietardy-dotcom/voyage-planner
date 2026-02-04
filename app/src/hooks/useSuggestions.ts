'use client';

import { useState, useCallback } from 'react';
import type { DurationSuggestion, DestinationSuggestion, ActivityType, BudgetLevel, GroupType } from '@/lib/types';

interface SuggestionContext {
  activities?: ActivityType[];
  budgetLevel?: BudgetLevel;
  groupType?: GroupType;
  origin?: string;
  durationDays?: number;
}

interface SuggestionState {
  loadingDuration: boolean;
  loadingDestination: boolean;
  durationSuggestion: DurationSuggestion | null;
  destinationSuggestions: DestinationSuggestion[] | null;
  error: string | null;
}

export function useSuggestions() {
  const [state, setState] = useState<SuggestionState>({
    loadingDuration: false,
    loadingDestination: false,
    durationSuggestion: null,
    destinationSuggestions: null,
    error: null,
  });

  const fetchDurationSuggestion = useCallback(async (destination: string, context: SuggestionContext) => {
    setState(prev => ({ ...prev, loadingDuration: true, error: null, durationSuggestion: null }));
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'duration',
          destination,
          ...context,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur lors de la suggestion');
      }

      const data = await res.json();
      setState(prev => ({ ...prev, loadingDuration: false, durationSuggestion: data.duration }));
      return data.duration as DurationSuggestion;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setState(prev => ({ ...prev, loadingDuration: false, error: message }));
      return null;
    }
  }, []);

  const fetchDestinationSuggestions = useCallback(async (query: string, context: SuggestionContext) => {
    setState(prev => ({ ...prev, loadingDestination: true, error: null, destinationSuggestions: null }));
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'destination',
          query,
          ...context,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur lors de la suggestion');
      }

      const data = await res.json();
      setState(prev => ({ ...prev, loadingDestination: false, destinationSuggestions: data.destinations }));
      return data.destinations as DestinationSuggestion[];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setState(prev => ({ ...prev, loadingDestination: false, error: message }));
      return null;
    }
  }, []);

  const clearSuggestions = useCallback(() => {
    setState({
      loadingDuration: false,
      loadingDestination: false,
      durationSuggestion: null,
      destinationSuggestions: null,
      error: null,
    });
  }, []);

  const clearDuration = useCallback(() => {
    setState(prev => ({ ...prev, durationSuggestion: null }));
  }, []);

  const clearDestination = useCallback(() => {
    setState(prev => ({ ...prev, destinationSuggestions: null }));
  }, []);

  return {
    ...state,
    fetchDurationSuggestion,
    fetchDestinationSuggestions,
    clearSuggestions,
    clearDuration,
    clearDestination,
  };
}
