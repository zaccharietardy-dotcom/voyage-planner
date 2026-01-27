/**
 * Service RapidAPI Booking.com
 *
 * API officielle Booking.com via RapidAPI
 * - Disponibilité temps réel
 * - Prix exacts
 * - Liens de réservation directs
 *
 * Tarif: ~500 requêtes pour 1$
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY?.trim();
const RAPIDAPI_HOST = 'apidojo-booking-v1.p.rapidapi.com';
const RAPIDAPI_BASE_URL = `https://${RAPIDAPI_HOST}`;

// Log de démarrage
console.log(`[RapidAPI Booking] Clé configurée: ${RAPIDAPI_KEY ? '✅ Oui (' + RAPIDAPI_KEY.substring(0, 8) + '...)' : '❌ Non'}`);

export interface BookingHotel {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  stars: number;
  rating: number; // Sur 10
  reviewCount: number;
  pricePerNight: number;
  totalPrice: number;
  currency: string;
  breakfastIncluded: boolean;
  checkIn: string;
  checkOut: string;
  distanceToCenter: number;
  photoUrl: string;
  bookingUrl: string;
  available: boolean;
}

/**
 * Vérifie si RapidAPI Booking est configuré
 */
export function isRapidApiBookingConfigured(): boolean {
  return !!RAPIDAPI_KEY;
}

/**
 * Recherche le dest_id d'une ville sur Booking.com
 */
