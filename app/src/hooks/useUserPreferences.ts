'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPreferences } from '@/lib/supabase/types';
import { useAuth } from '@/components/auth';

interface UseUserPreferencesReturn {
  preferences: UserPreferences | null;
  isLoading: boolean;
  error: string | null;
  savePreferences: (data: Partial<UserPreferences>) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export function useUserPreferences(): UseUserPreferencesReturn {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async () => {
    if (!user) {
      setPreferences(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/user-preferences');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des préférences');
      }

      setPreferences(data.preferences);
    } catch (err) {
      console.error('Error fetching preferences:', err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const savePreferences = useCallback(async (data: Partial<UserPreferences>): Promise<boolean> => {
    if (!user) {
      setError('Vous devez être connecté pour sauvegarder vos préférences');
      return false;
    }

    try {
      setError(null);

      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erreur lors de la sauvegarde des préférences');
      }

      setPreferences(result.preferences);
      return true;
    } catch (err) {
      console.error('Error saving preferences:', err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      return false;
    }
  }, [user]);

  return {
    preferences,
    isLoading,
    error,
    savePreferences,
    refetch: fetchPreferences,
  };
}

// Default preferences for new users
export const defaultPreferences: Omit<UserPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  favorite_activities: [],
  travel_style: 'balanced',
  budget_preference: 'moderate',
  accommodation_preference: 'hotel',
  pace_preference: 'moderate',
  dietary_restrictions: [],
  cuisine_preferences: [],
  allergies: [],
  accessibility_needs: [],
  preferred_language: 'fr',
  preferred_currency: 'EUR',
  wake_up_time: 'normal',
};

// Options for each preference field
export const preferenceOptions = {
  travelStyle: [
    { value: 'adventurous', label: 'Aventurier', description: 'Activités extrêmes, randonnées, exploration' },
    { value: 'relaxed', label: 'Détente', description: 'Plages, spas, rythme tranquille' },
    { value: 'cultural', label: 'Culturel', description: 'Musées, monuments, histoire' },
    { value: 'party', label: 'Festif', description: 'Vie nocturne, événements, festivals' },
    { value: 'balanced', label: 'Équilibré', description: 'Un peu de tout' },
  ],
  budgetPreference: [
    { value: 'budget', label: 'Économique', description: 'Hostels, street food, transports en commun' },
    { value: 'moderate', label: 'Modéré', description: 'Hôtels 3★, restaurants variés' },
    { value: 'comfort', label: 'Confort', description: 'Hôtels 4★, bons restaurants' },
    { value: 'luxury', label: 'Luxe', description: 'Hôtels 5★, gastronomie, services premium' },
  ],
  accommodationPreference: [
    { value: 'hostel', label: 'Hostel', description: 'Auberges de jeunesse, ambiance sociale' },
    { value: 'hotel', label: 'Hôtel', description: 'Hôtels classiques' },
    { value: 'airbnb', label: 'Appartement', description: 'Airbnb, locations de vacances' },
    { value: 'luxury', label: 'Luxe', description: 'Hôtels 5★, resorts' },
  ],
  pacePreference: [
    { value: 'relaxed', label: 'Tranquille', description: '2-3 activités par jour max' },
    { value: 'moderate', label: 'Modéré', description: '4-5 activités par jour' },
    { value: 'intense', label: 'Intense', description: 'Maximiser chaque journée' },
  ],
  wakeUpTime: [
    { value: 'early', label: 'Lève-tôt', description: 'Debout avant 7h' },
    { value: 'normal', label: 'Normal', description: 'Entre 7h et 9h' },
    { value: 'late', label: 'Grasse mat\'', description: 'Après 9h' },
  ],
  dietaryRestrictions: [
    { value: 'vegetarian', label: 'Végétarien' },
    { value: 'vegan', label: 'Végan' },
    { value: 'halal', label: 'Halal' },
    { value: 'kosher', label: 'Casher' },
    { value: 'gluten_free', label: 'Sans gluten' },
    { value: 'lactose_free', label: 'Sans lactose' },
  ],
  cuisinePreferences: [
    { value: 'local', label: 'Cuisine locale' },
    { value: 'international', label: 'International' },
    { value: 'street_food', label: 'Street food' },
    { value: 'fine_dining', label: 'Gastronomie' },
    { value: 'vegetarian_friendly', label: 'Options végé' },
  ],
  favoriteActivities: [
    { value: 'museums', label: 'Musées' },
    { value: 'monuments', label: 'Monuments' },
    { value: 'nature', label: 'Nature & Parcs' },
    { value: 'beaches', label: 'Plages' },
    { value: 'hiking', label: 'Randonnée' },
    { value: 'shopping', label: 'Shopping' },
    { value: 'nightlife', label: 'Vie nocturne' },
    { value: 'food_tours', label: 'Tours gastronomiques' },
    { value: 'sports', label: 'Sports & Aventure' },
    { value: 'wellness', label: 'Bien-être & Spa' },
    { value: 'photography', label: 'Photographie' },
    { value: 'local_experiences', label: 'Expériences locales' },
  ],
  accessibilityNeeds: [
    { value: 'wheelchair', label: 'Fauteuil roulant' },
    { value: 'limited_mobility', label: 'Mobilité réduite' },
    { value: 'visual', label: 'Déficience visuelle' },
    { value: 'hearing', label: 'Déficience auditive' },
    { value: 'cognitive', label: 'Besoins cognitifs' },
  ],
};
