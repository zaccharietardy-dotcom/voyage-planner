import { NextRequest, NextResponse } from 'next/server';
import { generateTripWithAI } from '@/lib/ai';
import { TripPreferences } from '@/lib/types';

/**
 * Normalise un nom de ville pour corriger les erreurs de saisie courantes
 * Ex: "BArcelone " → "Barcelone", "  paris" → "Paris"
 */
function normalizeCityName(city: string): string {
  if (!city) return city;

  // Trim et normalisation de base
  let normalized = city.trim();

  // Capitaliser correctement (première lettre majuscule, reste en minuscules pour chaque mot)
  normalized = normalized
    .toLowerCase()
    .split(/[\s-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Corrections spécifiques pour les villes mal orthographiées connues
  const corrections: Record<string, string> = {
    'Barcelone': 'Barcelone',
    'Barcelona': 'Barcelone',
    'Barcleona': 'Barcelone',
    'Barclone': 'Barcelone',
    'Barelone': 'Barcelone',
    'Barcleone': 'Barcelone',
    'Parsi': 'Paris',
    'Pars': 'Paris',
    'Londres': 'Londres',
    'London': 'Londres',
    'Londre': 'Londres',
    'Rome': 'Rome',
    'Roma': 'Rome',
    'New York': 'New York',
    'Newyork': 'New York',
    'New Yourk': 'New York',
  };

  // Vérifier si une correction existe
  if (corrections[normalized]) {
    normalized = corrections[normalized];
  }

  return normalized;
}

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

    // Normaliser les noms de villes pour corriger les erreurs de saisie
    const normalizedOrigin = normalizeCityName(body.origin);
    const normalizedDestination = normalizeCityName(body.destination);

    console.log(`[API] Normalisation: "${body.origin}" → "${normalizedOrigin}", "${body.destination}" → "${normalizedDestination}"`);

    // Convertir la date string en Date object
    const preferences: TripPreferences = {
      ...body,
      origin: normalizedOrigin,
      destination: normalizedDestination,
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
