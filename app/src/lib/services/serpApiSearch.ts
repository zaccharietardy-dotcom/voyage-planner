/**
 * Service de recherche via SerpAPI
 *
 * SerpAPI permet de scraper Google de manière légale:
 * - Google Flights: vols RÉELS avec vrais numéros
 * - Google Maps: lieux vérifiés avec vraies adresses
 * - Google Search: vérification d'existence
 *
 * Quota gratuit: 100 recherches/mois
 * https://serpapi.com/ - Créer un compte gratuit
 */

import { Flight } from '../types';
import { generateFlightLink } from './linkGenerator';

// Protection contre les espaces parasites dans les clés
function getSerpApiKey() { return process.env.SERPAPI_KEY?.trim(); }
const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

interface SerpApiFlightOffer {
  flights: Array<{
    departure_airport: { name: string; id: string; time: string };
    arrival_airport: { name: string; id: string; time: string };
    duration: number;
    airplane: string;
    airline: string;
    airline_logo: string;
    flight_number: string;
    legroom?: string;
    extensions?: string[];
  }>;
  layovers?: Array<{
    name: string;
    id: string;
    duration: number;
    overnight?: boolean; // true si l'escale est de nuit
  }>;
  total_duration: number;
  price: number;
  type: string;
  airline_logo?: string;
  booking_token?: string; // Token pour URL de réservation directe
}

interface SerpApiFlightResult {
  best_flights?: SerpApiFlightOffer[];
  other_flights?: SerpApiFlightOffer[];
  search_metadata?: {
    google_flights_url: string;
  };
  error?: string;
}

/**
 * Recherche des vols RÉELS via SerpAPI (Google Flights)
 */
