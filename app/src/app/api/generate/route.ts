import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { TripPreferences } from '@/lib/types';
import { normalizeCity } from '@/lib/services/cityNormalization';

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
    console.error('Erreur de génération:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération du voyage' },
      { status: 500 }
    );
  }
}
