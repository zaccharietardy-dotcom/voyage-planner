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
import { searchHotelsWithBookingApi, isRapidApiBookingConfigured, enrichHotelWithGooglePlaces, type BookingHotel } from './rapidApiBooking';
import { searchTripAdvisorHotels, isTripAdvisorConfigured } from './tripadvisor';
import { searchPlacesFromDB, savePlacesToDB, type PlaceData } from './placeDatabase';
import { normalizeHotelBookingUrl } from './bookingLinks';
import { calculateDistance } from './geocoding';
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

type SerpHotelCandidate = {
  id?: string;
  name?: string;
  amenities?: string[];
  stars?: number | string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  reviewCount?: number;
  pricePerNight?: number;
  totalPrice?: number;
  checkIn?: string;
  checkOut?: string;
  bookingUrl?: string;
};

type ClaudeHotelCandidate = {
  id?: string;
  name?: string;
  type?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  reviewCount?: number;
  stars?: number;
  pricePerNight?: number;
  currency?: string;
  amenities?: string[];
  checkInTime?: string;
  checkOutTime?: string;
  distanceToCenter?: number;
  description?: string;
};

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

function normalizeHotelsBookingUrls(
  hotels: Accommodation[],
  destination: string,
  checkIn: string,
  checkOut: string,
  guests: number
): Accommodation[] {
  return hotels.map((hotel) => ({
    ...hotel,
    bookingUrl: normalizeHotelBookingUrl({
      url: hotel.bookingUrl,
      hotelName: hotel.name,
      destinationHint: destination,
      checkIn,
      checkOut,
      adults: guests,
    }),
  }));
}

