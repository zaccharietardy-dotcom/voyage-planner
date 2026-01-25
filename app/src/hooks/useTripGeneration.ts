import { useState, useCallback } from 'react';
import { TripPreferences, Trip } from '@/lib/types';

interface TripGenerationState {
  /** Le voyage généré */
  trip: Trip | null;
  /** Indique si la génération est en cours */
  loading: boolean;
  /** Message d'erreur si la génération a échoué */
  error: string | null;
  /** Étape actuelle de la génération (pour progress indicator) */
  currentStep: string | null;
}

interface UseTripGenerationReturn extends TripGenerationState {
  /** Lance la génération d'un voyage */
  generate: (preferences: TripPreferences) => Promise<Trip | null>;
  /** Réinitialise l'état (efface le voyage et les erreurs) */
  reset: () => void;
}

/**
 * Hook pour gérer la génération de voyages via l'API
 *
 * Gère l'état de chargement, les erreurs, et le résultat.
 * Utilise l'endpoint /api/generate pour la génération.
 *
 * @example
 * ```tsx
 * const { generate, loading, error, trip } = useTripGeneration();
 *
 * const handleSubmit = async () => {
 *   const result = await generate(preferences);
 *   if (result) {
 *     router.push(`/trip/${result.id}`);
 *   }
 * };
 * ```
 */
export function useTripGeneration(): UseTripGenerationReturn {
  const [state, setState] = useState<TripGenerationState>({
    trip: null,
    loading: false,
    error: null,
    currentStep: null,
  });

  const generate = useCallback(async (preferences: TripPreferences): Promise<Trip | null> => {
    setState(prev => ({
      ...prev,
      loading: true,
      error: null,
      currentStep: 'Initialisation...',
    }));

    try {
      // Valider les préférences avant l'envoi
      if (!preferences.destination) {
        throw new Error('La destination est requise');
      }
      if (!preferences.startDate || !preferences.durationDays) {
        throw new Error('La date de départ et la durée sont requises');
      }

      setState(prev => ({ ...prev, currentStep: 'Génération du voyage...' }));

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erreur HTTP ${response.status}`);
      }

      setState(prev => ({ ...prev, currentStep: 'Finalisation...' }));

      const data = await response.json();

      if (!data.trip) {
        throw new Error('Réponse invalide du serveur');
      }

      setState({
        trip: data.trip,
        loading: false,
        error: null,
        currentStep: null,
      });

      return data.trip;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';

      setState(prev => ({
        ...prev,
        loading: false,
        error: message,
        currentStep: null,
      }));

      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      trip: null,
      loading: false,
      error: null,
      currentStep: null,
    });
  }, []);

  return {
    ...state,
    generate,
    reset,
  };
}
