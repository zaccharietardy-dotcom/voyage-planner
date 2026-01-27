import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { ProposedChange } from '@/lib/types/collaboration';
import type { Proposal } from '@/lib/supabase/types';

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

    const { vote } = await request.json() as { vote: boolean };

    if (typeof vote !== 'boolean') {
      return NextResponse.json({ error: 'Vote invalide (true ou false)' }, { status: 400 });
    }

    // Récupérer la proposition
    const { data: proposalData, error: proposalError } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .single();

    if (proposalError || !proposalData) {
      return NextResponse.json({ error: 'Proposition non trouvée' }, { status: 404 });
    }

    const proposal = proposalData as Proposal;

    if (proposal.status !== 'pending') {
      return NextResponse.json({ error: 'Cette proposition a déjà été résolue' }, { status: 400 });
    }

    // Vérifier que l'utilisateur est membre du voyage
    const { data: member } = await supabase
      .from('trip_members')
      .select('role')
      .eq('trip_id', proposal.trip_id)
      .eq('user_id', user.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: 'Vous n\'êtes pas membre de ce voyage' }, { status: 403 });
    }

    // L'auteur ne peut pas voter sur sa propre proposition
    if (proposal.author_id === user.id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas voter sur votre propre proposition' }, { status: 400 });
    }

    // Upsert le vote
    const { error: voteError } = await supabase
      .from('votes')
      .upsert(
        {
          proposal_id: id,
          user_id: user.id,
          vote,
        },
        { onConflict: 'proposal_id,user_id' }
      );

    if (voteError) {
      return NextResponse.json({ error: voteError.message }, { status: 500 });
    }

    // Recalculer les totaux
    const { data: votes } = await supabase
      .from('votes')
      .select('vote')
      .eq('proposal_id', id);

    const votesFor = votes?.filter((v) => v.vote).length || 0;
    const votesAgainst = votes?.filter((v) => !v.vote).length || 0;

    // Mettre à jour les totaux
    await supabase
      .from('proposals')
      .update({ votes_for: votesFor, votes_against: votesAgainst })
      .eq('id', id);

    // Log d'activité
    await supabase.from('activity_log').insert({
      trip_id: proposal.trip_id,
      user_id: user.id,
      action: 'proposal_voted',
      details: { proposalId: id, vote },
    });

    // Vérifier si majorité atteinte
    const { data: members } = await supabase
      .from('trip_members')
      .select('id')
      .eq('trip_id', proposal.trip_id);

    const totalMembers = members?.length || 1;
    // Majorité = plus de la moitié des membres (excluant l'auteur qui ne vote pas)
    const votingMembers = totalMembers - 1; // -1 car l'auteur ne vote pas
    const majorityThreshold = Math.ceil(votingMembers / 2);

    let newStatus = 'pending';

    if (votesFor >= majorityThreshold && votesFor > votesAgainst) {
      // Approuver et merger
      newStatus = 'merged';
      await mergeProposal(id, proposal.trip_id, proposal.changes as unknown as ProposedChange[], supabase);

      // Log d'activité
      await supabase.from('activity_log').insert({
        trip_id: proposal.trip_id,
        user_id: user.id,
        action: 'proposal_merged',
        details: { proposalId: id },
      });
    } else if (votesAgainst >= majorityThreshold && votesAgainst > votesFor) {
      // Rejeter
      newStatus = 'rejected';
      await supabase
        .from('proposals')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('id', id);

      // Log d'activité
      await supabase.from('activity_log').insert({
        trip_id: proposal.trip_id,
        user_id: user.id,
        action: 'proposal_rejected',
        details: { proposalId: id },
      });
    }

    return NextResponse.json({
      votesFor,
      votesAgainst,
      status: newStatus,
      userVote: vote,
    });
  } catch (error) {
    console.error('Error voting:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Fonction pour appliquer les changements d'une proposition
async function mergeProposal(
  proposalId: string,
  tripId: string,
  changes: ProposedChange[],
  supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>
) {
  // Récupérer le voyage
  const { data: trip } = await supabase
    .from('trips')
    .select('data')
    .eq('id', tripId)
    .single();

  if (!trip) return;

  const tripData = trip.data as any;

  // Appliquer chaque changement
  for (const change of changes) {
    applyChange(tripData, change);
  }

  // Sauvegarder le voyage modifié
  await supabase
    .from('trips')
    .update({
      data: tripData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId);

  // Marquer la proposition comme merged
  await supabase
    .from('proposals')
    .update({ status: 'merged', resolved_at: new Date().toISOString() })
    .eq('id', proposalId);
}

// Appliquer un changement au voyage
function applyChange(tripData: any, change: ProposedChange) {
  const days = tripData.days || [];
  const dayIndex = change.dayNumber - 1;

  if (dayIndex < 0 || dayIndex >= days.length) {
    console.warn(`Day ${change.dayNumber} not found`);
    return;
  }

  const day = days[dayIndex];
  const items = day.items || [];

  switch (change.type) {
    case 'add_activity':
      if (change.data.activity) {
        items.push({
          id: crypto.randomUUID(),
          ...change.data.activity,
          dayNumber: change.dayNumber,
        });
      }
      break;

    case 'remove_activity':
      if (change.targetId) {
        day.items = items.filter((item: any) => item.id !== change.targetId);
      }
      break;

    case 'move_activity':
      if (change.data.fromDay !== undefined && change.data.toDay !== undefined) {
        const fromDayIndex = change.data.fromDay - 1;
        const toDayIndex = change.data.toDay - 1;
        const fromIndex = change.data.fromIndex || 0;
        const toIndex = change.data.toIndex || 0;

        if (fromDayIndex >= 0 && fromDayIndex < days.length &&
            toDayIndex >= 0 && toDayIndex < days.length) {
          const [movedItem] = days[fromDayIndex].items.splice(fromIndex, 1);
          if (movedItem) {
            movedItem.dayNumber = change.data.toDay;
            days[toDayIndex].items.splice(toIndex, 0, movedItem);
          }
        }
      }
      break;

    case 'modify_activity':
      if (change.targetId && change.data.activity) {
        const itemIndex = items.findIndex((item: any) => item.id === change.targetId);
        if (itemIndex >= 0) {
          items[itemIndex] = { ...items[itemIndex], ...change.data.activity };
        }
      }
      break;

    case 'change_time':
      if (change.targetId) {
        const itemIndex = items.findIndex((item: any) => item.id === change.targetId);
        if (itemIndex >= 0) {
          if (change.data.newStartTime) {
            items[itemIndex].startTime = change.data.newStartTime;
          }
          if (change.data.newEndTime) {
            items[itemIndex].endTime = change.data.newEndTime;
          }
        }
      }
      break;

    default:
      console.warn(`Unknown change type: ${change.type}`);
  }

  day.items = items;
  days[dayIndex] = day;
  tripData.days = days;
}
