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
 * 3. Amadeus API - API officielle (nécessite clés API + Secret)
 *
 * ❌ SUPPRIMÉ: Kiwi (API fermée aux nouvelles inscriptions)
 * ❌ SUPPRIMÉ: Claude (pas d'accès internet = génère des faux vols)
 * ❌ SUPPRIMÉ: Mock data (génère des faux vols)
 *
 * Configuration recommandée (dans .env.local):
 * SERPAPI_KEY=xxx  ← Créer compte gratuit sur https://serpapi.com/
 */

import { Flight, FlightSearchResult } from '../types';
import { AIRPORTS } from './geocoding';
import { searchFlightsWithGemini, isGeminiConfigured } from './geminiSearch';
import { searchFlightsWithSerpApi, isSerpApiConfigured } from './serpApiSearch';
import { validateFlightNumber, filterValidFlights } from './flightValidator';
import { generateFlightLink } from './linkGenerator';

// Configuration Amadeus (optionnel)
function getAmadeusApiKey() { return process.env.AMADEUS_API_KEY; }
function getAmadeusApiSecret() { return process.env.AMADEUS_API_SECRET; }

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
 * 2. Kiwi Tequila API - VOLS 100% RÉELS avec liens de réservation ✅
 * 3. Gemini + Google Search - ⚠️ peut halluciner
 * 4. Amadeus API (si configuree) ✅
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

  // 3. Si Amadeus est configure, l'utiliser
  if (getAmadeusApiKey() && getAmadeusApiSecret()) {
    try {
      const result = await searchWithAmadeus(params);
      if (result.outboundFlights.length > 0) {
        return result;
      }
    } catch (error) {
      console.error('[Flights] Amadeus API error:', error);
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
  console.error(`[Flights]   • Amadeus: ${!!(getAmadeusApiKey() && getAmadeusApiSecret()) ? '✅ configurée mais 0 résultats' : '❌ NON configurée'}`);
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
 * Recherche via Amadeus API
 */
async function searchWithAmadeus(params: FlightSearchParams): Promise<FlightSearchResult> {
  // 1. Obtenir un token d'accès
  const tokenResponse = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&client_id=${getAmadeusApiKey()}&client_secret=${getAmadeusApiSecret()}`,
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to get Amadeus token');
  }

  const { access_token } = await tokenResponse.json();

  // 2. Rechercher les vols
  const searchParams = new URLSearchParams({
    originLocationCode: params.originCode,
    destinationLocationCode: params.destinationCode,
    departureDate: params.departureDate,
    adults: params.adults.toString(),
    currencyCode: 'EUR',
    max: '10',
  });

  if (params.returnDate) {
    searchParams.append('returnDate', params.returnDate);
  }

  const flightsResponse = await fetch(
    `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  );

  if (!flightsResponse.ok) {
    throw new Error('Failed to search flights');
  }

  const data = await flightsResponse.json();
  return parseAmadeusResponse(data, params);
}

/**
 * Parse la réponse Amadeus
 */
function parseAmadeusResponse(data: any, params: FlightSearchParams): FlightSearchResult {
  const outboundFlights: Flight[] = [];
  const returnFlights: Flight[] = [];

  for (const offer of data.data || []) {
    const price = parseFloat(offer.price?.total || '0');

    for (const itinerary of offer.itineraries || []) {
      const segments = itinerary.segments || [];
      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];

      if (!firstSegment || !lastSegment) continue;

      const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;
      const depCode = firstSegment.departure.iataCode;
      const arrCode = lastSegment.arrival.iataCode;
      const depDate = firstSegment.departure.at.split('T')[0]; // YYYY-MM-DD

      // VALIDATION BLOQUANTE: Rejeter les vols avec numéros invalides
      if (!validateFlightNumber(flightNumber)) {
        console.warn(`[Flights] ⚠️ Vol ignoré - numéro invalide: ${flightNumber}`);
        continue;
      }

      // Générer un lien Aviasales affilié au lieu de Google Flights
      const bookingUrl = generateFlightLink(
        { origin: depCode, destination: arrCode },
        { date: depDate, passengers: params.adults }
      );

      // Extraire les heures d'affichage (HH:MM) depuis les dates ISO
      // Amadeus retourne les heures en heure locale de l'aéroport
      const departureTimeDisplay = extractTimeFromISO(firstSegment.departure.at);
      const arrivalTimeDisplay = extractTimeFromISO(lastSegment.arrival.at);

      const flight: Flight = {
        id: `${offer.id}-${itinerary.duration}`,
        airline: firstSegment.carrierCode,
        flightNumber,
        departureAirport: AIRPORTS[depCode]?.name || depCode,
        departureAirportCode: depCode,
        departureCity: AIRPORTS[depCode]?.city || depCode,
        departureTime: firstSegment.departure.at,
        departureTimeDisplay, // Heure locale aéroport (HH:MM)
        arrivalAirport: AIRPORTS[arrCode]?.name || arrCode,
        arrivalAirportCode: arrCode,
        arrivalCity: AIRPORTS[arrCode]?.city || arrCode,
        arrivalTime: lastSegment.arrival.at,
        arrivalTimeDisplay, // Heure locale aéroport (HH:MM)
        duration: parseDuration(itinerary.duration),
        stops: segments.length - 1,
        price: price / (params.returnDate ? 2 : 1), // Prix par trajet si A/R
        currency: 'EUR',
        cabinClass: params.cabinClass || 'economy',
        baggageIncluded: offer.pricingOptions?.includedCheckedBagsOnly || false,
        bookingUrl,
      };

      // Déterminer si c'est l'aller ou le retour
      if (firstSegment.departure.iataCode === params.originCode) {
        outboundFlights.push(flight);
      } else {
        returnFlights.push(flight);
      }
    }
  }

  return {
    outboundFlights,
    returnFlights,
    searchedAt: new Date(),
  };
}

/**
 * Extrait l'heure HH:MM depuis une chaîne ISO (ex: "2026-01-28T15:25:00")
 * Amadeus retourne les heures en heure LOCALE de l'aéroport, pas UTC
 */
function extractTimeFromISO(isoString: string): string {
  // Format: 2026-01-28T15:25:00 ou 2026-01-28T15:25:00+01:00
  const match = isoString.match(/T(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return '00:00';
}

function parseDuration(duration: string): number {
  // Format: PT2H30M
  const match = duration.match(/PT(\d+)H(\d+)?M?/);
  if (match) {
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    return hours * 60 + minutes;
  }
  return 0;
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
