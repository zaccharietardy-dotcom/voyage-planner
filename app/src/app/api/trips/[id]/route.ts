import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAcceptedCloseFriend } from '@/lib/server/closeFriends';
import type { Json } from '@/lib/supabase/types';
import type { Database } from '@/lib/supabase/types';
import type { MemberRole } from '@/lib/types/collaboration';
import {
  formatProposalForApi,
  getEditorUserIds,
  type ProposalSelectRow,
} from '@/lib/server/collaboration';
import { redactTripDataForLimitedViewer } from '@/lib/server/tripRedaction';

interface ProfileRow {
  id?: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface TripMemberWithProfile {
  id: string;
  role: MemberRole;
  joined_at: string;
  user_id: string;
  profiles: ProfileRow | ProfileRow[] | null;
}

interface VoteRow {
  proposal_id: string;
  vote: boolean;
}

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function buildLimitedViewerTripPayload<T extends { data: unknown; share_code: string | null }>(trip: T): T {
  return {
    ...trip,
    share_code: '',
    data: redactTripDataForLimitedViewer(trip.data),
  };
}

// GET /api/trips/[id] - Récupérer un voyage avec ses membres et propositions
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Exclure generator_ip de la réponse (donnée sensible pour anti-abus)
    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('id, owner_id, name, title, destination, start_date, end_date, duration_days, preferences, data, share_code, visibility, created_at, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Check access: owner, trip_member, or visibility-based
    let userRole: MemberRole | null = null;
    let hasCollaborationAccess = false;

    if (user) {
      const isOwner = trip.owner_id === user.id;
      userRole = isOwner ? 'owner' : null;
      hasCollaborationAccess = isOwner;

      if (!isOwner) {
        const { data: member } = await serviceClient
          .from('trip_members')
          .select('role')
          .eq('trip_id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (member && (member.role === 'owner' || member.role === 'editor' || member.role === 'viewer')) {
          userRole = member.role;
          hasCollaborationAccess = true;
        } else if (trip.visibility === 'public') {
          userRole = 'viewer';
        } else if (trip.visibility === 'friends') {
          const isCloseFriend = await isAcceptedCloseFriend(supabase, user.id, trip.owner_id);
          if (isCloseFriend) {
            userRole = 'viewer';
          }
        }
      }
    } else if (trip.visibility === 'public') {
      // Unauthenticated: only allow public trips
      userRole = 'viewer';
    }

    if (!userRole) {
      return NextResponse.json(
        { error: user ? 'Accès refusé' : 'Non authentifié' },
        { status: user ? 403 : 401 }
      );
    }

    let formattedProposals: ReturnType<typeof formatProposalForApi>[] = [];
    let formattedMembers: Array<{
      id: string;
      tripId: string;
      userId: string;
      role: MemberRole;
      joinedAt: string;
      profile: {
        displayName: string;
        avatarUrl: string | null;
        email: string;
      };
    }> = [];

    // Public/friends viewers can read the trip itself, but collaboration details
    // (members/proposals/votes/share code) are restricted to owner/members.
    if (hasCollaborationAccess) {
      const { data: memberRows } = await serviceClient
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

      const { data: proposalRows } = await serviceClient
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

      const userVotes: Record<string, boolean> = {};
      if (user && proposalRows && proposalRows.length > 0) {
        const proposalIds = proposalRows.map((proposal) => proposal.id);
        const { data: votes } = await serviceClient
          .from('votes')
          .select('proposal_id, vote')
          .eq('user_id', user.id)
          .in('proposal_id', proposalIds);

        for (const vote of (votes || []) as VoteRow[]) {
          userVotes[vote.proposal_id] = vote.vote;
        }
      }

      const editorUserIds = await getEditorUserIds(serviceClient, id);

      formattedProposals = (proposalRows || []).map((proposal) =>
        formatProposalForApi(
          proposal as ProposalSelectRow,
          userVotes[proposal.id],
          editorUserIds
        )
      );

      const typedMemberRows = (memberRows || []) as TripMemberWithProfile[];
      formattedMembers = typedMemberRows.map((member) => {
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;

        return {
          id: member.id,
          tripId: id,
          userId: member.user_id,
          role: member.role,
          joinedAt: member.joined_at,
          profile: {
            displayName: profile?.display_name || 'Utilisateur',
            avatarUrl: profile?.avatar_url ?? null,
            // Ne pas exposer les emails des autres membres (privacy)
            email: member.user_id === user?.id ? (profile?.email || '') : '',
          },
        };
      });
    }

    const tripPayload = hasCollaborationAccess
      ? trip
      : buildLimitedViewerTripPayload(trip);

    return NextResponse.json({
      ...tripPayload,
      members: formattedMembers,
      proposals: formattedProposals,
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
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Proposals First: seules les modifications owner passent en PATCH direct
    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut modifier directement le voyage' }, { status: 403 });
    }

    const updates = await request.json() as {
      data?: Json;
      visibility?: 'public' | 'friends' | 'private';
      title?: string;
    };

    const updateObj: {
      updated_at: string;
      data?: Json;
      visibility?: 'public' | 'friends' | 'private';
      title?: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (updates.data !== undefined) {
      updateObj.data = updates.data;
    }

    if (updates.visibility !== undefined) {
      updateObj.visibility = updates.visibility;
    }

    if (updates.title !== undefined) {
      updateObj.title = updates.title;
    }

    const { data: updatedTrip, error } = await supabase
      .from('trips')
      .update(updateObj)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const serviceClient = getServiceClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data: trip, error: tripError } = await serviceClient
      .from('trips')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut supprimer le voyage' }, { status: 403 });
    }

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
