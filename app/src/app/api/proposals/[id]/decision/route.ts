import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { Json, Proposal as DbProposal } from '@/lib/supabase/types';
import type { ProposalDecisionResponse } from '@/lib/types/collaboration';
import { parseProposedChanges } from '@/lib/server/collaboration';
import { mergeProposalChangesIntoTripData } from '@/lib/server/proposalMerge';

interface DecisionRequest {
  decision: 'merge' | 'reject';
}

// POST /api/proposals/[id]/decision - Décision finale du propriétaire
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

    const body = await request.json() as DecisionRequest;
    if (body.decision !== 'merge' && body.decision !== 'reject') {
      return NextResponse.json({ error: 'Décision invalide' }, { status: 400 });
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

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, owner_id, data')
      .eq('id', proposal.trip_id)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut prendre la décision finale' }, { status: 403 });
    }

    if (proposal.status !== 'approved') {
      return NextResponse.json({ error: 'La proposition doit être approuvée avant décision du propriétaire' }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (body.decision === 'reject') {
      const { data: updatedProposal, error: updateError } = await supabase
        .from('proposals')
        .update({
          status: 'rejected',
          resolved_at: now,
        })
        .eq('id', id)
        .eq('status', 'approved')
        .select('id')
        .maybeSingle();

      if (updateError || !updatedProposal) {
        return NextResponse.json({ error: updateError?.message || 'La proposition a déjà été traitée' }, { status: 409 });
      }

      await supabase.from('activity_log').insert({
        trip_id: proposal.trip_id,
        user_id: user.id,
        action: 'proposal_rejected',
        details: { proposalId: id, reason: 'owner_decision' },
      });

      const response: ProposalDecisionResponse = {
        proposalId: id,
        status: 'rejected',
        ownerDecisionRequired: false,
      };

      return NextResponse.json(response);
    }

    const changes = parseProposedChanges(proposal.changes);
    const mergedData = mergeProposalChangesIntoTripData(trip.data, changes);

    const { error: tripUpdateError } = await supabase
      .from('trips')
      .update({
        data: mergedData as unknown as Json,
        updated_at: now,
      })
      .eq('id', proposal.trip_id);

    if (tripUpdateError) {
      return NextResponse.json({ error: tripUpdateError.message }, { status: 500 });
    }

    const { data: mergedProposal, error: proposalUpdateError } = await supabase
      .from('proposals')
      .update({
        status: 'merged',
        resolved_at: now,
      })
      .eq('id', id)
      .eq('status', 'approved')
      .select('id')
      .maybeSingle();

    if (proposalUpdateError || !mergedProposal) {
      return NextResponse.json({ error: proposalUpdateError?.message || 'La proposition a déjà été traitée' }, { status: 409 });
    }

    await supabase.from('activity_log').insert({
      trip_id: proposal.trip_id,
      user_id: user.id,
      action: 'proposal_merged',
      details: { proposalId: id },
    });

    const response: ProposalDecisionResponse = {
      proposalId: id,
      status: 'merged',
      ownerDecisionRequired: false,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error deciding proposal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
