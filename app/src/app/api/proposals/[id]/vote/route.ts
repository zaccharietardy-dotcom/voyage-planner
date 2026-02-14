import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { Proposal as DbProposal } from '@/lib/supabase/types';
import type { ProposalVoteResponse } from '@/lib/types/collaboration';
import {
  buildProposalVoteSnapshot,
  getEditorUserIds,
  getEligibleVoterCount,
  getTripRoleForUser,
} from '@/lib/server/collaboration';

interface VoteRequest {
  vote: boolean;
}

interface StoredVoteRow {
  vote: boolean;
}

// POST /api/proposals/[id]/vote - Voter pour ou contre une proposition
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json() as VoteRequest;

    if (typeof body.vote !== 'boolean') {
      return NextResponse.json({ error: 'Vote invalide (true ou false)' }, { status: 400 });
    }

    const { data: proposalData, error: proposalError } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (proposalError || !proposalData) {
      return NextResponse.json({ error: 'Proposition non trouvée' }, { status: 404 });
    }

    const proposal = proposalData as DbProposal;

    if (proposal.status !== 'pending') {
      return NextResponse.json({ error: 'Cette proposition est déjà résolue' }, { status: 400 });
    }

    const role = await getTripRoleForUser(supabase, proposal.trip_id, user.id);
    if (role !== 'editor') {
      return NextResponse.json({ error: 'Seuls les éditeurs peuvent voter' }, { status: 403 });
    }

    if (proposal.author_id === user.id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas voter sur votre propre proposition' }, { status: 400 });
    }

    const { error: voteError } = await supabase
      .from('votes')
      .upsert(
        {
          proposal_id: id,
          user_id: user.id,
          vote: body.vote,
        },
        { onConflict: 'proposal_id,user_id' }
      );

    if (voteError) {
      return NextResponse.json({ error: voteError.message }, { status: 500 });
    }

    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('vote')
      .eq('proposal_id', id);

    if (votesError) {
      return NextResponse.json({ error: votesError.message }, { status: 500 });
    }

    const storedVotes = (votes || []) as StoredVoteRow[];
    const votesFor = storedVotes.filter((vote) => vote.vote).length;
    const votesAgainst = storedVotes.filter((vote) => !vote.vote).length;

    const editorUserIds = await getEditorUserIds(supabase, proposal.trip_id);
    const eligibleVoters = getEligibleVoterCount(editorUserIds, proposal.author_id);
    const snapshot = buildProposalVoteSnapshot(eligibleVoters, votesFor, votesAgainst);

    const now = new Date().toISOString();
    const { data: updatedProposal, error: updateError } = await supabase
      .from('proposals')
      .update({
        votes_for: snapshot.votesFor,
        votes_against: snapshot.votesAgainst,
        status: snapshot.status,
        resolved_at: snapshot.status === 'rejected' ? now : null,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status, votes_for, votes_against')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabase.from('activity_log').insert({
      trip_id: proposal.trip_id,
      user_id: user.id,
      action: 'proposal_voted',
      details: { proposalId: id, vote: body.vote },
    });

    // Conflit possible (vote concurrent): renvoyer l'état persistant actuel
    if (!updatedProposal) {
      const { data: currentProposal, error: currentError } = await supabase
        .from('proposals')
        .select('id, status, votes_for, votes_against, author_id')
        .eq('id', id)
        .maybeSingle();

      if (currentError || !currentProposal) {
        return NextResponse.json({ error: 'Proposition introuvable après vote' }, { status: 409 });
      }

      const currentEligible = getEligibleVoterCount(editorUserIds, currentProposal.author_id);
      const response: ProposalVoteResponse = {
        proposalId: currentProposal.id,
        status: currentProposal.status,
        votesFor: currentProposal.votes_for,
        votesAgainst: currentProposal.votes_against,
        userVote: body.vote,
        eligibleVoters: currentEligible,
        requiredVotes: currentEligible === 0 ? 0 : Math.floor(currentEligible / 2) + 1,
        ownerDecisionRequired: currentProposal.status === 'approved',
      };

      return NextResponse.json(response);
    }

    if (snapshot.status === 'approved') {
      await supabase.from('activity_log').insert({
        trip_id: proposal.trip_id,
        user_id: user.id,
        action: 'proposal_approved',
        details: { proposalId: id },
      });
    }

    if (snapshot.status === 'rejected') {
      await supabase.from('activity_log').insert({
        trip_id: proposal.trip_id,
        user_id: user.id,
        action: 'proposal_rejected',
        details: { proposalId: id, reason: 'majority_vote_against' },
      });
    }

    const response: ProposalVoteResponse = {
      proposalId: id,
      status: snapshot.status,
      votesFor: snapshot.votesFor,
      votesAgainst: snapshot.votesAgainst,
      userVote: body.vote,
      eligibleVoters: snapshot.eligibleVoters,
      requiredVotes: snapshot.requiredVotes,
      ownerDecisionRequired: snapshot.ownerDecisionRequired,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error voting:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