export async function searchFlightsWithSerpApi(
  origin: string,
  destination: string,
  date: string, // YYYY-MM-DD
  passengers: number = 1,
  isReturn: boolean = false // true pour vol retour (affecte les liens Vueling)
): Promise<Flight[]> {
  if (!getSerpApiKey()) {
    console.warn('[SerpAPI] SERPAPI_KEY non configurée');
    return [];
  }

  const params = new URLSearchParams({
    api_key: getSerpApiKey(),
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: date,
    type: '2', // 1 = round trip (requires return_date), 2 = one way
    currency: 'EUR',
    hl: 'fr',
    gl: 'fr',
    adults: passengers.toString(),
    deep_search: 'true', // IMPORTANT: Active la recherche approfondie pour obtenir booking_token
  });

  try {
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);

    if (!response.ok) {
      console.error('[SerpAPI] Erreur HTTP:', response.status);
      return [];
    }

    const data: SerpApiFlightResult = await response.json();

    if (data.error) {
      console.error('[SerpAPI] Erreur:', data.error);
      return [];
    }

    const flights: Flight[] = [];
    const googleFlightsUrl = data.search_metadata?.google_flights_url ||
      `https://www.google.com/travel/flights?q=flights%20from%20${origin}%20to%20${destination}%20on%20${date}`;

    // Traiter les meilleurs vols
    const allFlights = [...(data.best_flights || []), ...(data.other_flights || [])];

    for (const flightOffer of allFlights.slice(0, 10)) {

      const firstLeg = flightOffer.flights[0];
      const lastLeg = flightOffer.flights[flightOffer.flights.length - 1];

      if (!firstLeg || !lastLeg) continue;

      // VALIDATION: Vérifier que le vol arrive bien à la destination demandée
      if (lastLeg.arrival_airport.id !== destination) {
        console.warn(`[SerpAPI] ⚠️ Vol ignoré: arrive à ${lastLeg.arrival_airport.id} au lieu de ${destination}`);
        continue;
      }

      // VALIDATION: Rejeter les vols avec escale de nuit (overnight)
      // Ces vols obligent à dormir à l'aéroport, ce qui est impraticable
      const hasOvernightLayover = flightOffer.layovers?.some(l => l.overnight === true);
      if (hasOvernightLayover) {
        const layoverInfo = flightOffer.layovers?.find(l => l.overnight)!;
        console.warn(`[SerpAPI] ⚠️ Vol ignoré: escale de nuit à ${layoverInfo.name} (${Math.round(layoverInfo.duration / 60)}h)`);
        continue;
      }

      // VALIDATION: Rejeter les vols avec escales trop longues (> 4h)
      const hasLongLayover = flightOffer.layovers?.some(l => l.duration > 240);
      if (hasLongLayover) {
        const layoverInfo = flightOffer.layovers?.find(l => l.duration > 240)!;
        console.warn(`[SerpAPI] ⚠️ Vol ignoré: escale trop longue à ${layoverInfo.name} (${Math.round(layoverInfo.duration / 60)}h)`);
        continue;
      }

      // VALIDATION: Rejeter les vols sans numéro valide
      if (!firstLeg.flight_number) {
        console.warn(`[SerpAPI] Vol sans numéro ignoré: ${firstLeg.airline} ${firstLeg.departure_airport.id} → ${lastLeg.arrival_airport.id}`);
        continue;
      }

      // Parser les horaires

      const departureTime = parseFlightTime(date, firstLeg.departure_airport.time);
      const arrivalTime = parseFlightTime(date, lastLeg.arrival_airport.time);

      // Extraire les heures d'affichage (HH:MM) - ce sont les heures LOCALES de l'aéroport
      // On les garde telles quelles pour l'affichage, sans conversion timezone
      const departureTimeDisplay = extractDisplayTime(firstLeg.departure_airport.time);
      const arrivalTimeDisplay = extractDisplayTime(lastLeg.arrival_airport.time);

      // Si arrivée avant départ, c'est le lendemain
      if (arrivalTime < departureTime) {
        arrivalTime.setDate(arrivalTime.getDate() + 1);
      }

      // Extraire le code compagnie
      const airlineCode = firstLeg.flight_number?.slice(0, 2) ||
        getAirlineCode(firstLeg.airline) || 'XX';

      // Générer un lien Aviasales affilié au lieu de Google Flights
      // Aviasales est notre partenaire affilié configuré
      const aviasalesUrl = generateFlightLink(
        {
          origin: firstLeg.departure_airport.id,
          destination: lastLeg.arrival_airport.id,
        },
        {
          date: date,
          passengers: passengers,
        }
      );
      const finalBookingUrl = aviasalesUrl;

      flights.push({
        id: `serp-${firstLeg.flight_number}-${date}`,
        airline: airlineCode,
        airlineLogo: firstLeg.airline_logo || (flightOffer as any).airline_logo,
        flightNumber: firstLeg.flight_number, // Garanti non-null par le check ci-dessus
        departureAirport: firstLeg.departure_airport.name,
        departureAirportCode: firstLeg.departure_airport.id,
        departureCity: origin,
        departureTime: departureTime.toISOString(),
        departureTimeDisplay, // Heure locale de l'aéroport (HH:MM)
        arrivalAirport: lastLeg.arrival_airport.name,
        arrivalAirportCode: lastLeg.arrival_airport.id,
        arrivalCity: destination,
        arrivalTime: arrivalTime.toISOString(),
        arrivalTimeDisplay, // Heure locale de l'aéroport (HH:MM)
        duration: flightOffer.total_duration,
        stops: flightOffer.flights.length - 1,
        stopCities: flightOffer.flights.length > 1
          ? flightOffer.flights.slice(0, -1).map(f => f.arrival_airport.name)
          : undefined,
        price: flightOffer.price, // Prix TOTAL (SerpAPI retourne déjà le total pour tous les passagers)
        pricePerPerson: Math.round(flightOffer.price / passengers), // Prix par personne
        currency: 'EUR',
        cabinClass: 'economy',
        baggageIncluded: !['FR', 'U2', 'W6', 'W9'].includes(airlineCode),
        bookingUrl: finalBookingUrl, // URL directe vers le site de la compagnie aérienne
      });
    }

    // NOTE: On garde l'ordre "best flights" de Google Flights (prix + durée + escales)
    // pour que le premier vol corresponde à celui affiché sur Google Flights

    return flights;
  } catch (error) {
    console.error('[SerpAPI] Erreur:', error);
    return [];
  }
}

/**
 * Vérifie si un lieu existe via SerpAPI (Google Maps)
 */
export async function verifyPlaceWithSerpApi(
  placeName: string,
  city: string
): Promise<{
  exists: boolean;
  name?: string;
  address?: string;
  rating?: number;
  googleMapsUrl?: string;
  latitude?: number;
  longitude?: number;
} | null> {
  if (!getSerpApiKey()) {
    return null;
  }

  const query = `${placeName}, ${city}`;
  const params = new URLSearchParams({
    api_key: getSerpApiKey(),
    engine: 'google_maps',
    q: query,
    hl: 'fr',
    gl: 'fr',
  });

  try {
    const response = await fetch(`${SERPAPI_BASE_URL}?${params}`);
    if (!response.ok) return null;

    const data = await response.json();

    if (data.local_results && data.local_results.length > 0) {
      const place = data.local_results[0];
      return {
        exists: true,
        name: place.title,
        address: place.address,
        rating: place.rating,
        googleMapsUrl: place.link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
        latitude: place.gps_coordinates?.latitude,
        longitude: place.gps_coordinates?.longitude,
      };
    }

    return { exists: false };
  } catch (error) {
    console.error('[SerpAPI] Erreur vérification lieu:', error);
    return null;
  }
}

