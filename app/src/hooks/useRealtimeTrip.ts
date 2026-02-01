'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Trip, TripDay } from '@/lib/types';
import { Proposal, TripMember, MemberRole } from '@/lib/types/collaboration';

interface TripWithCollaboration {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  durationDays: number;
  shareCode: string;
  visibility: 'public' | 'friends' | 'private';
  data: Trip;
  members: TripMember[];
  proposals: Proposal[];
  userRole?: MemberRole;
}

interface UseRealtimeTripResult {
  trip: TripWithCollaboration | null;
  isLoading: boolean;
  error: string | null;
  updateTrip: (updates: Partial<Trip>) => Promise<void>;
  updateDays: (days: TripDay[]) => Promise<void>;
  createProposal: (title: string, description: string, changes: any[]) => Promise<void>;
  vote: (proposalId: string, vote: boolean) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useRealtimeTrip(tripId: string, userId?: string): UseRealtimeTripResult {
  const [trip, setTrip] = useState<TripWithCollaboration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = getSupabaseClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const retryCountRef = useRef(0);

  // Charger les données du voyage
  const isRetryingRef = useRef(false);

  const fetchTrip = useCallback(async () => {
    try {
      setError(null);
      isRetryingRef.current = false;

      const response = await fetch(`/api/trips/${tripId}`);
      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && retryCountRef.current < 3) {
          // Auth not ready yet — retry after delay, keep loading state
          retryCountRef.current++;
          isRetryingRef.current = true;
          setTimeout(() => fetchTrip(), retryCountRef.current * 800);
          return;
        }
        throw new Error(response.status === 401 ? 'Non authentifié' : response.status === 403 ? 'Accès refusé' : 'Voyage non trouvé');
      }
      retryCountRef.current = 0;

      const data = await response.json();

      // Deserialize dates from JSON
      const tripData = data.data as Trip;
      if (tripData.days) {
        tripData.days = tripData.days.map((day: any) => ({
          ...day,
          date: day.date ? new Date(day.date) : new Date(),
        }));
      }
      if (tripData.preferences?.startDate) {
        tripData.preferences.startDate = new Date(tripData.preferences.startDate);
      }
      if (tripData.createdAt) tripData.createdAt = new Date(tripData.createdAt);
      if (tripData.updatedAt) tripData.updatedAt = new Date(tripData.updatedAt);

      setTrip({
        id: data.id,
        title: data.title,
        destination: data.destination,
        startDate: data.start_date,
        durationDays: data.duration_days,
        shareCode: data.share_code,
        visibility: data.visibility || 'private',
        data: tripData,
        members: data.members || [],
        proposals: data.proposals || [],
        userRole: data.userRole,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      if (!isRetryingRef.current) {
        setIsLoading(false);
      }
    }
  }, [tripId]);

  // Configurer les subscriptions temps réel
  useEffect(() => {
    retryCountRef.current = 0;
    fetchTrip();

    // Créer le channel pour ce voyage
    const channel = supabase
      .channel(`trip-${tripId}`)
      // Écouter les mises à jour du voyage
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${tripId}`,
        },
        (payload) => {
          console.log('Trip updated:', payload);
          const tripData = payload.new.data as Trip;
          // Deserialize dates from raw Postgres JSON
          if (tripData.days) {
            tripData.days = tripData.days.map((day: any) => ({
              ...day,
              date: day.date ? new Date(day.date) : new Date(),
            }));
          }
          if (tripData.preferences?.startDate) {
            tripData.preferences.startDate = new Date(tripData.preferences.startDate);
          }
          if (tripData.createdAt) tripData.createdAt = new Date(tripData.createdAt);
          if (tripData.updatedAt) tripData.updatedAt = new Date(tripData.updatedAt);

          setTrip((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              data: tripData,
              title: payload.new.title,
              destination: payload.new.destination,
            };
          });
        }
      )
      // Écouter les nouvelles propositions
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'proposals',
          filter: `trip_id=eq.${tripId}`,
        },
        async (payload) => {
          console.log('New proposal:', payload);
          // Recharger les propositions avec les détails de l'auteur
          const response = await fetch(`/api/trips/${tripId}/proposals`);
          if (response.ok) {
            const proposals = await response.json();
            setTrip((prev) => {
              if (!prev) return prev;
              return { ...prev, proposals };
            });
          }
        }
      )
      // Écouter les mises à jour des propositions (votes)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'proposals',
          filter: `trip_id=eq.${tripId}`,
        },
        async (payload) => {
          console.log('Proposal updated:', payload);
          // Recharger les propositions
          const response = await fetch(`/api/trips/${tripId}/proposals`);
          if (response.ok) {
            const proposals = await response.json();
            setTrip((prev) => {
              if (!prev) return prev;
              return { ...prev, proposals };
            });
          }

          // Si une proposition a été mergée, recharger le voyage
          if (payload.new.status === 'merged') {
            fetchTrip();
          }
        }
      )
      // Écouter les nouveaux membres
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_members',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          // Recharger le voyage complet pour avoir les détails des membres
          fetchTrip();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [tripId, fetchTrip, supabase]);

  // Mettre à jour le voyage
  const updateTrip = useCallback(
    async (updates: Partial<Trip>) => {
      if (!trip) return;

      const response = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...trip.data, ...updates } }),
      });

      if (!response.ok) {
        console.error('Erreur de mise à jour:', response.status);
        return;
      }

      // Mise à jour optimiste
      setTrip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: { ...prev.data, ...updates },
        };
      });
    },
    [trip, tripId]
  );

  // Mettre à jour les jours spécifiquement
  const updateDays = useCallback(
    async (days: TripDay[]) => {
      if (!trip) return;

      const response = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...trip.data, days } }),
      });

      if (!response.ok) {
        console.error('Erreur de mise à jour:', response.status);
        return;
      }

      // Mise à jour optimiste
      setTrip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: { ...prev.data, days },
        };
      });
    },
    [trip, tripId]
  );

  // Créer une proposition
  const createProposal = useCallback(
    async (title: string, description: string, changes: any[]) => {
      const response = await fetch(`/api/trips/${tripId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, changes }),
      });

      if (!response.ok) {
        throw new Error('Erreur de création de proposition');
      }

      const proposal = await response.json();

      // Ajouter la proposition localement
      setTrip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          proposals: [proposal, ...prev.proposals],
        };
      });
    },
    [tripId]
  );

  // Voter sur une proposition
  const vote = useCallback(
    async (proposalId: string, voteValue: boolean) => {
      const response = await fetch(`/api/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: voteValue }),
      });

      if (!response.ok) {
        throw new Error('Erreur de vote');
      }

      const result = await response.json();

      // Mettre à jour la proposition localement
      setTrip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          proposals: prev.proposals.map((p) =>
            p.id === proposalId
              ? {
                  ...p,
                  votesFor: result.votesFor,
                  votesAgainst: result.votesAgainst,
                  status: result.status,
                  userVote: result.userVote,
                }
              : p
          ),
        };
      });

      // Si mergé, le voyage sera mis à jour via realtime
    },
    []
  );

  return {
    trip,
    isLoading,
    error,
    updateTrip,
    updateDays,
    createProposal,
    vote,
    refetch: fetchTrip,
  };
}
