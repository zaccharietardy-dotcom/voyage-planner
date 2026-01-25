/**
 * Service de recherche d'hôtels
 *
 * Chaîne de priorité:
 * 1. SerpAPI Google Hotels (données RÉELLES, prix actuels, 100 req/mois gratuit) ✅
 * 2. Claude AI (fallback si SerpAPI échoue)
 * 3. Hôtels génériques (fallback final)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Accommodation } from '../types';
import { tokenTracker } from './tokenTracker';
import { searchHotelsWithSerpApi, isSerpApiPlacesConfigured } from './serpApiPlaces';
import { searchPlacesFromDB, savePlacesToDB, type PlaceData } from './placeDatabase';
import * as fs from 'fs';
import * as path from 'path';

// Cache file path
const CACHE_DIR = path.join(process.cwd(), 'data', 'hotels-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'hotels.json');

interface HotelsCache {
  [key: string]: {
    hotels: Accommodation[];
    fetchedAt: string;
    version: number;
  };
}

function loadCache(): HotelsCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Erreur lecture cache hôtels:', error);
  }
  return {};
}

function saveCache(cache: HotelsCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Erreur sauvegarde cache hôtels:', error);
  }
}

function getCacheKey(destination: string, budgetLevel: string): string {
  return `${destination.toLowerCase().trim()}-${budgetLevel}`;
}

/**
 * Valide et corrige l'heure de check-in
 * REGLE: Check-in entre 14:00 et 18:00, JAMAIS avant 14h
 */
function validateCheckInTime(time: string | undefined): string {
  if (!time) return '15:00';

  const [hours, minutes] = time.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return '15:00';

  // Check-in avant 14h -> corrige à 14h
  if (hours < 14) {
    console.warn(`[Hotels] Check-in ${time} invalide (avant 14h), corrigé à 14:00`);
    return '14:00';
  }

  // Check-in après 18h -> garde mais log
  if (hours > 18) {
    console.warn(`[Hotels] Check-in ${time} tardif (après 18h)`);
  }

  return time;
}

/**
 * Valide et corrige l'heure de check-out
 * REGLE: Check-out entre 10:00 et 12:00, JAMAIS après 12h
 */
function validateCheckOutTime(time: string | undefined): string {
  if (!time) return '11:00';

  const [hours, minutes] = time.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return '11:00';

  // Check-out après 12h -> corrige à 12h
  if (hours > 12 || (hours === 12 && minutes > 0)) {
    console.warn(`[Hotels] Check-out ${time} invalide (après 12h), corrigé à 12:00`);
    return '12:00';
  }

  // Check-out avant 10h -> garde mais log
  if (hours < 10) {
    console.warn(`[Hotels] Check-out ${time} matinal (avant 10h)`);
  }

  return time;
}

/**
 * Prix moyen par nuit selon le niveau de budget
 */
function getPriceRange(budgetLevel: 'economic' | 'moderate' | 'luxury'): { min: number; max: number } {
  switch (budgetLevel) {
    case 'economic':
      return { min: 40, max: 80 };
    case 'moderate':
      return { min: 80, max: 150 };
    case 'luxury':
      return { min: 150, max: 400 };
    default:
      return { min: 60, max: 120 };
  }
}

/**
 * Recherche des hôtels via Claude
 */
