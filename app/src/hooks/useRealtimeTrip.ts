'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Trip, TripDay } from '@/lib/types';
import {
  Proposal,
  TripMember,
  MemberRole,
  ProposedChange,
  ProposalVoteResponse,
  ProposalDecisionResponse,
} from '@/lib/types/collaboration';

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

interface TripApiResponse {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  duration_days: number;
  share_code: string;
  visibility?: 'public' | 'friends' | 'private';
  data: Trip;
  members?: TripMember[];
  proposals?: Proposal[];
  userRole?: MemberRole;
}

interface UseRealtimeTripResult {
  trip: TripWithCollaboration | null;
  isLoading: boolean;
  error: string | null;
  updateTrip: (updates: Partial<Trip>) => Promise<void>;
  updateDays: (days: TripDay[]) => Promise<void>;
  createProposal: (title: string, description: string, changes: ProposedChange[]) => Promise<void>;
  vote: (proposalId: string, vote: boolean) => Promise<void>;
  decideProposal: (proposalId: string, decision: 'merge' | 'reject') => Promise<void>;
  refetch: () => Promise<void>;
}

function deserializeTrip(tripData: Trip): Trip {
  const clonedTrip = structuredClone(tripData);

  if (clonedTrip.days) {
    clonedTrip.days = clonedTrip.days.map((day) => ({
      ...day,
      date: day.date ? new Date(day.date) : new Date(),
    }));
  }

  if (clonedTrip.preferences?.startDate) {
    clonedTrip.preferences.startDate = new Date(clonedTrip.preferences.startDate);
  }

  if (clonedTrip.createdAt) {
    clonedTrip.createdAt = new Date(clonedTrip.createdAt);
  }

  if (clonedTrip.updatedAt) {
    clonedTrip.updatedAt = new Date(clonedTrip.updatedAt);
  }

  return clonedTrip;
}

export function useRealtimeTrip(tripId: string): UseRealtimeTripResult {
  const [trip, setTrip] = useState<TripWithCollaboration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = getSupabaseClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const retryCountRef = useRef(0);
  const isRetryingRef = useRef(false);

  const fetchTrip = useCallback(async () => {
    try {
      setError(null);
      isRetryingRef.current = false;

      const response = await fetch(`/api/trips/${tripId}`);
      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && retryCountRef.current < 3) {
          retryCountRef.current += 1;
          isRetryingRef.current = true;
          setTimeout(() => {
            void fetchTrip();
          }, retryCountRef.current * 800);
          return;
        }

        throw new Error(
          response.status === 401
            ? 'Non authentifié'
            : response.status === 403
              ? 'Accès refusé'
              : 'Voyage non trouvé'
        );
      }

      retryCountRef.current = 0;
      const data = await response.json() as TripApiResponse;
      const tripData = deserializeTrip(data.data);

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

  useEffect(() => {
    retryCountRef.current = 0;
    void fetchTrip();

    const channel = supabase
      .channel(`trip-${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${tripId}`,
        },
        (payload: { new: { data: Trip; title: string; destination: string } }) => {
          const realtimeTripData = deserializeTrip(payload.new.data);

          setTrip((previousTrip) => {
            if (!previousTrip) {
              return previousTrip;
            }

            return {
              ...previousTrip,
              data: realtimeTripData,
              title: payload.new.title,
              destination: payload.new.destination,
            };
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'proposals',
          filter: `trip_id=eq.${tripId}`,
        },
        async () => {
          const response = await fetch(`/api/trips/${tripId}/proposals`);
          if (!response.ok) {
            return;
          }

          const proposals = await response.json() as Proposal[];
          setTrip((previousTrip) => {
            if (!previousTrip) {
              return previousTrip;
            }

            return { ...previousTrip, proposals };
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'proposals',
          filter: `trip_id=eq.${tripId}`,
        },
        async (payload: { new: { status: Proposal['status'] } }) => {
          const response = await fetch(`/api/trips/${tripId}/proposals`);
          if (response.ok) {
            const proposals = await response.json() as Proposal[];
            setTrip((previousTrip) => {
              if (!previousTrip) {
                return previousTrip;
              }

              return { ...previousTrip, proposals };
            });
          }

          if (payload.new.status === 'merged') {
            await fetchTrip();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_members',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void fetchTrip();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trip_members',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void fetchTrip();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'trip_members',
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void fetchTrip();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }
    };
  }, [tripId, fetchTrip, supabase]);

  const updateTrip = useCallback(
    async (updates: Partial<Trip>) => {
      if (!trip) {
        return;
      }

      const response = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...trip.data, ...updates } }),
      });

      if (!response.ok) {
        console.error('Erreur de mise à jour:', response.status);
        return;
      }

      setTrip((previousTrip) => {
        if (!previousTrip) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          data: { ...previousTrip.data, ...updates },
        };
      });
    },
    [trip, tripId]
  );

  const updateDays = useCallback(
    async (days: TripDay[]) => {
      if (!trip) {
        return;
      }

      const response = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...trip.data, days } }),
      });

      if (!response.ok) {
        console.error('Erreur de mise à jour:', response.status);
        return;
      }

      setTrip((previousTrip) => {
        if (!previousTrip) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          data: { ...previousTrip.data, days },
        };
      });
    },
    [trip, tripId]
  );

  const createProposal = useCallback(
    async (title: string, description: string, changes: ProposedChange[]) => {
      const response = await fetch(`/api/trips/${tripId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, changes }),
      });

      if (!response.ok) {
        throw new Error('Erreur de création de proposition');
      }

      const proposal = await response.json() as Proposal;

      setTrip((previousTrip) => {
        if (!previousTrip) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          proposals: [proposal, ...previousTrip.proposals],
        };
      });
    },
    [tripId]
  );

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

      const result = await response.json() as ProposalVoteResponse;

      setTrip((previousTrip) => {
        if (!previousTrip) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          proposals: previousTrip.proposals.map((proposal) =>
            proposal.id === proposalId
              ? {
                  ...proposal,
                  votesFor: result.votesFor,
                  votesAgainst: result.votesAgainst,
                  status: result.status,
                  userVote: result.userVote,
                  eligibleVoters: result.eligibleVoters,
                  requiredVotes: result.requiredVotes,
                  ownerDecisionRequired: result.ownerDecisionRequired,
                }
              : proposal
          ),
        };
      });
    },
    []
  );

  const decideProposal = useCallback(
    async (proposalId: string, decision: 'merge' | 'reject') => {
      const response = await fetch(`/api/proposals/${proposalId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la décision propriétaire');
      }

      const result = await response.json() as ProposalDecisionResponse;

      setTrip((previousTrip) => {
        if (!previousTrip) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          proposals: previousTrip.proposals.map((proposal) =>
            proposal.id === proposalId
              ? {
                  ...proposal,
                  status: result.status,
                  ownerDecisionRequired: false,
                  resolvedAt: new Date().toISOString(),
                }
              : proposal
          ),
        };
      });

      if (result.status === 'merged') {
        await fetchTrip();
      }
    },
    [fetchTrip]
  );

  return {
    trip,
    isLoading,
    error,
    updateTrip,
    updateDays,
    createProposal,
    vote,
    decideProposal,
    refetch: fetchTrip,
  };
}
