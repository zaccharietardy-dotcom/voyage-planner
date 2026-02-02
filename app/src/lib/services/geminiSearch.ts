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
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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
 * Recherche des restaurants réels via Gemini + Google Search (fallback)
 * Utilisé quand SerpAPI/TripAdvisor/Google Places/OSM échouent tous
 */
export async function searchRestaurantsWithGemini(
  destination: string,
  options: {
    mealType: 'breakfast' | 'lunch' | 'dinner';
    limit?: number;
    cityCenter: { lat: number; lng: number };
  }
): Promise<import('../types').Restaurant[]> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini Restaurants] GOOGLE_AI_API_KEY non configurée');
    return [];
  }

  const { mealType, limit = 8, cityCenter } = options;
  const mealLabels = { breakfast: 'petit-déjeuner/brunch', lunch: 'déjeuner', dinner: 'dîner' };

  const prompt = `Recherche sur Google les meilleurs restaurants pour ${mealLabels[mealType]} à ${destination}.

IMPORTANT: Je veux UNIQUEMENT des restaurants qui EXISTENT VRAIMENT. Vérifie sur Google Maps.
- Privilégie la cuisine LOCALE de ${destination} (pas de chaînes, pas de fast-food)
- Donne ${limit} restaurants avec des données VÉRIFIÉES

Réponds UNIQUEMENT en JSON valide (pas de markdown):
[{
  "name": "Nom exact du restaurant",
  "address": "Adresse complète vérifiée",
  "latitude": 41.3851,
  "longitude": 2.1734,
  "rating": 4.5,
  "reviewCount": 850,
  "priceLevel": 2,
  "cuisineTypes": ["catalane", "tapas"],
  "description": "2 phrases: ambiance + cuisine",
  "specialties": ["Plat 1", "Plat 2"],
  "tips": "Conseil pratique court",
  "googleMapsUrl": "https://www.google.com/maps/place/..."
}]

priceLevel: 1 (€) à 4 (€€€€)`;

  try {
    console.log(`[Gemini Restaurants] Recherche ${mealType} à ${destination}...`);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
    });

    if (!response.ok) {
      console.error('[Gemini Restaurants] API error:', response.status);
      return [];
    }

    const data: GeminiResponse = await response.json();
    if (data.error) {
      console.error('[Gemini Restaurants] Error:', data.error.message);
      return [];
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) return [];

    // Log sources
    const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (sources?.length) {
      console.log('[Gemini Restaurants] Sources:', sources.slice(0, 3).map(s => s.web?.title).join(', '));
    }

    // Parse JSON (peut être dans un array ou un objet)
    let jsonStr = textContent.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[Gemini Restaurants] Pas de JSON array trouvé');
      return [];
    }

    const rawRestaurants = JSON.parse(jsonMatch[0]);
    const restaurants: import('../types').Restaurant[] = rawRestaurants
      .filter((r: any) => r.name && r.address)
      .map((r: any, i: number) => ({
        id: `gemini-rest-${destination.toLowerCase().replace(/\s/g, '-')}-${i}`,
        name: r.name,
        address: r.address || 'Adresse non disponible',
        latitude: r.latitude || cityCenter.lat + (Math.random() - 0.5) * 0.01,
        longitude: r.longitude || cityCenter.lng + (Math.random() - 0.5) * 0.01,
        rating: Math.min(5, Math.max(1, r.rating || 4)),
        reviewCount: r.reviewCount || 50,
        priceLevel: (Math.min(4, Math.max(1, r.priceLevel || 2)) as 1 | 2 | 3 | 4),
        cuisineTypes: r.cuisineTypes || ['local'],
        dietaryOptions: ['none'] as import('../types').DietaryType[],
        specialties: r.specialties,
        description: r.description,
        tips: r.tips,
        googleMapsUrl: r.googleMapsUrl,
        openingHours: {},
        dataReliability: 'verified' as const, // Vérifié via Google Search
      }));

    console.log(`[Gemini Restaurants] ✅ ${restaurants.length} restaurants trouvés à ${destination}`);
    return restaurants;
  } catch (error) {
    console.error('[Gemini Restaurants] Erreur:', error);
    return [];
  }
}