export async function searchHotels(
  destination: string,
  options: {
    budgetLevel: 'economic' | 'moderate' | 'luxury';
    cityCenter: { lat: number; lng: number };
    checkInDate: Date;
    checkOutDate: Date;
    guests: number;
    forceRefresh?: boolean;
  }
): Promise<Accommodation[]> {
  const cacheKey = getCacheKey(destination, options.budgetLevel);
  const cache = loadCache();
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

  // Vérifier le cache fichier
  const cached = cache[cacheKey];
  if (
    cached &&
    !options.forceRefresh &&
    new Date().getTime() - new Date(cached.fetchedAt).getTime() < cacheMaxAge
  ) {
    console.log(`[Hotels] Cache fichier hit pour ${destination} - ${options.budgetLevel}`);
    return adjustHotelPrices(cached.hotels, options);
  }

  console.log(`[Hotels] Cache miss pour ${destination}, recherche en cours...`);

  // 0. PRIORITÉ MAXIMALE: Base de données SQLite (données vérifiées < 30 jours)
  try {
    const dbHotels = await searchPlacesFromDB({
      city: destination,
      type: 'hotel',
      maxAgeDays: 30,
      limit: 10,
    });

    if (dbHotels.length >= 3) {
      console.log(`[Hotels] ✅ ${dbHotels.length} hôtels trouvés en base locale pour ${destination}`);

      const hotels = dbHotels.map(place => placeToAccommodation(place, options));
      return adjustHotelPrices(hotels, options);
    }
  } catch (error) {
    console.warn('[Hotels] Erreur base locale, fallback vers API:', error);
  }

  // 1. PRIORITÉ: SerpAPI Google Hotels (données RÉELLES avec prix actuels)
  if (isSerpApiPlacesConfigured()) {
    try {
      console.log(`[Hotels] Recherche via SerpAPI Google Hotels...`);
      const checkInStr = options.checkInDate.toISOString().split('T')[0];
      const checkOutStr = options.checkOutDate.toISOString().split('T')[0];

      const serpHotels = await searchHotelsWithSerpApi(destination, checkInStr, checkOutStr, {
        adults: options.guests,
        limit: 10,
      });

      if (serpHotels.length > 0) {
        // SAUVEGARDER EN BASE pour les prochaines requêtes
        try {
          const placesToSave = serpHotels.map((h: any) => hotelToPlace(h, destination));
          await savePlacesToDB(placesToSave, 'serpapi');
        } catch (saveError) {
          console.warn('[Hotels] Erreur sauvegarde en base:', saveError);
        }

        // Convertir en format Accommodation
        const hotels: Accommodation[] = serpHotels.map((h: any) => ({
          id: h.id,
          name: h.name,
          type: 'hotel' as const,
          address: h.address || 'Adresse non disponible',
          latitude: h.latitude || options.cityCenter.lat,
          longitude: h.longitude || options.cityCenter.lng,
          rating: h.rating ? h.rating * 2 : 8, // Convertir note /5 en note /10
          reviewCount: h.reviewCount || 0,
          stars: h.stars ? parseInt(h.stars.match(/(\d)/)?.[1] || '3') : 3,
          pricePerNight: h.pricePerNight || getPriceRange(options.budgetLevel).min,
          totalPrice: h.totalPrice || 0,
          currency: 'EUR',
          amenities: h.amenities || [],
          checkInTime: validateCheckInTime(h.checkIn),
          checkOutTime: validateCheckOutTime(h.checkOut),
          bookingUrl: h.bookingUrl,
          distanceToCenter: 0,
          description: '',
        }));

        // Sauvegarder en cache
        cache[cacheKey] = {
          hotels,
          fetchedAt: new Date().toISOString(),
          version: 2,
        };
        saveCache(cache);

        console.log(`[Hotels] ✅ ${hotels.length} hôtels RÉELS via SerpAPI`);
        return adjustHotelPrices(hotels, options);
      }
    } catch (error) {
      console.warn('[Hotels] SerpAPI error, trying Claude:', error);
    }
  }

  // 2. Fallback: Claude AI
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const hotels = await fetchHotelsFromClaude(destination, options);

      cache[cacheKey] = {
        hotels,
        fetchedAt: new Date().toISOString(),
        version: 1,
      };
      saveCache(cache);

      console.log(`[Hotels] ${hotels.length} hôtels trouvés via Claude AI`);
      return adjustHotelPrices(hotels, options);
    } catch (error) {
      console.error('[Hotels] Claude AI error:', error);
    }
  }

  // 3. Fallback: cache ou hôtels génériques
  if (cached) {
    console.log('[Hotels] Utilisation du cache existant');
    return adjustHotelPrices(cached.hotels, options);
  }

  return generateFallbackHotels(destination, options);
}

/**
 * Ajuste les prix selon le nombre de nuits
 */
