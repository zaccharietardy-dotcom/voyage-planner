import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { ProposedChange } from '@/lib/types/collaboration';
import type { Json } from '@/lib/supabase/types';

// GET /api/trips/[id]/proposals - Liste les propositions d'un voyage
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Récupérer les propositions
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

    // Récupérer les votes de l'utilisateur
    let userVotes: Record<string, boolean> = {};
    if (user && proposals) {
      const proposalIds = proposals.map((p) => p.id);
      const { data: votes } = await supabase
        .from('votes')
        .select('proposal_id, vote')
        .eq('user_id', user.id)
        .in('proposal_id', proposalIds);

      userVotes = (votes || []).reduce((acc, v) => {
        acc[v.proposal_id] = v.vote;
        return acc;
      }, {} as Record<string, boolean>);
    }

    const formattedProposals = proposals?.map((p) => ({
      id: p.id,
      tripId: p.trip_id,
      authorId: p.author_id,
      author: {
        displayName: (p.author as any)?.display_name || 'Utilisateur',
        avatarUrl: (p.author as any)?.avatar_url,
      },
      title: p.title,
      description: p.description,
      changes: p.changes,
      status: p.status,
      votesFor: p.votes_for,
      votesAgainst: p.votes_against,
      userVote: userVotes[p.id],
      createdAt: p.created_at,
      resolvedAt: p.resolved_at,
    }));

    return NextResponse.json(formattedProposals || []);
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

    // Vérifier que l'utilisateur est membre du voyage
    const { data: member } = await supabase
      .from('trip_members')
      .select('role')
      .eq('trip_id', id)
      .eq('user_id', user.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: 'Vous n\'êtes pas membre de ce voyage' }, { status: 403 });
    }

    if (member.role === 'viewer') {
      return NextResponse.json({ error: 'Les viewers ne peuvent pas créer de propositions' }, { status: 403 });
    }

    const { title, description, changes } = await request.json() as {
      title: string;
      description?: string;
      changes: ProposedChange[];
    };

    if (!title || !changes || changes.length === 0) {
      return NextResponse.json({ error: 'Titre et changements requis' }, { status: 400 });
    }

    // Créer la proposition
    const { data: proposal, error } = await supabase
      .from('proposals')
      .insert({
        trip_id: id,
        author_id: user.id,
        title,
        description,
        changes: changes as unknown as Json,
        status: 'pending',
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log d'activité
    await supabase.from('activity_log').insert({
      trip_id: id,
      user_id: user.id,
      action: 'proposal_created',
      details: { proposalId: proposal.id, title },
    });

    const formattedProposal = {
      id: proposal.id,
      tripId: proposal.trip_id,
      authorId: proposal.author_id,
      author: {
        displayName: (proposal.author as any)?.display_name || 'Utilisateur',
        avatarUrl: (proposal.author as any)?.avatar_url,
      },
      title: proposal.title,
      description: proposal.description,
      changes: proposal.changes,
      status: proposal.status,
      votesFor: proposal.votes_for,
      votesAgainst: proposal.votes_against,
      userVote: undefined,
      createdAt: proposal.created_at,
      resolvedAt: proposal.resolved_at,
    };

    return NextResponse.json(formattedProposal);
  } catch (error) {
    console.error('Error creating proposal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
