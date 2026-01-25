import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { TripPreferences } from '@/lib/types';

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

    // Convertir la date string en Date object
    const preferences: TripPreferences = {
      ...body,
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
