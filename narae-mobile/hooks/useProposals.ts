import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { supabase } from '@/lib/supabase/client';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'merged';

export interface Proposal {
  id: string;
  trip_id: string;
  author_id: string;
  title: string;
  description: string;
  changes: unknown[];
  status: ProposalStatus;
  votes_for: number;
  votes_against: number;
  created_at: string;
  resolved_at: string | null;
  author?: {
    display_name: string;
    avatar_url: string | null;
  };
}

export interface ProposalVoteResponse {
  proposalId: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  userVote: boolean;
  eligibleVoters: number;
  requiredVotes: number;
  ownerDecisionRequired: boolean;
}

export function useProposals(tripId: string | undefined) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProposals = useCallback(async () => {
    if (!tripId) return;
    setIsLoading(true);
    try {
      const res = await api.get<{ proposals: Proposal[] }>(`/api/trips/${tripId}/proposals`);
      setProposals(res.proposals ?? []);
    } catch {}
    setIsLoading(false);
  }, [tripId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // Realtime
  // Realtime — gracefully degrade if table not enabled
  useEffect(() => {
    if (!tripId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`proposals:${tripId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'proposals', filter: `trip_id=eq.${tripId}` },
          () => fetchProposals(),
        )
        .subscribe();
    } catch {
      // silent fallback
    }
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [tripId, fetchProposals]);

  const createProposal = useCallback(async (title: string, description: string, changes: unknown[]) => {
    if (!tripId) return;
    await api.post(`/api/trips/${tripId}/proposals`, { title, description, changes });
    await fetchProposals();
  }, [tripId, fetchProposals]);

  const vote = useCallback(async (proposalId: string, voteYes: boolean): Promise<ProposalVoteResponse | null> => {
    try {
      const res = await api.post<ProposalVoteResponse>(`/api/proposals/${proposalId}/vote`, { vote: voteYes });
      await fetchProposals();
      return res;
    } catch { return null; }
  }, [fetchProposals]);

  const decide = useCallback(async (proposalId: string, decision: 'merge' | 'reject') => {
    await api.post(`/api/proposals/${proposalId}/decision`, { decision });
    await fetchProposals();
  }, [fetchProposals]);

  const pendingCount = proposals.filter((p) => p.status === 'pending').length;

  return { proposals, pendingCount, isLoading, refetch: fetchProposals, createProposal, vote, decide };
}