function normalizeHotelNameForAvailability(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(hotel|hostel|resort|suite|suites|apartment|apartments|residence|residenza|inn|spa|the|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areLikelySameHotelName(left: string, right: string): boolean {
  const a = normalizeHotelNameForAvailability(left);
  const b = normalizeHotelNameForAvailability(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  if (minLen >= 8 && (a.includes(b) || b.includes(a))) return true;

  const tokensA = new Set(a.split(' ').filter((token) => token.length >= 4));
  const tokensB = new Set(b.split(' ').filter((token) => token.length >= 4));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }
  if (overlap >= 2) return true;
  if (Math.min(tokensA.size, tokensB.size) <= 2 && overlap >= 1) return true;
  return false;
}

function appendAvailabilityBadge(description: string | undefined): string {
  if (!description) return 'Disponibilité confirmée';
  if (/disponibilit[ée]\s+confirm[ée]e/i.test(description)) return description;
  return `${description} • Disponibilité confirmée`;
}

async function filterHotelsWithLiveAvailability(
  hotels: Accommodation[],
  destination: string,
  checkIn: string,
  checkOut: string,
  guests: number,
  cityCenter?: { lat: number; lng: number }
): Promise<Accommodation[]> {
  if (hotels.length === 0 || !isSerpApiPlacesConfigured()) return hotels;

  try {
    const availableNames = await getAvailableHotelNames(destination, checkIn, checkOut, guests);
    if (!availableNames || availableNames.size === 0) {
      return hotels;
    }

    const availableList = Array.from(availableNames);
    const matchedHotels = hotels.filter((hotel) =>
      availableList.some((name) => areLikelySameHotelName(hotel.name, name))
    );

    if (matchedHotels.length === 0) {
      console.warn(`[Hotels] Aucun match de disponibilité trouvé pour "${destination}" (${checkIn} → ${checkOut}) — conservation de la liste initiale`);
      return hotels;
    }

    if (matchedHotels.length < hotels.length) {
      console.log(`[Hotels] Disponibilité live: ${matchedHotels.length}/${hotels.length} hôtels confirmés`);
    }

    const confirmedHotels = matchedHotels.map((hotel) => ({
      ...hotel,
      description: appendAvailabilityBadge(hotel.description),
    }));

    // Avoid collapsing to a single (possibly excentré) option when name matching is partial.
    // Keep confirmed hotels first, then complete with the best remaining options.
    const MIN_CONFIRMED_HOTELS = 3;
    if (confirmedHotels.length >= Math.min(MIN_CONFIRMED_HOTELS, hotels.length)) {
      return confirmedHotels;
    }

    const confirmedIds = new Set(confirmedHotels.map((hotel) => hotel.id));
    const fallbackCandidates = hotels
      .filter((hotel) => !confirmedIds.has(hotel.id))
      .sort((a, b) => {
        const aDist = cityCenter
          ? calculateDistance(cityCenter.lat, cityCenter.lng, a.latitude, a.longitude)
          : Number.POSITIVE_INFINITY;
        const bDist = cityCenter
          ? calculateDistance(cityCenter.lat, cityCenter.lng, b.latitude, b.longitude)
          : Number.POSITIVE_INFINITY;
        if (aDist !== bDist) return aDist - bDist;
        if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
        return (a.pricePerNight || 0) - (b.pricePerNight || 0);
      });

    const targetCount = Math.min(Math.max(5, confirmedHotels.length), hotels.length);
    const completedHotels = [
      ...confirmedHotels,
      ...fallbackCandidates.slice(0, Math.max(0, targetCount - confirmedHotels.length)),
    ];

    console.log(
      `[Hotels] Disponibilité live partielle (${confirmedHotels.length} confirmés), ` +
      `complété à ${completedHotels.length} options pour garder des hôtels centraux`
    );
    return completedHotels;
  } catch (error) {
    console.warn('[Hotels] Vérification disponibilité live impossible, fallback sur liste initiale:', error);
    return hotels;
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

  const checkInStr = options.checkInDate.toISOString().split('T')[0];
  const checkOutStr = options.checkOutDate.toISOString().split('T')[0];
  const priceRange = getPriceRange(options.budgetLevel);

  const finalizeHotels = async (hotels: Accommodation[]): Promise<Accommodation[]> => {
    const normalized = normalizeHotelsBookingUrls(hotels, destination, checkInStr, checkOutStr, options.guests);
    const available = await filterHotelsWithLiveAvailability(
      normalized,
      destination,
      checkInStr,
      checkOutStr,
      options.guests,
      options.cityCenter
    );
    return adjustHotelPrices(available, options);
  };

  // Si un maxPricePerNight est fourni par la stratégie budget, l'utiliser comme plafond
  if (options.maxPricePerNight) {
    priceRange.max = Math.min(priceRange.max, options.maxPricePerNight);
    priceRange.hardMax = Math.min(priceRange.hardMax, options.maxPricePerNight * 1.2);
  }

  const targetStars = options.budgetLevel === 'luxury' ? 4 : (options.budgetLevel === 'comfort' || options.budgetLevel === 'moderate') ? 3 : 2;

  // 1. PRIORITÉ: Booking.com RapidAPI (booking-com15) - prix réels + liens directs
  if (isRapidApiBookingConfigured()) {
    try {

      let bookingHotels = await searchHotelsWithBookingApi(destination, checkInStr, checkOutStr, {
        guests: options.guests,
        rooms: 1,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        minStars: targetStars,
        sortBy: options.budgetLevel === 'economic' ? 'price' : 'review_score',
        limit: 15,
      });

      // If strict filters return very few results, run a relaxed pass.
      // This avoids ending up with a single, often excentré, option.
      if (bookingHotels.length > 0 && bookingHotels.length < 4) {
        const strictCount = bookingHotels.length;
        const relaxedHotels = await searchHotelsWithBookingApi(destination, checkInStr, checkOutStr, {
          guests: options.guests,
          rooms: 1,
          maxPrice: Math.round(Math.max(priceRange.max * 1.6, priceRange.hardMax)),
          minStars: Math.max(1, targetStars - 1),
          sortBy: 'review_score',
          limit: 30,
        });

        if (relaxedHotels.length > bookingHotels.length) {
          const merged = new Map<string, BookingHotel>();
          for (const hotel of [...bookingHotels, ...relaxedHotels]) {
            const idKey = hotel.id?.trim();
            const nameKey = normalizeHotelNameForAvailability(hotel.name || '');
            const key = idKey || nameKey;
            if (!key) continue;
            if (!merged.has(key)) {
              merged.set(key, hotel);
            }
          }
          bookingHotels = Array.from(merged.values());
          console.log(
            `[Hotels] Booking pass relax: ${bookingHotels.length} options retained ` +
            `(strict=${strictCount}, relaxed=${relaxedHotels.length})`
          );
        }
      }

      if (bookingHotels.length > 0) {
        const hotels: Accommodation[] = bookingHotels.map((h: BookingHotel) => {
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
            dataReliability: (h.latitude && h.longitude) ? 'verified' as const : 'estimated' as const,
          };
        });

        return finalizeHotels(hotels);
      }
    } catch (error) {
      console.warn('[Hotels] Booking.com API error, trying TripAdvisor/SerpAPI:', error);
    }
  }

  // 2. FALLBACK: TripAdvisor (découverte) → SerpAPI (validation dispo)
  if (isTripAdvisorConfigured()) {
    try {
      const taHotels = await searchTripAdvisorHotels(destination, {
        checkIn: checkInStr,
        checkOut: checkOutStr,
        adults: options.guests,
        rooms: 1,
        currency: 'EUR',
        limit: 15,
      });

      if (taHotels.length > 0) {
        const filtered = taHotels.filter(h =>
          h.pricePerNight === 0 ||
          (h.pricePerNight >= priceRange.min * 0.7 && h.pricePerNight <= priceRange.hardMax)
        );

        if (filtered.length > 0) {

          if (isSerpApiPlacesConfigured()) {
            try {
              const serpHotels = (await searchHotelsWithSerpApi(destination, checkInStr, checkOutStr, {
                adults: options.guests,
                minPrice: priceRange.min,
                maxPrice: Math.round(priceRange.hardMax),
                hotelClass: targetStars,
                sort: options.budgetLevel === 'economic' ? 'lowest_price' : 'highest_rating',
                limit: 30,
              })) as SerpHotelCandidate[];

              if (serpHotels.length > 0) {
                const serpMap = new Map<string, SerpHotelCandidate>(
                  serpHotels
                    .filter((h): h is SerpHotelCandidate & { name: string } => typeof h.name === 'string' && h.name.trim().length > 0)
                    .map((h) => [h.name.toLowerCase().trim(), h])
                );

                const validated: Accommodation[] = [];
                for (const taHotel of filtered) {
                  const taNameLower = taHotel.name.toLowerCase().trim();
                  let serpMatch: SerpHotelCandidate | undefined = serpMap.get(taNameLower);
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
                  }
                }

                if (validated.length > 0) {
                  return finalizeHotels(validated);
                }

                const serpAccommodations: Accommodation[] = serpHotels.slice(0, 10).map((h, index: number) => {
                  const amenities = h.amenities || [];
                  const breakfastIncluded = checkBreakfastIncluded(amenities);
                  let stars = 3;
                  if (h.stars) {
                    stars = typeof h.stars === 'number' ? h.stars : parseInt(String(h.stars).match(/(\d)/)?.[1] || '3');
                  }
                  return {
                    id: h.id || `${destination.toLowerCase()}-serp-${index}`,
                    name: h.name || `Hôtel ${index + 1}`,
                    type: 'hotel' as const,
                    address: h.address || 'Adresse non disponible',
                    latitude: h.latitude || options.cityCenter.lat,
                    longitude: h.longitude || options.cityCenter.lng,
                    rating: Math.round((h.rating ? (h.rating <= 5 ? h.rating * 2 : h.rating) : 8) * 10) / 10,
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
                    dataReliability: (h.latitude && h.longitude) ? 'verified' as const : 'estimated' as const,
                  };
                });
                // Enrichir les adresses manquantes via Google Places
                const enrichedSerpAccommodations = await Promise.all(
                  serpAccommodations.map(h => enrichHotelWithGooglePlaces(h as unknown as BookingHotel, destination) as unknown as Promise<Accommodation>)
                );
                return finalizeHotels(enrichedSerpAccommodations);
              }
            } catch (serpError) {
              console.warn('[Hotels] SerpAPI validation error:', serpError);
            }
          }

          return finalizeHotels(filtered);
        }
      }
    } catch (error) {
      console.warn('[Hotels] TripAdvisor error, trying SerpAPI:', error);
    }
  }

  // 3. FALLBACK: SerpAPI Google Hotels seul
  if (isSerpApiPlacesConfigured()) {
    try {

      const serpHotels = (await searchHotelsWithSerpApi(destination, checkInStr, checkOutStr, {
        adults: options.guests,
        minPrice: priceRange.min,
        maxPrice: priceRange.max,
        hotelClass: targetStars,
        sort: options.budgetLevel === 'economic' ? 'lowest_price' : 'highest_rating',
        limit: 15,
      })) as SerpHotelCandidate[];

      if (serpHotels.length > 0) {
                const hotels: Accommodation[] = serpHotels.map((h, index: number) => {
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
                    id: h.id || `${destination.toLowerCase()}-serp-fallback-${index}`,
                    name: h.name || `Hôtel ${index + 1}`,
                    type: 'hotel' as const,
                    address: h.address || 'Adresse non disponible',
            latitude: h.latitude || options.cityCenter.lat,
            longitude: h.longitude || options.cityCenter.lng,
            rating: Math.round((h.rating ? (h.rating <= 5 ? h.rating * 2 : h.rating) : 8) * 10) / 10,
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
            dataReliability: (h.latitude && h.longitude) ? 'verified' as const : 'estimated' as const,
          };
        });

        // Enrichir les adresses manquantes via Google Places
        const enrichedHotels = await Promise.all(
          hotels.map(h => enrichHotelWithGooglePlaces(h as unknown as BookingHotel, destination) as unknown as Promise<Accommodation>)
        );
        return finalizeHotels(enrichedHotels);
      }
    } catch (error) {
      console.warn('[Hotels] SerpAPI error, trying Claude:', error);
    }
  }

  // 5. Fallback: Claude AI (pas de vérification de disponibilité)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const hotels = await fetchHotelsFromClaude(destination, options);
      // Enrichir les adresses manquantes via Google Places
      const enrichedHotels = await Promise.all(
        hotels.map(h => enrichHotelWithGooglePlaces(h as unknown as BookingHotel, destination) as unknown as Promise<Accommodation>)
      );
      return finalizeHotels(enrichedHotels);
    } catch (error) {
      console.error('[Hotels] Claude AI error:', error);
    }
  }

  // 6. Dernier fallback: hôtels génériques
  return finalizeHotels(generateFallbackHotels(destination, options));
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
    checkInDate?: Date;
    checkOutDate?: Date;
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

  const rawHotels = JSON.parse(jsonStr) as ClaudeHotelCandidate[];
  const checkIn = options.checkInDate ? options.checkInDate.toISOString().split('T')[0] : undefined;
  const checkOut = options.checkOutDate ? options.checkOutDate.toISOString().split('T')[0] : undefined;

  return rawHotels.map((h, index: number) => ({
    id: h.id || `${destination.toLowerCase()}-hotel-${index}`,
    name: h.name || `Hotel ${index + 1}`,
    type: 'hotel' as const,
    address: h.address || 'Adresse non disponible',
    latitude: h.latitude || options.cityCenter.lat + (Math.random() - 0.5) * 0.02,
    longitude: h.longitude || options.cityCenter.lng + (Math.random() - 0.5) * 0.02,
    rating: Math.round(Math.min(10, Math.max(1, h.rating || 8)) * 10) / 10,
    reviewCount: h.reviewCount || 500,
    stars: Math.min(5, Math.max(1, h.stars || 3)),
    pricePerNight: h.pricePerNight || (priceRange.min + priceRange.max) / 2,
    currency: h.currency || 'EUR',
    amenities: h.amenities || ['WiFi gratuit'],
    checkInTime: validateCheckInTime(h.checkInTime),
    checkOutTime: validateCheckOutTime(h.checkOutTime),
    bookingUrl: normalizeHotelBookingUrl({
      hotelName: h.name || `Hotel ${index + 1}`,
      destinationHint: destination,
      checkIn,
      checkOut,
      adults: options.guests,
    }),
    distanceToCenter: h.distanceToCenter || 1,
    description: h.description,
    dataReliability: (h.latitude && h.longitude) ? 'verified' as const : 'estimated' as const,
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
    rating: Math.round((7.5 + Math.random() * 1.5) * 10) / 10,
    reviewCount: 500 + Math.floor(Math.random() * 2000),
    stars: template.stars,
    pricePerNight: template.basePrice,
    totalPrice: template.basePrice * nights,
    currency: 'EUR',
    amenities: ['WiFi gratuit', 'Climatisation'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    bookingUrl: normalizeHotelBookingUrl({
      hotelName: `${template.name} ${destination}`,
      destinationHint: destination,
      checkIn: options.checkInDate.toISOString().split('T')[0],
      checkOut: options.checkOutDate.toISOString().split('T')[0],
      adults: 2,
    }),
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
    cityCenter?: { lat: number; lng: number };
    maxBudgetPerNight?: number;
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
  }

  // HARD DISTANCE CAP: filter out hotels > 5km from city center (using GPS coords, not unreliable distanceToCenter)
  const MAX_HOTEL_DISTANCE_KM = 5;
  if (preferences.cityCenter) {
    const { lat: cLat, lng: cLng } = preferences.cityCenter;
    const hotelsWithTrueDistance = affordableHotels.map(h => {
      const latDiff = h.latitude - cLat;
      const lngDiff = h.longitude - cLng;
      const trueDistKm = Math.sqrt(Math.pow(latDiff * 111, 2) + Math.pow(lngDiff * 85, 2));
      return { hotel: h, trueDistKm };
    });

    const withinRange = hotelsWithTrueDistance.filter(h => h.trueDistKm <= MAX_HOTEL_DISTANCE_KM);
    if (withinRange.length > 0) {
      affordableHotels = withinRange.map(h => h.hotel);
    } else {
      // All hotels are far — keep the 3 closest
      console.warn(`[Hotels] ⚠️ Aucun hôtel dans un rayon de ${MAX_HOTEL_DISTANCE_KM}km, sélection des 3 plus proches`);
      hotelsWithTrueDistance.sort((a, b) => a.trueDistKm - b.trueDistKm);
      affordableHotels = hotelsWithTrueDistance.slice(0, 3).map(h => h.hotel);
    }
  }

  // Score all affordable hotels (including SerpAPI ones — don't blindly take first)
  const attractions = preferences.attractions || [];

  const scored = affordableHotels.map(hotel => {
    let score = 0;

    // 1. Note de l'hôtel (0-100 points, note sur 10 * 10)
    score += hotel.rating * 10;

    // 2. Proximité au centre-ville (0-40 points) — weighted higher to avoid far hotels
    // Use true GPS distance if cityCenter is available (distanceToCenter from API is often unreliable: 0 or 1km)
    let centerDist = hotel.distanceToCenter || 0;
    if (preferences.cityCenter) {
      const latDiff = hotel.latitude - preferences.cityCenter.lat;
      const lngDiff = hotel.longitude - preferences.cityCenter.lng;
      centerDist = Math.sqrt(Math.pow(latDiff * 111, 2) + Math.pow(lngDiff * 85, 2));
    }
    score += Math.max(0, 40 - centerDist * 15);

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

    // 5b. Pénalité forte si dépassement du budget stratégique par nuit
    if (preferences.maxBudgetPerNight && hotel.pricePerNight > preferences.maxBudgetPerNight) {
      const overBudgetRatio = hotel.pricePerNight / preferences.maxBudgetPerNight;
      score -= (overBudgetRatio - 1) * 50; // -50 points par 100% de dépassement
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
    rating: Math.round(((place.rating || 4) * 2) * 10) / 10, // Convertir note /5 en note /10
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
function hotelToPlace(hotel: Accommodation, city: string): PlaceData {
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