async function getDestinationId(city: string): Promise<{ destId: string; destType: string } | null> {
  if (!RAPIDAPI_KEY) return null;

  try {
    const url = `${RAPIDAPI_BASE_URL}/locations/auto-complete?text=${encodeURIComponent(city)}&languagecode=en-us`;

    const response = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!response.ok) {
      console.error(`[RapidAPI Booking] Erreur recherche ville: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Chercher la ville (type "ci" = city)
    const cityResult = data.find((item: any) => item.dest_type === 'city');

    if (cityResult) {
      console.log(`[RapidAPI Booking] Ville trouvée: ${cityResult.label} (dest_id: ${cityResult.dest_id})`);
      return {
        destId: cityResult.dest_id,
        destType: cityResult.dest_type,
      };
    }

    // Fallback sur le premier résultat
    if (data.length > 0) {
      console.log(`[RapidAPI Booking] Fallback: ${data[0].label} (dest_id: ${data[0].dest_id})`);
      return {
        destId: data[0].dest_id,
        destType: data[0].dest_type,
      };
    }

    return null;
  } catch (error) {
    console.error('[RapidAPI Booking] Erreur recherche destination:', error);
    return null;
  }
}

/**
 * Recherche des hôtels sur Booking.com avec disponibilité temps réel
 */
export async function searchHotelsWithBookingApi(
  destination: string,
  checkIn: string, // Format: YYYY-MM-DD
  checkOut: string, // Format: YYYY-MM-DD
  options: {
    guests?: number;
    rooms?: number;
    minPrice?: number;
    maxPrice?: number;
    minStars?: number;
    sortBy?: 'popularity' | 'price' | 'review_score' | 'class';
    limit?: number;
  } = {}
): Promise<BookingHotel[]> {
  if (!RAPIDAPI_KEY) {
    console.warn('[RapidAPI Booking] Clé API non configurée');
    return [];
  }

  const {
    guests = 2,
    rooms = 1,
    minPrice,
    maxPrice,
    minStars = 2,
    sortBy = 'popularity',
    limit = 15,
  } = options;

  try {
    // 1. Obtenir le dest_id de la ville
    const destInfo = await getDestinationId(destination);
    if (!destInfo) {
      console.error(`[RapidAPI Booking] Ville non trouvée: ${destination}`);
      return [];
    }

    // 2. Construire l'URL de recherche
    const params = new URLSearchParams({
      dest_ids: destInfo.destId,
      dest_type: destInfo.destType,
      arrival_date: checkIn,
      departure_date: checkOut,
      guest_qty: guests.toString(),
      room_qty: rooms.toString(),
      search_type: destInfo.destType,
      offset: '0',
      price_filter_currencycode: 'EUR',
      order_by: sortBy,
      languagecode: 'en-us',
      travel_purpose: 'leisure',
    });

    // Filtres optionnels
    if (minStars) {
      // Format: class::2,class::3,class::4,class::5 pour 2+ étoiles
      const classes = [];
      for (let i = minStars; i <= 5; i++) {
        classes.push(`class::${i}`);
      }
      params.append('categories_filter', classes.join(','));
    }

    if (minPrice || maxPrice) {
      // Format: price_filter_min::50-price_filter_max::200
      if (minPrice) params.append('price_filter_min', minPrice.toString());
      if (maxPrice) params.append('price_filter_max', maxPrice.toString());
    }

    const url = `${RAPIDAPI_BASE_URL}/properties/list?${params.toString()}`;
    console.log(`[RapidAPI Booking] Recherche: ${destination}, ${checkIn} → ${checkOut}, ${guests} pers.`);

    const response = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[RapidAPI Booking] Erreur API: ${response.status}`, errorText);
      return [];
    }

    const data = await response.json();
    const properties = data.result || [];

    // Calculer le nombre de nuits
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

    // 3. Transformer les résultats
    // Filtrer: pas de soldout
    const hotels: BookingHotel[] = properties
      .filter((p: any) => {
        if (p.type !== 'property_card') return false;
        if (p.soldout === 1) return false;
        return true;
      })
      .slice(0, limit)
      .map((p: any) => {
        const totalPrice = p.price_breakdown?.gross_price || p.min_total_price || 0;
        const pricePerNight = nights > 0 ? Math.round(totalPrice / nights) : totalPrice;

        // Construire l'URL avec les dates pré-remplies pour vérification disponibilité
        // Format: checkin=2026-01-28&checkout=2026-01-30&group_adults=2
        const baseUrl = p.url || `https://www.booking.com/hotel/search.html?ss=${encodeURIComponent(destination)}`;
        const urlWithDates = baseUrl.includes('?')
          ? `${baseUrl}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}&group_children=0&no_rooms=1`
          : `${baseUrl}?checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}&group_children=0&no_rooms=1`;

        return {
          id: `booking-${p.hotel_id}`,
          name: p.hotel_name || p.hotel_name_trans,
          address: p.address || p.address_trans || 'Adresse non disponible',
          city: p.city || destination,
          latitude: p.latitude || 0,
          longitude: p.longitude || 0,
          stars: Math.round(p.class || 3),
          rating: p.review_score || 8.0, // Déjà sur 10
          reviewCount: p.review_nr || 0,
          pricePerNight,
          totalPrice: Math.round(totalPrice),
          currency: 'EUR',
          breakfastIncluded: p.hotel_include_breakfast === 1,
          checkIn: p.checkin?.from || '15:00',
          checkOut: p.checkout?.until || '11:00',
          distanceToCenter: parseFloat(p.distance_to_cc || p.distance || '0'),
          photoUrl: p.main_photo_url?.replace('square60', 'square200') || '',
          bookingUrl: urlWithDates,
          available: p.soldout !== 1,
        };
      });

    // Log des résultats
    console.log(`[RapidAPI Booking] ✅ ${hotels.length} hôtels DISPONIBLES trouvés`);
    if (hotels.length > 0) {
      console.log(`[RapidAPI Booking] Premier: ${hotels[0].name} - ${hotels[0].pricePerNight}€/nuit (${hotels[0].stars}⭐)`);
    }

    return hotels;
  } catch (error) {
    console.error('[RapidAPI Booking] Erreur recherche hôtels:', error);
    return [];
  }
}

/**
 * Cache simple des dest_id pour éviter les requêtes répétées
 */
const destIdCache: Record<string, { destId: string; destType: string; timestamp: number }> = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

async function getCachedDestinationId(city: string): Promise<{ destId: string; destType: string } | null> {
  const normalizedCity = city.toLowerCase().trim();
  const cached = destIdCache[normalizedCity];

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[RapidAPI Booking] Cache hit: ${city} → ${cached.destId}`);
    return { destId: cached.destId, destType: cached.destType };
  }

  const result = await getDestinationId(city);
  if (result) {
    destIdCache[normalizedCity] = { ...result, timestamp: Date.now() };
  }

  return result;
}
