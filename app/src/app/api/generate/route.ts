import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { TripPreferences } from '@/lib/types';
import { normalizeCity } from '@/lib/services/cityNormalization';

export const maxDuration = 300; // 5 minutes max (SerpAPI + Claude Sonnet + pipeline)

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
