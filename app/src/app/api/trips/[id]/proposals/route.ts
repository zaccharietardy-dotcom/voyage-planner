import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { ProposedChange, type ProposalStatus } from '@/lib/types/collaboration';
import type { Json } from '@/lib/supabase/types';
import {
  formatProposalForApi,
  getEditorUserIds,
  getEligibleVoterCount,
  getTripRoleForUser,
  type ProposalSelectRow,
} from '@/lib/server/collaboration';

interface VoteRow {
  proposal_id: string;
  vote: boolean;
}

interface CreateProposalRequest {
  title: string;
  description?: string;
  changes: ProposedChange[];
}

// GET /api/trips/[id]/proposals - Liste les propositions d'un voyage
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const role = await getTripRoleForUser(supabase, id, user.id);
    if (!role) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { data: proposals, error } = await supabase
      .from('proposals')
      .select(`
        *,
        author:author_id (
          display_name,
          avatar_url
        )
      `)
      .eq('trip_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const editorUserIds = await getEditorUserIds(supabase, id);

    const userVotes: Record<string, boolean> = {};
    if (proposals && proposals.length > 0) {
      const proposalIds = proposals.map((proposal) => proposal.id);
      const { data: votes } = await supabase
        .from('votes')
        .select('proposal_id, vote')
        .eq('user_id', user.id)
        .in('proposal_id', proposalIds);

      for (const vote of (votes || []) as VoteRow[]) {
        userVotes[vote.proposal_id] = vote.vote;
      }
    }

    const formattedProposals = (proposals || []).map((proposal) =>
      formatProposalForApi(
        proposal as ProposalSelectRow,
        userVotes[proposal.id],
        editorUserIds
      )
    );

    return NextResponse.json(formattedProposals);
  } catch (error) {
    console.error('Error fetching proposals:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/proposals - Créer une nouvelle proposition
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

    const role = await getTripRoleForUser(supabase, id, user.id);

    if (!role) {
      return NextResponse.json({ error: 'Vous n\'êtes pas membre de ce voyage' }, { status: 403 });
    }

    if (role === 'viewer') {
      return NextResponse.json({ error: 'Lecture seule: créez une proposition avec un rôle éditeur' }, { status: 403 });
    }

    const body = await request.json() as CreateProposalRequest;
    const title = body.title?.trim();
    const changes = body.changes;

    if (!title || !Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'Titre et changements requis' }, { status: 400 });
    }

    const editorUserIds = await getEditorUserIds(supabase, id);
    const eligibleVoters = getEligibleVoterCount(editorUserIds, user.id);
    const initialStatus: ProposalStatus = eligibleVoters === 0 ? 'approved' : 'pending';

    const { data: proposal, error } = await supabase
      .from('proposals')
      .insert({
        trip_id: id,
        author_id: user.id,
        title,
        description: body.description,
        changes: changes as unknown as Json,
        status: initialStatus,
        votes_for: 0,
        votes_against: 0,
      })
      .select(`
        *,
        author:author_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error || !proposal) {
      return NextResponse.json({ error: error?.message || 'Impossible de créer la proposition' }, { status: 500 });
    }

    await supabase.from('activity_log').insert({
      trip_id: id,
      user_id: user.id,
      action: 'proposal_created',
      details: { proposalId: proposal.id, title },
    });

    if (initialStatus === 'approved') {
      await supabase.from('activity_log').insert({
        trip_id: id,
        user_id: user.id,
        action: 'proposal_approved',
        details: { proposalId: proposal.id, reason: 'no_eligible_editor_voters' },
      });
    }

    const formattedProposal = formatProposalForApi(
      proposal as ProposalSelectRow,
      undefined,
      editorUserIds
    );

    return NextResponse.json(formattedProposal, { status: 201 });
  } catch (error) {
    console.error('Error creating proposal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
