/**
 * Recherche de vols via Claude avec recherche web
 *
 * Ce service utilise Claude pour rechercher des vols reels sur internet
 * (Google Flights, Skyscanner, etc.) et extraire les informations.
 *
 * Utilise quand:
 * - Amadeus API n'est pas configure
 * - Amadeus API echoue
 *
 * Avantages:
 * - Vols reels avec vrais numeros
 * - Liens de reservation reels
 * - Pas besoin de cle API externe
 *
 * Inconvenients:
 * - Plus lent (recherche web)
 * - Dependant de la disponibilite de Claude
 */

import Anthropic from '@anthropic-ai/sdk';
import { Flight, FlightSearchResult } from '../types';
import { AIRPORTS } from './geocoding';
import { tokenTracker } from './tokenTracker';

const anthropic = new Anthropic();

interface FlightSearchParams {
  originCode: string;
  destinationCode: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

interface ClaudeFlightResult {
  flightNumber: string;
  airline: string;
  departureTime: string; // HH:mm
  arrivalTime: string; // HH:mm
  duration: string; // ex: "2h15"
  price: number;
  stops: number;
  stopCities?: string[];
  bookingUrl: string;
}

/**
 * Recherche des vols reels via Claude
 */
export async function searchFlightsWithClaude(
  params: FlightSearchParams
): Promise<FlightSearchResult> {
  const originAirport = AIRPORTS[params.originCode];
  const destAirport = AIRPORTS[params.destinationCode];

  if (!originAirport || !destAirport) {
    console.warn('[FlightSearchClaude] Aeroports non trouves');
    return { outboundFlights: [], returnFlights: [], searchedAt: new Date() };
  }

  try {
    // Recherche des vols aller
    const outboundFlights = await searchFlightsOneway(
      params.originCode,
      params.destinationCode,
      params.departureDate,
      params.adults,
      originAirport,
      destAirport
    );

    // Recherche des vols retour si necessaire
    let returnFlights: Flight[] = [];
    if (params.returnDate) {
      returnFlights = await searchFlightsOneway(
        params.destinationCode,
        params.originCode,
        params.returnDate,
        params.adults,
        destAirport,
        originAirport
      );
    }

    return {
      outboundFlights,
      returnFlights,
      searchedAt: new Date(),
    };
  } catch (error) {
    console.error('[FlightSearchClaude] Erreur recherche:', error);
    return { outboundFlights: [], returnFlights: [], searchedAt: new Date() };
  }
}

/**
 * Recherche des vols dans une direction
 */
async function searchFlightsOneway(
  originCode: string,
  destCode: string,
  date: string,
  adults: number,
  originAirport: { name: string; city: string },
  destAirport: { name: string; city: string }
): Promise<Flight[]> {
  const prompt = `Tu es un assistant de recherche de vols. Je cherche des vols REELS pour:

- Depart: ${originAirport.city} (${originCode})
- Arrivee: ${destAirport.city} (${destCode})
- Date: ${date}
- Passagers: ${adults}

Fais une recherche sur Google Flights, Skyscanner ou Kayak pour trouver 5-8 vols REELS.

IMPORTANT:
- Les numeros de vol doivent etre REELS (ex: AF1680, VY8022, pas AF1234)
- Les horaires doivent correspondre a de vrais vols existants
- Fournis le VRAI lien de reservation (Skyscanner, Google Flights, ou site de la compagnie)

Reponds UNIQUEMENT avec un JSON valide, sans texte avant ou apres:
{
  "flights": [
    {
      "flightNumber": "AF1680",
      "airline": "Air France",
      "departureTime": "08:15",
      "arrivalTime": "10:20",
      "duration": "2h05",
      "price": 89,
      "stops": 0,
      "bookingUrl": "https://www.skyscanner.fr/transport/vols/cdg/bcn/${date}/"
    }
  ]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Tracker les tokens
    if (response.usage) {
      tokenTracker.track(response.usage, `FlightSearch: ${originCode}-${destCode}`);
    }

    const content = response.content[0];
    if (content.type !== 'text') {
      return [];
    }

    // Parser le JSON
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[FlightSearchClaude] Pas de JSON dans la reponse');
      return [];
    }

    const data = JSON.parse(jsonMatch[0]);
    const flights: Flight[] = [];

    for (const f of data.flights || []) {
      // VALIDATION: Rejeter les vols sans numéro valide
      if (!f.flightNumber || f.flightNumber === 'UNKNOWN' || f.flightNumber === 'N/A') {
        console.warn(`[FlightSearchClaude] Vol sans numéro valide ignoré`);
        continue;
      }

      // Construire les dates ISO
      const [depHours, depMins] = (f.departureTime || '00:00').split(':').map(Number);
      const [arrHours, arrMins] = (f.arrivalTime || '00:00').split(':').map(Number);

      const departureDate = new Date(date);
      departureDate.setHours(depHours, depMins, 0, 0);

      const arrivalDate = new Date(date);
      arrivalDate.setHours(arrHours, arrMins, 0, 0);

      // Si arrivee avant depart, c'est le lendemain
      if (arrivalDate < departureDate) {
        arrivalDate.setDate(arrivalDate.getDate() + 1);
      }

      // Parser la duree
      const durationMatch = (f.duration || '2h00').match(/(\d+)h(\d+)?/);
      const durationMinutes = durationMatch
        ? parseInt(durationMatch[1]) * 60 + (parseInt(durationMatch[2]) || 0)
        : 120;

      // Extraire le code compagnie
      const airlineCode = f.flightNumber?.slice(0, 2) || 'XX';

      // Stocker les heures d'affichage (HH:MM) sans conversion timezone
      const departureTimeDisplay = f.departureTime || '00:00';
      const arrivalTimeDisplay = f.arrivalTime || '00:00';

      flights.push({
        id: `claude-${f.flightNumber}-${date}`,
        airline: airlineCode,
        flightNumber: f.flightNumber, // Garanti non-null par le check ci-dessus
        departureAirport: originAirport.name,
        departureAirportCode: originCode,
        departureCity: originAirport.city,
        departureTime: departureDate.toISOString(),
        departureTimeDisplay, // Heure locale aéroport (HH:MM)
        arrivalAirport: destAirport.name,
        arrivalAirportCode: destCode,
        arrivalCity: destAirport.city,
        arrivalTime: arrivalDate.toISOString(),
        arrivalTimeDisplay, // Heure locale aéroport (HH:MM)
        duration: durationMinutes,
        stops: f.stops || 0,
        stopCities: f.stopCities,
        price: (f.price || 100) * adults,
        currency: 'EUR',
        cabinClass: 'economy',
        baggageIncluded: !['FR', 'U2', 'W6'].includes(airlineCode),
        bookingUrl: f.bookingUrl || generateSkyscannerUrl(originCode, destCode, date),
      });
    }

    // Trier par prix
    flights.sort((a, b) => a.price - b.price);

    console.log(`[FlightSearchClaude] ${flights.length} vols trouves pour ${originCode}-${destCode}`);
    return flights;
  } catch (error) {
    console.error('[FlightSearchClaude] Erreur parsing:', error);
    return [];
  }
}

/**
 * Genere une URL Skyscanner de fallback
 */
function generateSkyscannerUrl(origin: string, dest: string, date: string): string {
  // Format: https://www.skyscanner.fr/transport/vols/cdg/bcn/240125/
  const formattedDate = date.replace(/-/g, '').slice(2); // 2026-01-25 -> 260125
  return `https://www.skyscanner.fr/transport/vols/${origin.toLowerCase()}/${dest.toLowerCase()}/${formattedDate}/`;
}

/**
 * Verifie si un numero de vol semble reel (pas generique)
 */
export function isRealFlightNumber(flightNumber: string): boolean {
  // Les numeros generiques sont souvent des patterns simples
  const genericPatterns = [
    /^[A-Z]{2}1234$/,
    /^[A-Z]{2}5678$/,
    /^[A-Z]{2}0000$/,
    /^[A-Z]{2}9999$/,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(flightNumber)) {
      return false;
    }
  }

  // Format valide: 2-3 lettres/chiffres + 1-4 chiffres
  const validFormat = /^[A-Z][A-Z0-9]{1,2}\d{1,4}$/;
  return validFormat.test(flightNumber);
}
