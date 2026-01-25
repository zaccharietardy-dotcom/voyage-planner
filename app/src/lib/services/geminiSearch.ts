/**
 * Service de recherche avec Gemini + Google Search
 *
 * Gemini a accès à internet via le "grounding" avec Google Search.
 * Cela permet de vérifier les données en temps réel:
 * - Vols réels avec vrais numéros
 * - Restaurants qui existent vraiment
 * - Horaires d'ouverture actuels
 * - Prix à jour
 */

import { Flight } from '../types';

const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      searchEntryPoint?: {
        renderedContent?: string;
      };
      groundingChunks?: Array<{
        web?: {
          uri?: string;
          title?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
    code?: number;
  };
}

/**
 * Recherche des vols réels via Gemini + Google Search
 */
export async function searchFlightsWithGemini(
  origin: string,
  destination: string,
  date: string, // YYYY-MM-DD
  passengers: number = 1
): Promise<Flight[]> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] GOOGLE_AI_API_KEY non configurée');
    return [];
  }

  const prompt = `Recherche sur Google Flights les vols RÉELS de ${origin} vers ${destination} le ${date} pour ${passengers} passager(s).

IMPORTANT: Je veux des vols qui EXISTENT VRAIMENT avec:
- Le VRAI numéro de vol (ex: AF1080, VY8022, pas des numéros inventés)
- Les VRAIS horaires de départ et d'arrivée
- Le VRAI prix actuel
- Le lien DIRECT vers la page de réservation sur Google Flights ou le site de la compagnie

Trouve 5-8 vols et réponds UNIQUEMENT avec un JSON valide:
{
  "flights": [
    {
      "flightNumber": "AF1080",
      "airline": "Air France",
      "departureTime": "08:15",
      "arrivalTime": "10:20",
      "duration": "2h05",
      "price": 89,
      "stops": 0,
      "bookingUrl": "https://www.google.com/travel/flights/booking?..."
    }
  ],
  "searchUrl": "https://www.google.com/travel/flights?..."
}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        tools: [
          {
            googleSearch: {},
          },
        ],
        generationConfig: {
          temperature: 0.1, // Moins créatif = plus factuel
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini] API error:', response.status, errorText);
      return [];
    }

    const data: GeminiResponse = await response.json();

    if (data.error) {
      console.error('[Gemini] Error:', data.error.message);
      return [];
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.warn('[Gemini] Pas de contenu dans la réponse');
      return [];
    }

    // Log les sources utilisées
    const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (sources && sources.length > 0) {
      console.log('[Gemini] Sources utilisées:');
      sources.slice(0, 3).forEach(s => {
        console.log(`  - ${s.web?.title}: ${s.web?.uri}`);
      });
    }

    // Parser le JSON
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Gemini] Pas de JSON trouvé dans la réponse');
      return [];
    }

    const flightData = JSON.parse(jsonMatch[0]);
    const flights: Flight[] = [];

    for (const f of flightData.flights || []) {
      // VALIDATION: Rejeter les vols sans numéro valide
      if (!f.flightNumber || f.flightNumber === 'UNKNOWN' || f.flightNumber === 'N/A') {
        console.warn(`[Gemini] Vol sans numéro valide ignoré`);
        continue;
      }

      // Parser les horaires
      const [depHours, depMins] = (f.departureTime || '00:00').split(':').map(Number);
      const [arrHours, arrMins] = (f.arrivalTime || '00:00').split(':').map(Number);

      const departureDate = new Date(date);
      departureDate.setHours(depHours, depMins, 0, 0);

      const arrivalDate = new Date(date);
      arrivalDate.setHours(arrHours, arrMins, 0, 0);

      // Si arrivée avant départ, c'est le lendemain
      if (arrivalDate < departureDate) {
        arrivalDate.setDate(arrivalDate.getDate() + 1);
      }

      // Parser la durée
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
        id: `gemini-${f.flightNumber}-${date}`,
        airline: airlineCode,
        flightNumber: f.flightNumber, // Garanti non-null par le check ci-dessus
        departureAirport: origin,
        departureAirportCode: origin,
        departureCity: origin,
        departureTime: departureDate.toISOString(),
        departureTimeDisplay, // Heure locale aéroport (HH:MM)
        arrivalAirport: destination,
        arrivalAirportCode: destination,
        arrivalCity: destination,
        arrivalTime: arrivalDate.toISOString(),
        arrivalTimeDisplay, // Heure locale aéroport (HH:MM)
        duration: durationMinutes,
        stops: f.stops || 0,
        stopCities: f.stopCities,
        price: (f.price || 100) * passengers,
        currency: 'EUR',
        cabinClass: 'economy',
        baggageIncluded: !['FR', 'U2', 'W6'].includes(airlineCode),
        bookingUrl: f.bookingUrl || flightData.searchUrl || generateGoogleFlightsUrl(origin, destination, date),
      });
    }

    // Trier par prix
    flights.sort((a, b) => a.price - b.price);

    console.log(`[Gemini] ${flights.length} vols réels trouvés pour ${origin}-${destination}`);
    return flights;
  } catch (error) {
    console.error('[Gemini] Erreur recherche vols:', error);
    return [];
  }
}

/**
 * Vérifie si un lieu existe vraiment via Gemini + Google Search
 */
export async function verifyPlaceExists(
  placeName: string,
  city: string,
  type: 'restaurant' | 'hotel' | 'attraction'
): Promise<{
  exists: boolean;
  address?: string;
  rating?: number;
  googleMapsUrl?: string;
}> {
  if (!GEMINI_API_KEY) {
    return { exists: false };
  }

  const prompt = `Vérifie si ce ${type} existe vraiment à ${city}: "${placeName}"

Si il existe, donne:
1. L'adresse exacte
2. La note Google (sur 5)
3. Le lien Google Maps

Réponds en JSON:
{
  "exists": true/false,
  "address": "adresse complète",
  "rating": 4.5,
  "googleMapsUrl": "https://www.google.com/maps/place/..."
}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) return { exists: false };

    const data: GeminiResponse = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textContent) return { exists: false };

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { exists: false };

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[Gemini] Erreur vérification lieu:', error);
    return { exists: false };
  }
}

/**
 * Génère une URL Google Flights
 */
function generateGoogleFlightsUrl(origin: string, destination: string, date: string): string {
  // Format: https://www.google.com/travel/flights?q=flights%20from%20CDG%20to%20BCN%20on%202026-01-25
  const query = encodeURIComponent(`flights from ${origin} to ${destination} on ${date}`);
  return `https://www.google.com/travel/flights?q=${query}`;
}

/**
 * Vérifie si Gemini est configuré
 */
export function isGeminiConfigured(): boolean {
  return !!GEMINI_API_KEY;
}
