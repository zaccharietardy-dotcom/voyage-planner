/**
 * Service de recherche d'hôtels
 *
 * Chaîne de priorité:
 * 1. Booking.com RapidAPI (booking-com15) - prix réels + liens directs
 * 2. TripAdvisor + SerpAPI Google Hotels (fallback/validation)
 * 3. Claude AI (fallback si APIs échouent)
 * 4. Hôtels génériques (fallback final)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Accommodation } from '../types';
import { tokenTracker } from './tokenTracker';
import { searchHotelsWithSerpApi, isSerpApiPlacesConfigured, getAvailableHotelNames } from './serpApiPlaces';
import { searchHotelsWithBookingApi, isRapidApiBookingConfigured, type BookingHotel } from './rapidApiBooking';
import { searchTripAdvisorHotels, isTripAdvisorConfigured } from './tripadvisor';
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

function getCacheKey(destination: string, budgetLevel: string, checkIn?: string, checkOut?: string): string {
  // Inclure les dates dans la clé de cache car la disponibilité dépend des dates
  const datesPart = checkIn && checkOut ? `-${checkIn}-${checkOut}` : '';
  return `${destination.toLowerCase().trim()}-${budgetLevel}${datesPart}`;
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
 * Vérifie si le petit-déjeuner est inclus dans les amenities
 */
function checkBreakfastIncluded(amenities: string[] | undefined): boolean {
  if (!amenities || amenities.length === 0) return false;

  const breakfastKeywords = [
    'petit-déjeuner', 'petit déjeuner', 'breakfast',
    'petit-dej', 'pdj inclus', 'breakfast included',
    'complimentary breakfast', 'free breakfast',
    'buffet breakfast', 'continental breakfast',
    'colazione', 'frühstück', 'desayuno'
  ];

  const amenitiesLower = amenities.map(a => a.toLowerCase());
  return breakfastKeywords.some(keyword =>
    amenitiesLower.some(amenity => amenity.includes(keyword))
  );
}

/**
 * Prix moyen par nuit selon le niveau de budget
 */
function getPriceRange(budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury'): { min: number; max: number; hardMax: number } {
  switch (budgetLevel) {
    case 'economic':
      return { min: 40, max: 80, hardMax: 120 };
    case 'moderate':
      return { min: 80, max: 150, hardMax: 220 };
    case 'comfort':
      return { min: 120, max: 250, hardMax: 400 };
    case 'luxury':
      return { min: 150, max: 400, hardMax: Infinity };
    default:
      return { min: 60, max: 120, hardMax: 200 };
  }
}

/**
 * Recherche des hôtels - PRIORITÉ: Booking.com pour la disponibilité temps réel
 */