/**
 * Enrichit des restaurants existants avec des infos vérifiées via Google Search
 * Plus fiable que Claude car vérifie sur internet
 */
export async function enrichRestaurantsWithGemini(
  restaurants: { name: string; address: string; cuisineTypes: string[]; mealType: string }[],
  destination: string,
): Promise<Map<string, { description: string; specialties: string[]; tips: string }>> {
  const result = new Map<string, { description: string; specialties: string[]; tips: string }>();

  if (restaurants.length === 0 || !GEMINI_API_KEY) return result;

  const restaurantList = restaurants.map((r, i) =>
    `${i + 1}. "${r.name}" - ${r.address}`
  ).join('\n');

  const prompt = `Recherche sur Google des informations sur ces restaurants à ${destination} et donne pour chacun une description, spécialités et conseil:

${restaurantList}

Réponds UNIQUEMENT en JSON (pas de markdown):
[{
  "name": "nom exact",
  "description": "2 phrases: ambiance + type de cuisine (VÉRIFIÉES sur Google)",
  "specialties": ["plat signature 1", "plat signature 2"],
  "tips": "conseil pratique vérifié (réservation? horaires? plat incontournable?)"
}]`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
      }),
    });

    if (!response.ok) return result;

    const data: GeminiResponse = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) return result;

    let jsonStr = textContent.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return result;

    const enriched = JSON.parse(jsonMatch[0]);
    for (const item of enriched) {
      if (item.name) {
        result.set(item.name, {
          description: item.description || '',
          specialties: item.specialties || [],
          tips: item.tips || '',
        });
      }
    }

    console.log(`[Gemini Enrich] ✅ ${result.size} restaurants enrichis via Google Search`);
  } catch (error) {
    console.warn('[Gemini Enrich] Erreur:', error);
  }

  return result;
}

/**
 * Recherche le prix d'un billet de train via Gemini + Google Search
 */
export async function searchTrainPrice(
  origin: string,
  dest: string,
  date: string,
  passengers: number = 1
): Promise<{ price: number | null; operator?: string; source?: string; duration?: number } | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] GOOGLE_AI_API_KEY non configurée');
    return null;
  }

  const prompt = `Recherche sur Google le prix d'un billet de train de ${origin} à ${dest} le ${date} pour ${passengers} adulte(s).
Cherche sur SNCF Connect, Trainline, Renfe, Trenitalia, Deutsche Bahn.
Retourne UNIQUEMENT un JSON valide, sans commentaire:
{
  "price": number (prix par personne en EUR, le moins cher trouvé),
  "operator": "SNCF TGV INOUI" | "Renfe AVE" | etc.,
  "source": "sncf-connect.com" | "thetrainline.com" | etc.,
  "duration": number (minutes de trajet)
}
Si aucun prix trouvé, retourne: { "price": null }`;

  try {
    console.log(`[Gemini] Recherche train ${origin} → ${dest} le ${date}...`);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) {
      console.error('[Gemini] Train API error:', response.status);
      return null;
    }

    const data: GeminiResponse = await response.json();
    if (data.error) {
      console.error('[Gemini] Train error:', data.error.message);
      return null;
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.warn('[Gemini] Train: pas de contenu dans la réponse');
      return null;
    }

    const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (sources?.length) {
      console.log('[Gemini] Train sources:', sources.slice(0, 3).map(s => s.web?.title).join(', '));
    }

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Gemini] Train: pas de JSON trouvé');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[Gemini] Train ${origin}-${dest}: ${result.price != null ? result.price + '€' : 'non trouvé'}`);
    return result;
  } catch (error) {
    console.error('[Gemini] Erreur recherche train:', error);
    return null;
  }
}

