/**
 * Chat Suggestions API Endpoint
 *
 * POST /api/trips/[id]/chat/suggestions - Génère des suggestions contextuelles
 */

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { generateContextualSuggestions } from '@/lib/services/intentClassifier';
import { TripDay, TripPreferences } from '@/lib/types';

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

    // Vérifier accès
    const isOwner = trip.owner_id === user.id;
    let hasAccess = isOwner;

    if (!isOwner) {
      const { data: member } = await supabase
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .single();

      hasAccess = !!member;
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Extraire les données du voyage
    const tripData = trip.data as {
      preferences?: TripPreferences;
      days?: TripDay[];
    };
    const destination = tripData?.preferences?.destination || 'destination inconnue';
    const days: TripDay[] = tripData?.days || [];

    if (days.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Générer les suggestions contextuelles
    const suggestions = await generateContextualSuggestions(destination, days);

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[Chat Suggestions API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération des suggestions' },
      { status: 500 }
    );
  }
}