function adjustHotelPrices(
  hotels: Accommodation[],
  options: { checkInDate: Date; checkOutDate: Date }
): Accommodation[] {
  const nights = Math.ceil(
    (options.checkOutDate.getTime() - options.checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return hotels.map(hotel => ({
    ...hotel,
    totalPrice: hotel.pricePerNight * nights,
  }));
}

async function fetchHotelsFromClaude(
  destination: string,
  options: {
    budgetLevel: 'economic' | 'moderate' | 'luxury';
    cityCenter: { lat: number; lng: number };
    guests: number;
  }
): Promise<Accommodation[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const client = new Anthropic({ apiKey });
  const priceRange = getPriceRange(options.budgetLevel);

  const budgetLabels = {
    economic: 'économique (hôtels 2-3 étoiles, auberges)',
    moderate: 'moyen (hôtels 3-4 étoiles)',
    luxury: 'luxe (hôtels 4-5 étoiles, boutique hotels)',
  };

  const prompt = `Tu es un expert en hébergements touristiques. Recommande 5-6 VRAIS hôtels à ${destination} pour un budget ${budgetLabels[options.budgetLevel]}.

CRITÈRES IMPORTANTS:
- UNIQUEMENT des hôtels qui EXISTENT VRAIMENT
- Prix par nuit entre ${priceRange.min}€ et ${priceRange.max}€
- Bien situés (centre-ville ou proche attractions)
- Notes sur Booking.com/Google entre 7.5/10 et 9.5/10
- Varier les styles (hôtel classique, boutique, auberge design, etc.)
- Inclure des adresses recommandées par les guides

HORAIRES CHECK-IN/CHECK-OUT - TRÈS IMPORTANT:
- Récupère les VRAIS horaires sur le site de l'hôtel ou Booking.com
- Check-in standard: entre 14:00 et 18:00 (JAMAIS avant 14:00)
- Check-out standard: entre 10:00 et 12:00 (JAMAIS après 12:00)
- Si tu ne trouves pas les horaires exacts, utilise 15:00/11:00 par défaut

Pour chaque hôtel, fournis au format JSON:
{
  "id": "nom-en-kebab-case",
  "name": "Nom de l'Hôtel",
  "type": "hotel",
  "address": "Adresse complète avec numéro et rue",
  "latitude": 41.3851,
  "longitude": 2.1734,
  "rating": 8.5,
  "reviewCount": 2340,
  "stars": 4,
  "pricePerNight": 95,
  "currency": "EUR",
  "amenities": ["WiFi gratuit", "Climatisation", "Petit-déjeuner inclus"],
  "checkInTime": "15:00",
  "checkOutTime": "11:00",
  "distanceToCenter": 0.5,
  "description": "Description courte de l'hôtel et son ambiance"
}

IMPORTANT: Ne pas inclure de champ "bookingUrl" - il sera généré automatiquement avec les dates de séjour.

- rating: note sur 10 (format Booking.com)
- stars: 1 à 5 étoiles
- Les coordonnées GPS doivent être EXACTES et RÉELLES
- distanceToCenter en km
- checkInTime/checkOutTime: format HH:mm, horaires RÉALISTES

Réponds UNIQUEMENT avec un tableau JSON valide.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Tracker les tokens consommés
  if (response.usage) {
    tokenTracker.track(response.usage, `Hotels: ${destination}`);
  }

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse Claude invalide');
  }

  let jsonStr = content.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const rawHotels = JSON.parse(jsonStr);

  return rawHotels.map((h: any, index: number) => ({
    id: h.id || `${destination.toLowerCase()}-hotel-${index}`,
    name: h.name,
    type: h.type || 'hotel',
    address: h.address || 'Adresse non disponible',
    latitude: h.latitude || options.cityCenter.lat + (Math.random() - 0.5) * 0.02,
    longitude: h.longitude || options.cityCenter.lng + (Math.random() - 0.5) * 0.02,
    rating: Math.min(10, Math.max(1, h.rating || 8)),
    reviewCount: h.reviewCount || 500,
    stars: Math.min(5, Math.max(1, h.stars || 3)),
    pricePerNight: h.pricePerNight || (priceRange.min + priceRange.max) / 2,
    currency: h.currency || 'EUR',
    amenities: h.amenities || ['WiFi gratuit'],
    checkInTime: validateCheckInTime(h.checkInTime),
    checkOutTime: validateCheckOutTime(h.checkOutTime),
    // NOTE: bookingUrl est généré dynamiquement dans ai.ts avec les dates de séjour
    bookingUrl: undefined,
    distanceToCenter: h.distanceToCenter || 1,
    description: h.description,
  }));
}

/**
 * Génère des hôtels de fallback si l'API échoue
 */
function generateFallbackHotels(
  destination: string,
  options: {
    budgetLevel: 'economic' | 'moderate' | 'luxury';
    cityCenter: { lat: number; lng: number };
    checkInDate: Date;
    checkOutDate: Date;
  }
): Accommodation[] {
  const priceRange = getPriceRange(options.budgetLevel);
  const nights = Math.ceil(
    (options.checkOutDate.getTime() - options.checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const hotelTemplates = {
    economic: [
      { name: 'Ibis Budget', stars: 2, basePrice: 55 },
      { name: 'B&B Hotel', stars: 2, basePrice: 60 },
      { name: 'Premiere Classe', stars: 2, basePrice: 50 },
    ],
    moderate: [
      { name: 'Novotel', stars: 4, basePrice: 110 },
      { name: 'Mercure', stars: 4, basePrice: 100 },
      { name: 'Holiday Inn', stars: 3, basePrice: 90 },
    ],
    luxury: [
      { name: 'Marriott', stars: 5, basePrice: 200 },
      { name: 'Hilton', stars: 5, basePrice: 180 },
      { name: 'InterContinental', stars: 5, basePrice: 250 },
    ],
  };

  const templates = hotelTemplates[options.budgetLevel];

  return templates.map((template, index) => ({
    id: `fallback-${destination.toLowerCase()}-${index}`,
    name: `${template.name} ${destination}`,
    type: 'hotel' as const,
    address: `Centre-ville, ${destination}`,
    latitude: options.cityCenter.lat + (Math.random() - 0.5) * 0.01,
    longitude: options.cityCenter.lng + (Math.random() - 0.5) * 0.01,
    rating: 7.5 + Math.random() * 1.5,
    reviewCount: 500 + Math.floor(Math.random() * 2000),
    stars: template.stars,
    pricePerNight: template.basePrice,
    totalPrice: template.basePrice * nights,
    currency: 'EUR',
    amenities: ['WiFi gratuit', 'Climatisation'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    distanceToCenter: 0.5 + Math.random() * 1,
  }));
}

/**
 * Sélectionne le meilleur hôtel selon le budget et les préférences
 */
export function selectBestHotel(
  hotels: Accommodation[],
  preferences: { budgetLevel: 'economic' | 'moderate' | 'luxury' }
): Accommodation | null {
  if (hotels.length === 0) return null;

  // Score: rating * 10 + (10 - distanceToCenter) + prix acceptable
  const scored = hotels.map(hotel => {
    let score = hotel.rating * 10;
    score += Math.max(0, 10 - (hotel.distanceToCenter || 0) * 5);

    // Bonus pour les étoiles correspondant au budget
    const targetStars = preferences.budgetLevel === 'luxury' ? 5 : preferences.budgetLevel === 'moderate' ? 4 : 3;
    if (hotel.stars === targetStars) score += 10;

    return { hotel, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].hotel;
}

/**
 * Convertit un PlaceData de la base de données en Accommodation
 */
function placeToAccommodation(
  place: PlaceData,
  options: { cityCenter: { lat: number; lng: number }; budgetLevel: 'economic' | 'moderate' | 'luxury' }
): Accommodation {
  const priceRange = getPriceRange(options.budgetLevel);

  return {
    id: place.externalId || `db-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: place.name,
    type: 'hotel',
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    rating: (place.rating || 4) * 2, // Convertir note /5 en note /10
    reviewCount: place.reviewCount || 0,
    stars: place.stars || 3,
    pricePerNight: place.priceLevel || Math.round((priceRange.min + priceRange.max) / 2),
    totalPrice: 0, // Sera calculé par adjustHotelPrices
    currency: 'EUR',
    amenities: place.amenities || ['WiFi gratuit'],
    checkInTime: validateCheckInTime('15:00'),
    checkOutTime: validateCheckOutTime('11:00'),
    bookingUrl: place.bookingUrl,
    distanceToCenter: 0,
  };
}

/**
 * Convertit un hôtel SerpAPI en PlaceData pour sauvegarde en base
 */
function hotelToPlace(hotel: any, city: string): PlaceData {
  return {
    externalId: hotel.id,
    type: 'hotel',
    name: hotel.name,
    city,
    address: hotel.address || 'Adresse non disponible',
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    rating: hotel.rating,
    reviewCount: hotel.reviewCount,
    priceLevel: hotel.pricePerNight,
    stars: hotel.stars ? parseInt(hotel.stars.toString().match(/(\d)/)?.[1] || '3') : 3,
    amenities: hotel.amenities,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotel.name}, ${city}`)}`,
    bookingUrl: hotel.bookingUrl,
    source: 'serpapi',
    dataReliability: 'verified',
  };
}
