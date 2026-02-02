import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { TripPreferences } from '@/lib/types';
import { normalizeCity } from '@/lib/services/cityNormalization';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export const maxDuration = 300; // 5 minutes max (SerpAPI + Claude Sonnet + pipeline)

const FREE_MONTHLY_LIMIT = 2;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validation basique
    if (!body.origin || !body.destination || !body.startDate) {
      return NextResponse.json(
        { error: 'Paramètres manquants: origin, destination, startDate requis' },
        { status: 400 }
      );
    }

    // Check subscription quota
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_status, extra_trips')
        .eq('id', user.id)
        .single();

      if (!profile?.subscription_status || profile.subscription_status !== 'pro') {
        // Count trips created this month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { count } = await supabase
          .from('trips')
          .select('*', { count: 'exact', head: true })
          .eq('owner_id', user.id)
          .gte('created_at', startOfMonth.toISOString());

        const totalAllowed = FREE_MONTHLY_LIMIT + (profile?.extra_trips || 0);

        if (count !== null && count >= totalAllowed) {
          return NextResponse.json(
            { error: 'Limite de voyages gratuits atteinte. Passez à Pro pour des voyages illimités.', code: 'QUOTA_EXCEEDED' },
            { status: 403 }
          );
        }
      }
    }

    // Normaliser les noms de villes (supporte toutes les langues: chinois, arabe, etc.)
    const normalizedOrigin = await normalizeCity(body.origin);
    const normalizedDestination = await normalizeCity(body.destination);

    console.log(`[API] Normalisation: "${body.origin}" → "${normalizedOrigin.displayName}" (${normalizedOrigin.confidence})`);
    console.log(`[API] Normalisation: "${body.destination}" → "${normalizedDestination.displayName}" (${normalizedDestination.confidence})`);

    // Convertir la date string en Date object
    const preferences: TripPreferences = {
      ...body,
      origin: normalizedOrigin.displayName,
      destination: normalizedDestination.displayName,
      startDate: new Date(body.startDate),
    };

    // Générer le voyage
    const trip = await generateTripWithAI(preferences);

    return NextResponse.json(trip);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('Erreur de génération:', message, stack);
    return NextResponse.json(
      { error: `Erreur lors de la génération du voyage: ${message}` },
      { status: 500 }
    );
  }
}
