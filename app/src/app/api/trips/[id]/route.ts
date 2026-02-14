import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';

// GET /api/trips/[id] - Récupérer un voyage avec ses membres et propositions
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Récupérer le voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Check access: owner, trip_member, or visibility-based
    let userRole: string | null = null;

    if (user) {
      const isOwner = trip.owner_id === user.id;
      userRole = isOwner ? 'owner' : null;

      if (!isOwner) {
        // Check trip_members
        const { data: member } = await supabase
          .from('trip_members')
          .select('role')
          .eq('trip_id', id)
          .eq('user_id', user.id)
          .single();

        if (member) {
          userRole = member.role;
        } else if (trip.visibility === 'public') {
          userRole = 'viewer';
        } else if (trip.visibility === 'friends') {
          const isCloseFriend = await isAcceptedCloseFriend(supabase, user.id, trip.owner_id);
          if (isCloseFriend) {
            userRole = 'viewer';
          }
        }
      }
    } else {
      // Unauthenticated: only allow public trips
      if (trip.visibility === 'public') {
        userRole = 'viewer';
      }
    }

    if (!userRole) {
      return NextResponse.json(
        { error: user ? 'Accès refusé' : 'Non authentifié' },
        { status: user ? 403 : 401 }
      );
    }

    // Récupérer les membres avec leurs profils
    const { data: members } = await supabase
      .from('trip_members')
      .select(`
        id,
        role,
        joined_at,
        user_id,
        profiles:user_id (
          id,
          display_name,
          avatar_url,
          email
        )
      `)
      .eq('trip_id', id);

    // Récupérer les propositions en attente
    const { data: proposals } = await supabase
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

    // Récupérer les votes de l'utilisateur sur les propositions
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

    // Formater les propositions avec le vote de l'utilisateur
    const formattedProposals = proposals?.map((p) => {
      const author = p.author as { display_name?: string | null; avatar_url?: string | null } | null;
      return {
        id: p.id,
        tripId: p.trip_id,
        authorId: p.author_id,
        author: {
          displayName: author?.display_name || 'Utilisateur',
          avatarUrl: author?.avatar_url,
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
      };
    });

    // Formater les membres
    const formattedMembers = members?.map((m) => {
      const profile = m.profiles as {
        display_name?: string | null;
        avatar_url?: string | null;
        email?: string | null;
      } | null;
      return {
        id: m.id,
        tripId: id,
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        profile: {
          displayName: profile?.display_name || 'Utilisateur',
          avatarUrl: profile?.avatar_url,
          email: profile?.email || '',
        },
      };
    });

    return NextResponse.json({
      ...trip,
      members: formattedMembers || [],
      proposals: formattedProposals || [],
      userRole,
    });
  } catch (error) {
    console.error('Error fetching trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// PATCH /api/trips/[id] - Mettre à jour un voyage
export async function PATCH(
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

    // Vérifier que l'utilisateur est owner ou editor
    // First check if user is trip owner
    const { data: trip } = await supabase
      .from('trips')
      .select('owner_id')
      .eq('id', id)
      .single();

    const isOwner = trip?.owner_id === user.id;

    if (!isOwner) {
      // Fallback: check trip_members
      const { data: member } = await supabase
        .from('trip_members')
        .select('role')
        .eq('trip_id', id)
        .eq('user_id', user.id)
        .single();

      if (!member || member.role === 'viewer') {
        return NextResponse.json({ error: 'Permission refusée' }, { status: 403 });
      }
    }

    const updates = await request.json();

    // Only owner can change visibility
    if (updates.visibility !== undefined && !isOwner) {
      return NextResponse.json({ error: 'Seul le propri\u00e9taire peut changer la visibilit\u00e9' }, { status: 403 });
    }

    // Build update object
    const updateObj: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.data !== undefined) updateObj.data = updates.data;
    if (updates.visibility !== undefined) updateObj.visibility = updates.visibility;
    if (updates.title !== undefined) updateObj.title = updates.title;

    // Mettre à jour le voyage
    const { data: updatedTrip, error } = await supabase
      .from('trips')
      .update(updateObj)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log d'activité
    await supabase.from('activity_log').insert({
      trip_id: id,
      user_id: user.id,
      action: 'trip_modified',
      details: { updatedFields: Object.keys(updates) },
    });

    return NextResponse.json(updatedTrip);
  } catch (error) {
    console.error('Error updating trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/trips/[id] - Supprimer un voyage
export async function DELETE(
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

    // Vérifier que l'utilisateur est owner
    const { data: member } = await supabase
      .from('trip_members')
      .select('role')
      .eq('trip_id', id)
      .eq('user_id', user.id)
      .single();

    if (!member || member.role !== 'owner') {
      return NextResponse.json({ error: 'Seul le propriétaire peut supprimer le voyage' }, { status: 403 });
    }

    // Supprimer le voyage (les cascades supprimeront membres, propositions, votes)
    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting trip:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