export async function searchHotels(
  destination: string,
  options: {
    budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury';
    cityCenter: { lat: number; lng: number };
    checkInDate: Date;
    checkOutDate: Date;
    guests: number;
    forceRefresh?: boolean;
    maxPricePerNight?: number; // Plafond issu de la stratégie budget
  }
): Promise<Accommodation[]> {
  // IMPORTANT: PAS DE CACHE pour les hôtels !
  // La disponibilité change en temps réel, un hôtel peut être complet à tout moment.
  console.log(`[Hotels] Recherche FRAÎCHE pour ${destination} (pas de cache - disponibilité temps réel)`);

  const checkInStr = options.checkInDate.toISOString().split('T')[0];
  const checkOutStr = options.checkOutDate.toISOString().split('T')[0];
  const priceRange = getPriceRange(options.budgetLevel);

  // Si un maxPricePerNight est fourni par la stratégie budget, l'utiliser comme plafond
  if (options.maxPricePerNight) {
    priceRange.max = Math.min(priceRange.max, options.maxPricePerNight);
    priceRange.hardMax = Math.min(priceRange.hardMax, options.maxPricePerNight * 1.2);
    console.log(`[Hotels] Budget strategy: plafond ${options.maxPricePerNight}€/nuit → max ajusté à ${priceRange.max}€`);
  }

  const targetStars = options.budgetLevel === 'luxury' ? 4 : (options.budgetLevel === 'comfort' || options.budgetLevel === 'moderate') ? 3 : 2;

  // 1. PRIORITÉ: Booking.com RapidAPI (booking-com15) - prix réels + liens directs
  if (isRapidApiBookingConfigured()) {
    try {
      console.log(`[Hotels] 🔍 Étape 1: Booking.com API (prix réels + liens directs)...`);
      console.log(`[Hotels] Budget: ${options.budgetLevel}, Prix: ${priceRange.min}-${priceRange.max}€/nuit, ${targetStars}+ étoiles`);

      const bookingHotels = await searchHotelsWithBookingApi(destination, checkInStr, checkOutStr, {
        guests: options.guests,
        rooms: 1,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        minStars: targetStars,
        sortBy: options.budgetLevel === 'economic' ? 'price' : 'review_score',
        limit: 15,
      });

      if (bookingHotels.length > 0) {
        const hotels: Accommodation[] = bookingHotels.map((h: BookingHotel) => {
          if (h.breakfastIncluded) {
            console.log(`[Hotels] ✅ ${h.name}: Petit-déjeuner INCLUS`);
          }

          return {
            id: h.id,
            name: h.name,
            type: 'hotel' as const,
            address: h.address,
            latitude: h.latitude || options.cityCenter.lat,
            longitude: h.longitude || options.cityCenter.lng,
            rating: h.rating,
            reviewCount: h.reviewCount,
            stars: h.stars,
            pricePerNight: h.pricePerNight,
            totalPrice: h.totalPrice,
            currency: 'EUR',
            amenities: h.breakfastIncluded ? ['Petit-déjeuner inclus'] : [],
            photos: h.photoUrl ? [h.photoUrl] : undefined,
            checkInTime: validateCheckInTime(h.checkIn),
            checkOutTime: validateCheckOutTime(h.checkOut),
            bookingUrl: h.bookingUrl,
            distanceToCenter: h.distanceToCenter,
            description: '',
            breakfastIncluded: h.breakfastIncluded,
          };
        });

        console.log(`[Hotels] ✅ ${hotels.length} hôtels via Booking.com (liens directs réservation)`);
        return adjustHotelPrices(hotels, options);
      }
    } catch (error) {
      console.warn('[Hotels] Booking.com API error, trying TripAdvisor/SerpAPI:', error);
    }
  }

  // 2. FALLBACK: TripAdvisor (découverte) → SerpAPI (validation dispo)
  if (isTripAdvisorConfigured()) {
    try {
      console.log(`[Hotels] 🔍 Fallback: TripAdvisor (prix multi-providers)...`);
      const taHotels = await searchTripAdvisorHotels(destination, {
        checkIn: checkInStr,
        checkOut: checkOutStr,
        adults: options.guests,
        rooms: 1,
        currency: 'EUR',
        limit: 15,
      });

      if (taHotels.length > 0) {
        let filtered = taHotels.filter(h =>
          h.pricePerNight === 0 ||
          (h.pricePerNight >= priceRange.min * 0.7 && h.pricePerNight <= priceRange.hardMax)
        );

        if (filtered.length > 0) {
          console.log(`[Hotels] ${filtered.length} candidats TripAdvisor dans le budget`);

          if (isSerpApiPlacesConfigured()) {
            try {
              console.log(`[Hotels] 🔍 Validation dispo via SerpAPI Google Hotels...`);
              const serpHotels = await searchHotelsWithSerpApi(destination, checkInStr, checkOutStr, {
                adults: options.guests,
                minPrice: priceRange.min,
                maxPrice: Math.round(priceRange.hardMax),
                hotelClass: targetStars,
                sort: options.budgetLevel === 'economic' ? 'lowest_price' : 'highest_rating',
                limit: 30,
              });

              if (serpHotels.length > 0) {
                const serpMap = new Map(serpHotels.map((h: any) => [h.name?.toLowerCase().trim(), h]));

                const validated: Accommodation[] = [];
                for (const taHotel of filtered) {
                  const taNameLower = taHotel.name.toLowerCase().trim();
                  let serpMatch: any = serpMap.get(taNameLower);
                  if (!serpMatch) {
                    for (const [serpName, serpData] of serpMap) {
                      if (serpName.includes(taNameLower) || taNameLower.includes(serpName) ||
                          serpName.split(/\s+/).filter((w: string) => w.length > 3).some((w: string) => taNameLower.includes(w))) {
                        serpMatch = serpData;
                        break;
                      }
                    }
                  }

                  if (serpMatch) {
                    validated.push({
                      ...taHotel,
                      bookingUrl: serpMatch.bookingUrl || taHotel.bookingUrl,
                      latitude: serpMatch.latitude || taHotel.latitude,
                      longitude: serpMatch.longitude || taHotel.longitude,
                      description: (taHotel.description || '') + ' • Disponibilité confirmée',
                    });
                    console.log(`[Hotels] ✅ ${taHotel.name}: DISPONIBLE (confirmé Google Hotels)`);
                  }
                }

                if (validated.length > 0) {
                  console.log(`[Hotels] ✅ ${validated.length}/${filtered.length} hôtels confirmés disponibles`);
                  return adjustHotelPrices(validated, options);
                }

                console.log(`[Hotels] Aucun match TA↔SerpAPI, utilisation des résultats SerpAPI directs`);
                const serpAccommodations: Accommodation[] = serpHotels.slice(0, 10).map((h: any) => {
                  const amenities = h.amenities || [];
                  const breakfastIncluded = checkBreakfastIncluded(amenities);
                  let stars = 3;
                  if (h.stars) {
                    stars = typeof h.stars === 'number' ? h.stars : parseInt(String(h.stars).match(/(\d)/)?.[1] || '3');
                  }
                  return {
                    id: h.id,
                    name: h.name,
                    type: 'hotel' as const,
                    address: h.address || 'Adresse non disponible',
                    latitude: h.latitude || options.cityCenter.lat,
                    longitude: h.longitude || options.cityCenter.lng,
                    rating: h.rating ? (h.rating <= 5 ? h.rating * 2 : h.rating) : 8,
                    reviewCount: h.reviewCount || 0,
                    stars,
                    pricePerNight: h.pricePerNight || priceRange.min,
                    totalPrice: h.totalPrice || 0,
                    currency: 'EUR',
                    amenities,
                    checkInTime: validateCheckInTime(h.checkIn),
                    checkOutTime: validateCheckOutTime(h.checkOut),
                    bookingUrl: h.bookingUrl,
                    distanceToCenter: 0,
                    description: 'Disponibilité confirmée',
                    breakfastIncluded,
                  };
                });
                return adjustHotelPrices(serpAccommodations, options);
              }
            } catch (serpError) {
              console.warn('[Hotels] SerpAPI validation error:', serpError);
            }
          }

          console.log(`[Hotels] ✅ ${filtered.length} hôtels TripAdvisor (dispo non vérifiée)`);
          return adjustHotelPrices(filtered, options);
        }
      }
    } catch (error) {
      console.warn('[Hotels] TripAdvisor error, trying SerpAPI:', error);
    }
  }

  // 3. FALLBACK: SerpAPI Google Hotels seul
  if (isSerpApiPlacesConfigured()) {
    try {
      console.log(`[Hotels] 🔍 Fallback: SerpAPI Google Hotels...`);

      const serpHotels = await searchHotelsWithSerpApi(destination, checkInStr, checkOutStr, {
        adults: options.guests,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        hotelClass: targetStars,
        sort: options.budgetLevel === 'economic' ? 'lowest_price' : 'highest_rating',
        limit: 15,
      });

      if (serpHotels.length > 0) {
        const hotels: Accommodation[] = serpHotels.map((h: any) => {
          const amenities = h.amenities || [];
          const breakfastIncluded = checkBreakfastIncluded(amenities);
          let stars = 3;
          if (h.stars) {
            if (typeof h.stars === 'number') stars = h.stars;
            else if (typeof h.stars === 'string') {
              const match = h.stars.match(/(\d)/);
              if (match) stars = parseInt(match[1]);
            }
          }

          return {
            id: h.id,
            name: h.name,
            type: 'hotel' as const,
            address: h.address || 'Adresse non disponible',
            latitude: h.latitude || options.cityCenter.lat,
            longitude: h.longitude || options.cityCenter.lng,
            rating: h.rating ? (h.rating <= 5 ? h.rating * 2 : h.rating) : 8,
            reviewCount: h.reviewCount || 0,
            stars,
            pricePerNight: h.pricePerNight || getPriceRange(options.budgetLevel).min,
            totalPrice: h.totalPrice || 0,
            currency: 'EUR',
            amenities,
            checkInTime: validateCheckInTime(h.checkIn),
            checkOutTime: validateCheckOutTime(h.checkOut),
            bookingUrl: h.bookingUrl,
            distanceToCenter: 0,
            description: '',
            breakfastIncluded,
          };
        });

        console.log(`[Hotels] ✅ ${hotels.length} hôtels via SerpAPI Google Hotels`);
        return adjustHotelPrices(hotels, options);
      }
    } catch (error) {
      console.warn('[Hotels] SerpAPI error, trying Claude:', error);
    }
  }

  // 5. Fallback: Claude AI (pas de vérification de disponibilité)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log(`[Hotels] ⚠️ Fallback Claude AI (disponibilité non garantie)`);
      const hotels = await fetchHotelsFromClaude(destination, options);
      console.log(`[Hotels] ${hotels.length} hôtels trouvés via Claude AI`);
      return adjustHotelPrices(hotels, options);
    } catch (error) {
      console.error('[Hotels] Claude AI error:', error);
    }
  }

  // 6. Dernier fallback: hôtels génériques
  console.log(`[Hotels] ⚠️ Fallback hôtels génériques (disponibilité non garantie)`);
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
    budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury';
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

  const budgetLabels: Record<string, string> = {
    economic: 'économique (hôtels 2-3 étoiles, auberges)',
    moderate: 'moyen (hôtels 3-4 étoiles)',
    comfort: 'confort (hôtels 4 étoiles, boutique hotels)',
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
    model: 'claude-3-5-haiku-20241022',
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
    // Fallback: lien de recherche Booking.com avec le nom de l'hôtel
    bookingUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${h.name} ${destination}`)}&lang=fr`,
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
    budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury';
    cityCenter: { lat: number; lng: number };
    checkInDate: Date;
    checkOutDate: Date;
  }
): Accommodation[] {
  const priceRange = getPriceRange(options.budgetLevel);
  const nights = Math.ceil(
    (options.checkOutDate.getTime() - options.checkInDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const hotelTemplates: Record<string, { name: string; stars: number; basePrice: number }[]> = {
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
    comfort: [
      { name: 'Pullman', stars: 4, basePrice: 160 },
      { name: 'MGallery', stars: 4, basePrice: 180 },
      { name: 'Sofitel', stars: 5, basePrice: 200 },
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
    bookingUrl: `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${template.name} ${destination}`)}&checkin=${options.checkInDate.toISOString().split('T')[0]}&checkout=${options.checkOutDate.toISOString().split('T')[0]}&lang=fr`,
    distanceToCenter: 0.5 + Math.random() * 1,
  }));
}

/**
 * Calcule la distance moyenne entre un hôtel et les attractions
 */
function calculateAverageDistanceToAttractions(
  hotel: Accommodation,
  attractions: Array<{ latitude?: number; longitude?: number }>
): number {
  if (!attractions || attractions.length === 0) return 0;

  const validAttractions = attractions.filter(a => a.latitude && a.longitude);
  if (validAttractions.length === 0) return 0;

  const distances = validAttractions.map(attraction => {
    const latDiff = hotel.latitude - (attraction.latitude || 0);
    const lngDiff = hotel.longitude - (attraction.longitude || 0);
    // Distance approximative en km (1° lat ≈ 111km, 1° lng ≈ 85km à latitude 40°)
    return Math.sqrt(Math.pow(latDiff * 111, 2) + Math.pow(lngDiff * 85, 2));
  });

  return distances.reduce((sum, d) => sum + d, 0) / distances.length;
}

/**
 * Sélectionne le meilleur hôtel selon le budget, la proximité au centre ET aux attractions
 *
 * Les hôtels SerpAPI sont déjà triés et filtrés par disponibilité,
 * on prend le premier par défaut ou on fait un scoring si nécessaire.
 */
export function selectBestHotel(
  hotels: Accommodation[],
  preferences: {
    budgetLevel: 'economic' | 'moderate' | 'comfort' | 'luxury';
    attractions?: Array<{ latitude?: number; longitude?: number; name?: string }>;
    preferApartment?: boolean;
  }
): Accommodation | null {
  if (hotels.length === 0) return null;

  // HARD BUDGET CUTOFF: filter out hotels that exceed the budget's hard max
  const priceRange = getPriceRange(preferences.budgetLevel);
  let affordableHotels = hotels.filter(h => h.pricePerNight <= priceRange.hardMax);

  if (affordableHotels.length === 0) {
    // No hotels within hard max — take the cheapest available
    console.warn(`[Hotels] ⚠️ Aucun hôtel sous ${priceRange.hardMax}€/nuit, sélection du moins cher`);
    affordableHotels = [...hotels].sort((a, b) => a.pricePerNight - b.pricePerNight).slice(0, 3);
  } else {
    const removed = hotels.length - affordableHotels.length;
    if (removed > 0) {
      console.log(`[Hotels] Budget ${preferences.budgetLevel}: ${removed} hôtels exclus (>${priceRange.hardMax}€/nuit)`);
    }
  }

  // Score all affordable hotels (including SerpAPI ones — don't blindly take first)
  const attractions = preferences.attractions || [];

  const scored = affordableHotels.map(hotel => {
    let score = 0;

    // 1. Note de l'hôtel (0-100 points, note sur 10 * 10)
    score += hotel.rating * 10;

    // 2. Proximité au centre-ville (0-20 points)
    const centerDistance = hotel.distanceToCenter || 0;
    score += Math.max(0, 20 - centerDistance * 10);

    // 3. Proximité aux attractions (0-30 points)
    if (attractions.length > 0) {
      const avgDistanceToAttractions = calculateAverageDistanceToAttractions(hotel, attractions);
      score += Math.max(0, 30 - avgDistanceToAttractions * 10);
    }

    // 4. Bonus pour les étoiles correspondant au budget (0-10 points)
    const targetStars = preferences.budgetLevel === 'luxury' ? 5
      : preferences.budgetLevel === 'comfort' ? 4
      : preferences.budgetLevel === 'moderate' ? 4 : 3;
    if (hotel.stars === targetStars) score += 10;
    if (hotel.stars === targetStars - 1 || hotel.stars === targetStars + 1) score += 5;

    // 5. Bonus for being within ideal price range (0-15 points)
    if (hotel.pricePerNight >= priceRange.min && hotel.pricePerNight <= priceRange.max) {
      score += 15;
    } else if (hotel.pricePerNight < priceRange.min) {
      score += 5; // Cheap but might be lower quality
    }

    // 6. Bonus for apartments when budget strategy prefers Airbnb (réduit pour ne pas dominer)
    if (preferences.preferApartment) {
      const isApartment = hotel.type === 'apartment' || hotel.type === 'bnb' ||
        /\b(apartment|flat|appart|résidence|studio|loft)\b/i.test(hotel.name);
      if (isApartment) {
        score += 15; // Réduit de 50 → 15 pour ne pas écraser les hôtels
      }
      // Also prefer cheaper options when airbnb strategy
      score += Math.max(0, 10 - (hotel.pricePerNight / 100));
    }

    return { hotel, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  console.log(`[Hotels] Sélectionné: ${best.hotel.name} (score=${best.score.toFixed(1)}, ${best.hotel.pricePerNight}€/nuit)`);
  if (best.hotel.id?.startsWith('booking-')) {
    console.log(`[Hotels] ⚠️ Source Booking.com: disponibilité non garantie à 100%`);
  }

  return best.hotel;
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
