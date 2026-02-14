import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import type { Json, Proposal as DbProposal } from '@/lib/supabase/types';
import type {
  MemberRole,
  Proposal,
  ProposalStatus,
  ProposedChange,
} from '@/lib/types/collaboration';

export type RouteSupabaseClient = SupabaseClient<Database>;

interface ProposalAuthorRow {
  display_name: string | null;
  avatar_url: string | null;
}

export interface ProposalSelectRow extends DbProposal {
  author?: ProposalAuthorRow | ProposalAuthorRow[] | null;
}

export interface ProposalVotingMeta {
  eligibleVoters: number;
  requiredVotes: number;
  ownerDecisionRequired: boolean;
}

export interface ProposalVoteSnapshot extends ProposalVotingMeta {
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
}

export function parseProposedChanges(changes: Json): ProposedChange[] {
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes as unknown as ProposedChange[];
}

export async function getTripOwnerId(
  supabase: RouteSupabaseClient,
  tripId: string
): Promise<string | null> {
  const { data: trip, error } = await supabase
    .from('trips')
    .select('owner_id')
    .eq('id', tripId)
    .maybeSingle();

  if (error || !trip) {
    return null;
  }

  return trip.owner_id;
}

export async function getTripRoleForUser(
  supabase: RouteSupabaseClient,
  tripId: string,
  userId: string
): Promise<MemberRole | null> {
  const ownerId = await getTripOwnerId(supabase, tripId);
  if (!ownerId) {
    return null;
  }

  if (ownerId === userId) {
    return 'owner';
  }

  const { data: member, error } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !member) {
    return null;
  }

  if (member.role === 'owner' || member.role === 'editor' || member.role === 'viewer') {
    return member.role;
  }

  return null;
}

export async function getEditorUserIds(
  supabase: RouteSupabaseClient,
  tripId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', tripId)
    .eq('role', 'editor');

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((member) => member.user_id);
}

export function getEligibleVoterCount(editorUserIds: string[], authorId: string): number {
  return editorUserIds.filter((editorId) => editorId !== authorId).length;
}

export function getRequiredVotes(eligibleVoters: number): number {
  if (eligibleVoters <= 0) {
    return 0;
  }

  return Math.floor(eligibleVoters / 2) + 1;
}

export function computePendingProposalStatus(
  eligibleVoters: number,
  votesFor: number,
  votesAgainst: number
): ProposalStatus {
  if (eligibleVoters <= 0) {
    return 'approved';
  }

  const requiredVotes = getRequiredVotes(eligibleVoters);

  if (votesFor >= requiredVotes) {
    return 'approved';
  }

  if (votesAgainst >= requiredVotes) {
    return 'rejected';
  }

  return 'pending';
}

export function buildProposalVoteSnapshot(
  eligibleVoters: number,
  votesFor: number,
  votesAgainst: number
): ProposalVoteSnapshot {
  const requiredVotes = getRequiredVotes(eligibleVoters);
  const status = computePendingProposalStatus(eligibleVoters, votesFor, votesAgainst);

  return {
    status,
    votesFor,
    votesAgainst,
    eligibleVoters,
    requiredVotes,
    ownerDecisionRequired: status === 'approved',
  };
}

function normalizeAuthor(author: ProposalSelectRow['author']): Proposal['author'] {
  const value = Array.isArray(author) ? author[0] : author;

  return {
    displayName: value?.display_name || 'Utilisateur',
    avatarUrl: value?.avatar_url || null,
  };
}

export function formatProposalForApi(
  proposal: ProposalSelectRow,
  userVote: boolean | undefined,
  editorUserIds: string[]
): Proposal {
  const eligibleVoters = getEligibleVoterCount(editorUserIds, proposal.author_id);

  return {
    id: proposal.id,
    tripId: proposal.trip_id,
    authorId: proposal.author_id,
    author: normalizeAuthor(proposal.author),
    title: proposal.title,
    description: proposal.description || undefined,
    changes: parseProposedChanges(proposal.changes),
    status: proposal.status,
    votesFor: proposal.votes_for,
    votesAgainst: proposal.votes_against,
    userVote,
    createdAt: proposal.created_at,
    resolvedAt: proposal.resolved_at || undefined,
    eligibleVoters,
    requiredVotes: getRequiredVotes(eligibleVoters),
    ownerDecisionRequired: proposal.status === 'approved',
  };
}
