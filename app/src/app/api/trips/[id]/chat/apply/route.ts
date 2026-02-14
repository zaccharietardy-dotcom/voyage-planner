/**
 * Chat Apply API Endpoint
 *
 * POST /api/trips/[id]/chat/apply - Applique les modifications confirmées
 */

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { TripDay, TripChange } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Vérifier l'accès au voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, owner_id, data')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut appliquer ces modifications' }, { status: 403 });
    }

    // Parser le body
    const body = await request.json();
    const { newDays, changes } = body as {
      newDays: TripDay[];
      changes: TripChange[];
    };

    if (!newDays || !Array.isArray(newDays)) {
      return NextResponse.json({ error: 'newDays requis' }, { status: 400 });
    }

    // Mettre à jour le voyage avec les nouveaux jours
    const tripData = trip.data as Record<string, unknown>;
    const preferences = tripData.preferences as Record<string, unknown> | undefined;
    const oldDaysCount = Array.isArray(tripData.days) ? (tripData.days as unknown[]).length : 0;
    const newDaysCount = newDays.length;
    const daysChanged = newDaysCount !== oldDaysCount;

    // Mettre à jour preferences.durationDays si le nombre de jours a changé
    const updatedPreferences = daysChanged && preferences
      ? { ...preferences, durationDays: newDaysCount }
      : preferences;

    // Recalculer les coûts d'hébergement si le nombre de jours a changé
    let updatedCostBreakdown = tripData.costBreakdown as Record<string, number> | undefined;
    let updatedTotalCost = tripData.totalEstimatedCost as number | undefined;

    if (daysChanged && updatedCostBreakdown) {
      const accommodation = tripData.accommodation as { pricePerNight?: number } | undefined;
      const pricePerNight = accommodation?.pricePerNight || 0;
      const oldAccommodationCost = updatedCostBreakdown.accommodation || 0;
      const newNights = newDaysCount - 1; // Nuits = jours - 1
      const newAccommodationCost = pricePerNight > 0 ? pricePerNight * newNights : oldAccommodationCost;
      const costDiff = newAccommodationCost - oldAccommodationCost;

      updatedCostBreakdown = {
        ...updatedCostBreakdown,
        accommodation: newAccommodationCost,
      };

      if (updatedTotalCost) {
        updatedTotalCost = updatedTotalCost + costDiff;
      }
    }

    const updatedData = {
      ...tripData,
      days: newDays,
      ...(updatedPreferences ? { preferences: updatedPreferences } : {}),
      ...(updatedCostBreakdown ? { costBreakdown: updatedCostBreakdown } : {}),
      ...(updatedTotalCost !== undefined ? { totalEstimatedCost: updatedTotalCost } : {}),
    };

    const { error: updateError } = await supabase
      .from('trips')
      .update({
        data: updatedData as unknown as Record<string, never>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tripId);

    if (updateError) {
      console.error('[Chat Apply] Update error:', updateError);
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du voyage' },
        { status: 500 }
      );
    }

    // Mettre à jour le dernier message assistant avec les changements appliqués
    // Note: Using 'any' cast because trip_chat_messages table is created by migration
    if (changes && changes.length > 0) {
      const { data: lastMessage } = await (supabase as any)
        .from('trip_chat_messages')
        .select('id')
        .eq('trip_id', tripId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMessage) {
        await (supabase as any)
          .from('trip_chat_messages')
          .update({ changes_applied: changes })
          .eq('id', lastMessage.id);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Modifications appliquées avec succès',
    });
  } catch (error) {
    console.error('[Chat Apply API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de l\'application des modifications' },
      { status: 500 }
    );
  }
}

// DELETE - Annuler (restaurer l'état précédent)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Parser le body avec les données de rollback
    const body = await request.json();
    const { rollbackDays } = body as { rollbackDays: TripDay[] };

    if (!rollbackDays || !Array.isArray(rollbackDays)) {
      return NextResponse.json({ error: 'rollbackDays requis' }, { status: 400 });
    }

    // Vérifier l'accès
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, owner_id, data')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    if (trip.owner_id !== user.id) {
      return NextResponse.json({ error: 'Seul le propriétaire peut annuler ces modifications' }, { status: 403 });
    }

    // Restaurer les données (y compris durationDays)
    const tripData = trip.data as Record<string, unknown>;
    const preferences = tripData.preferences as Record<string, unknown> | undefined;
    const restoredPreferences = preferences
      ? { ...preferences, durationDays: rollbackDays.length }
      : preferences;

    const restoredData = {
      ...tripData,
      days: rollbackDays,
      ...(restoredPreferences ? { preferences: restoredPreferences } : {}),
    };

    const { error: updateError } = await supabase
      .from('trips')
      .update({
        data: restoredData as unknown as Record<string, never>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tripId);

    if (updateError) {
      console.error('[Chat Apply] Rollback error:', updateError);
      return NextResponse.json(
        { error: 'Erreur lors de l\'annulation' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Modifications annulées',
    });
  } catch (error) {
    console.error('[Chat Apply API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de l\'annulation' },
      { status: 500 }
    );
  }
}