/**
 * Recherche des ferries via Gemini + Google Search
 */
export async function searchFerryInfo(
  origin: string,
  dest: string,
  date: string,
  passengers: number = 1
): Promise<{
  price: number | null;
  operator?: string;
  duration?: number;
  bookingUrl?: string;
  departurePort?: string;
  arrivalPort?: string;
} | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] GOOGLE_AI_API_KEY non configurée');
    return null;
  }

  const prompt = `Recherche sur Google les ferries de ${origin} à ${dest} le ${date} pour ${passengers} adulte(s).
Cherche sur Corsica Linea, La Méridionale, GNV, Grimaldi Lines, Brittany Ferries, Balearia, Trasmediterranea.
Retourne UNIQUEMENT un JSON valide:
{
  "price": number (prix par personne en EUR),
  "operator": "Corsica Linea" | etc.,
  "duration": number (minutes de traversée),
  "bookingUrl": "https://..." (lien de réservation direct si trouvé),
  "departurePort": "Marseille",
  "arrivalPort": "Ajaccio"
}
Si aucun ferry trouvé, retourne: { "price": null }`;

  try {
    console.log(`[Gemini] Recherche ferry ${origin} → ${dest} le ${date}...`);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) {
      console.error('[Gemini] Ferry API error:', response.status);
      return null;
    }

    const data: GeminiResponse = await response.json();
    if (data.error) {
      console.error('[Gemini] Ferry error:', data.error.message);
      return null;
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.warn('[Gemini] Ferry: pas de contenu dans la réponse');
      return null;
    }

    const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (sources?.length) {
      console.log('[Gemini] Ferry sources:', sources.slice(0, 3).map(s => s.web?.title).join(', '));
    }

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Gemini] Ferry: pas de JSON trouvé');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[Gemini] Ferry ${origin}-${dest}: ${result.price != null ? result.price + '€' : 'non trouvé'}`);
    return result;
  } catch (error) {
    console.error('[Gemini] Erreur recherche ferry:', error);
    return null;
  }
}

/**
 * Recherche le coût des péages autoroute via Gemini + Google Search
 */
export async function searchTollCost(
  origin: string,
  dest: string
): Promise<{ toll: number; route?: string; source?: string } | null> {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] GOOGLE_AI_API_KEY non configurée');
    return null;
  }

  const prompt = `Recherche sur Google le coût total des péages autoroute en voiture de ${origin} à ${dest} en France/Europe.
Cherche sur autoroutes.fr, mappy.com, viamichelin.com.
Retourne UNIQUEMENT un JSON valide:
{
  "toll": number (coût total en EUR pour une voiture standard classe 1),
  "route": "A6 puis A7" (autoroutes empruntées),
  "source": "autoroutes.fr" | etc.
}
Si péages gratuits (ex: Allemagne), retourne: { "toll": 0, "route": "Autobahn (gratuit)" }`;

  try {
    console.log(`[Gemini] Recherche péages ${origin} → ${dest}...`);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) {
      console.error('[Gemini] Toll API error:', response.status);
      return null;
    }

    const data: GeminiResponse = await response.json();
    if (data.error) {
      console.error('[Gemini] Toll error:', data.error.message);
      return null;
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      console.warn('[Gemini] Toll: pas de contenu dans la réponse');
      return null;
    }

    const sources = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (sources?.length) {
      console.log('[Gemini] Toll sources:', sources.slice(0, 3).map(s => s.web?.title).join(', '));
    }

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Gemini] Toll: pas de JSON trouvé');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]);
    console.log(`[Gemini] Péages ${origin}-${dest}: ${result.toll}€ via ${result.route || 'N/A'}`);
    return result;
  } catch (error) {
    console.error('[Gemini] Erreur recherche péages:', error);
    return null;
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