/**
 * Extrait l'heure au format HH:MM depuis une chaîne SerpAPI
 * IMPORTANT: Retourne l'heure LOCALE de l'aéroport, sans conversion timezone
 * C'est ce qui sera affiché à l'utilisateur
 */
function extractDisplayTime(timeStr: string): string {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3]?.toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  return timeStr;
}

/**
 * Parse l'heure de vol au format "HH:MM AM/PM" ou "HH:MM"
 * IMPORTANT: Les heures de SerpAPI sont en heure LOCALE de l'aéroport
 * On les stocke directement sans conversion timezone pour éviter les décalages
 */
function parseFlightTime(date: string, timeStr: string): Date {
  const result = new Date(date);

  // Format: "10:30 AM" ou "2:45 PM" ou "14:30"
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3]?.toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    result.setHours(hours, minutes, 0, 0);

  }

  return result;
}

/**
 * Obtient le code IATA de la compagnie
 */
function getAirlineCode(airlineName: string): string {
  const codes: Record<string, string> = {
    'Air France': 'AF',
    'Vueling': 'VY',
    'Ryanair': 'FR',
    'easyJet': 'U2',
    'Transavia': 'TO',
    'Iberia': 'IB',
    'British Airways': 'BA',
    'Lufthansa': 'LH',
    'TAP Portugal': 'TP',
    'ITA Airways': 'AZ',
    'KLM': 'KL',
    'Swiss': 'LX',
    'Wizz Air': 'W6',
  };

  return codes[airlineName] || airlineName.slice(0, 2).toUpperCase();
}

/**
 * Génère l'URL de réservation DIRECTE vers le site de la compagnie aérienne
 * Chaque compagnie a son propre format d'URL
 */
function generateDirectAirlineBookingUrl(
  airlineCode: string,
  origin: string,
  destination: string,
  date: string, // YYYY-MM-DD
  departureTime: string, // HH:MM
  passengers: number = 1
): string {
  // Formater la date selon les besoins de chaque compagnie
  const [year, month, day] = date.split('-');
  const dateCompact = `${year}${month}${day}`; // 20260128
  const dateDash = date; // 2026-01-28
  const dateSlash = `${day}/${month}/${year}`; // 28/01/2026

  switch (airlineCode.toUpperCase()) {
    case 'VY': // Vueling - Format officiel testé et validé
      // Source: https://www.vueling.com/developer/flightcalendar/flightcalendar-deeplink
      return `https://tickets.vueling.com/booking?o=${origin}&d=${destination}&dd=${dateDash}&dt=1&adt=${passengers}&chd=0&inf=0&c=fr-FR&cur=EUR`;

    case 'FR': // Ryanair - Testé, fonctionne avec redirect
      return `https://www.ryanair.com/fr/fr/trip/flights/select?adults=${passengers}&teens=0&children=0&infants=0&dateOut=${dateDash}&isReturn=false&originIata=${origin}&destinationIata=${destination}`;

    case 'U2': // easyJet - Page de recherche
      return `https://www.easyjet.com/fr/`;

    case 'AF': // Air France - Pas de deep link public, page recherche
    case 'KL': // KLM - Même groupe Air France-KLM
      return `https://wwws.airfrance.fr/`;

    case 'IB': // Iberia - Page de recherche
      return `https://www.iberia.com/fr/`;

    case 'TO': // Transavia
      return `https://www.transavia.com/fr-FR/`;

    case 'LH': // Lufthansa
      return `https://www.lufthansa.com/fr/fr/`;

    case 'BA': // British Airways
      return `https://www.britishairways.com/`;

    case 'TP': // TAP Portugal
      return `https://www.flytap.com/fr-fr/`;

    case 'W6': // Wizz Air
      return `https://wizzair.com/fr-fr/`;

    case 'AZ': // ITA Airways
      return `https://www.ita-airways.com/fr_fr/`;

    default:
      // Fallback: Google Flights - TOUJOURS FIABLE avec le vol spécifique
      return `https://www.google.com/travel/flights?q=flights+from+${origin}+to+${destination}+on+${dateDash}&curr=EUR&hl=fr`;
  }
}

/**
 * Vérifie si SerpAPI est configurée
 */
export function isSerpApiConfigured(): boolean {
  return !!getSerpApiKey();
}
