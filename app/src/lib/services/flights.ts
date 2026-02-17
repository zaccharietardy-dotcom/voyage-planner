/**
 * Service de recherche de vols RÉELS
 *
 * IMPORTANT: Ce service ne génère JAMAIS de faux vols.
 * Si aucune API n'est configurée ou ne retourne de résultats,
 * une liste vide est retournée avec un message d'erreur.
 *
 * Strategie (ordre de priorite):
 * 1. SerpAPI (RECOMMANDÉ) - Scrape Google Flights, 100 recherches/mois gratuites
 * 2. Gemini + Google Search - Peut halluciner, moins fiable
 *
 * Configuration recommandée (dans .env.local):
 * SERPAPI_KEY=xxx  ← Créer compte gratuit sur https://serpapi.com/
 */

import { Flight, FlightSearchResult } from '../types';
import { searchFlightsWithGemini, isGeminiConfigured } from './geminiSearch';
import { searchFlightsWithSerpApi, isSerpApiConfigured } from './serpApiSearch';
import { filterValidFlights } from './flightValidator';

interface FlightSearchParams {
  originCode: string;
  destinationCode: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

/**
 * Recherche des vols RÉELS uniquement
 *
 * Ordre de priorite:
 * 1. SerpAPI (Google Flights scraping) - VOLS 100% RÉELS ✅
 * 2. Gemini + Google Search - ⚠️ peut halluciner
 *
 * Si aucun vol trouvé → retourne liste vide + erreur (pas de faux vols!)
 */
export async function searchFlights(params: FlightSearchParams): Promise<FlightSearchResult> {
  // 1. PRIORITE ABSOLUE: SerpAPI (scrape Google Flights = données RÉELLES)
  if (isSerpApiConfigured()) {
    try {
      const outboundFlights = await searchFlightsWithSerpApi(
        params.originCode,
        params.destinationCode,
        params.departureDate,
        params.adults
      );

      let returnFlights: Flight[] = [];
      if (params.returnDate) {
        returnFlights = await searchFlightsWithSerpApi(
          params.destinationCode,
          params.originCode,
          params.returnDate,
          params.adults,
          true // isReturn = true pour les vols retour
        );
      }

      // VALIDATION: Filtrer les vols invalides
      const validOutbound = filterValidFlights(outboundFlights);
      const validReturn = filterValidFlights(returnFlights);

      if (validOutbound.length > 0) {
        return {
          outboundFlights: validOutbound,
          returnFlights: validReturn,
          searchedAt: new Date(),
        };
      }
    } catch (error) {
      console.error('[Flights] SerpAPI error:', error);
    }
  }

  // 2. Fallback: Gemini + Google Search
  if (isGeminiConfigured()) {
    try {
      const outboundFlights = await searchFlightsWithGemini(
        params.originCode,
        params.destinationCode,
        params.departureDate,
        params.adults
      );

      let returnFlights: Flight[] = [];
      if (params.returnDate) {
        returnFlights = await searchFlightsWithGemini(
          params.destinationCode,
          params.originCode,
          params.returnDate,
          params.adults
        );
      }

      // VALIDATION: Filtrer les vols invalides
      const validOutbound = filterValidFlights(outboundFlights);
      const validReturn = filterValidFlights(returnFlights);

      if (validOutbound.length > 0) {
        return {
          outboundFlights: validOutbound,
          returnFlights: validReturn,
          searchedAt: new Date(),
        };
      }
    } catch (error) {
      console.error('[Flights] Gemini search error:', error);
    }
  }

  // ❌ AUCUNE API DE VOLS CONFIGURÉE OU AUCUN VOL TROUVÉ
  // On NE génère PAS de faux vols - on retourne une liste vide avec un message d'erreur
  console.error('[Flights] ════════════════════════════════════════════════════════');
  console.error('[Flights] ❌ ERREUR: Aucun vol réel trouvé!');
  console.error('[Flights] ');
  console.error('[Flights] APIs testées:');
  console.error(`[Flights]   • SerpAPI: ${isSerpApiConfigured() ? '✅ configurée mais 0 résultats' : '❌ NON configurée'}`);
  console.error(`[Flights]   • Gemini: ${isGeminiConfigured() ? '✅ configurée mais 0 résultats' : '❌ NON configurée'}`);
  console.error('[Flights] ');
  console.error('[Flights] Solution: Configurez SERPAPI_KEY dans .env.local');
  console.error('[Flights] Créer un compte gratuit: https://serpapi.com/');
  console.error('[Flights] ════════════════════════════════════════════════════════');

  // Retourner une liste vide au lieu de faux vols
  return {
    outboundFlights: [],
    returnFlights: [],
    searchedAt: new Date(),
    error: 'Aucun vol réel trouvé. Veuillez configurer une API de vols (SerpAPI recommandé).',
  };
}

/**
 * Formate la durée d'un vol
 */
export function formatFlightDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? mins.toString().padStart(2, '0') : ''}`;
}

/**
 * Formate l'heure d'un vol
 */
export function formatFlightTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
