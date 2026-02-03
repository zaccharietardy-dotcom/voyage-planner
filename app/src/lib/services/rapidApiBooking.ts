/**
 * Service RapidAPI Booking.com (booking-com15)
 *
 * API Booking.com via RapidAPI - endpoint booking-com15
 * - Disponibilité temps réel
 * - Prix exacts
 * - Liens de réservation directs avec dates pré-remplies
 *
 * Endpoints:
 * 1. searchDestination → dest_id
 * 2. searchHotels → liste hôtels dispo avec prix
 * 3. getHotelDetails → URL Booking.com directe
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY?.trim();
const RAPIDAPI_HOST = 'booking-com15.p.rapidapi.com';
const RAPIDAPI_BASE_URL = `https://${RAPIDAPI_HOST}/api/v1/hotels`;

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
 * Cache simple des dest_id pour éviter les requêtes répétées
 */
const destIdCache: Record<string, { destId: string; destType: string; timestamp: number }> = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

/**
 * Recherche le dest_id d'une ville sur Booking.com (booking-com15)
 */
async function getDestinationId(city: string): Promise<{ destId: string; destType: string } | null> {
  if (!RAPIDAPI_KEY) return null;

  // Check cache
  const normalizedCity = city.toLowerCase().trim();
  const cached = destIdCache[normalizedCity];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[RapidAPI Booking] Cache hit: ${city} → ${cached.destId}`);
    return { destId: cached.destId, destType: cached.destType };
  }

  try {
    const url = `${RAPIDAPI_BASE_URL}/searchDestination?query=${encodeURIComponent(city)}`;

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
    const results = data.data || data || [];

    // Chercher la ville (dest_type "city")
    const cityResult = Array.isArray(results)
      ? results.find((item: any) => item.dest_type === 'city' || item.search_type === 'city')
      : null;

    const result = cityResult || (Array.isArray(results) && results.length > 0 ? results[0] : null);

    if (result) {
      const destId = result.dest_id?.toString() || result.id?.toString();
      const destType = result.dest_type || result.search_type || 'city';
      console.log(`[RapidAPI Booking] Ville trouvée: ${result.name || result.label || city} (dest_id: ${destId})`);

      // Cache
      destIdCache[normalizedCity] = { destId, destType, timestamp: Date.now() };
      return { destId, destType };
    }

    return null;
  } catch (error) {
    console.error('[RapidAPI Booking] Erreur recherche destination:', error);
    return null;
  }
}

/**
 * Génère un slug Booking.com à partir du nom de l'hôtel
 * Ex: "Hotel ClinkMama Amsterdam" → "clinkmama"
 */
function generateHotelSlug(hotelName: string): string {
  return hotelName
    .toLowerCase()
    .replace(/\b(hotel|hostel|b&b|bed and breakfast|apartments?|residence|inn)\b/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/**
 * Récupère l'URL Booking.com directe pour un hôtel
 */
async function getHotelBookingUrl(
  hotelId: string,
  checkIn: string,
  checkOut: string,
  adults: number,
  hotelName?: string,
  countryCode?: string
): Promise<string | null> {
  if (!RAPIDAPI_KEY) return null;

  try {
    const url = `${RAPIDAPI_BASE_URL}/getHotelDetails?hotel_id=${encodeURIComponent(hotelId)}&arrival_date=${checkIn}&departure_date=${checkOut}&adults=${adults}&currency_code=EUR`;

    const response = await fetch(url, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!response.ok) {
      // Si l'API échoue mais qu'on a le nom de l'hôtel, générer une URL directe
      if (hotelName) {
        const slug = generateHotelSlug(hotelName);
        const cc = countryCode || 'nl';
        const directUrl = `https://www.booking.com/hotel/${cc}/${slug}.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1`;
        console.log(`[RapidAPI Booking] ⚠️ API failed, using generated URL: ${directUrl}`);
        return directUrl;
      }
      return null;
    }

    const data = await response.json();
    const hotelData = data.data || data;

    // Log pour debug - voir les champs disponibles dans la réponse
    console.log(`[RapidAPI Booking] getHotelDetails response keys:`, Object.keys(hotelData || {}).slice(0, 15));

    // Chercher le slug dans plusieurs champs possibles
    const slug = hotelData.url
      || hotelData.hotel_url
      || hotelData.link
      || hotelData.pagename
      || hotelData.hotel_slug
      || (hotelData.hotel && hotelData.hotel.url);

    if (slug) {
      console.log(`[RapidAPI Booking] ✅ URL directe trouvée: ${String(slug).substring(0, 60)}...`);
      const baseUrl = slug.startsWith('http') ? slug : `https://www.booking.com${slug}`;
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1`;
    }

    // Fallback: générer l'URL à partir du nom de l'hôtel
    if (hotelName) {
      const generatedSlug = generateHotelSlug(hotelName);
      const cc = countryCode || (hotelData.country_code?.toLowerCase()) || 'nl';
      const directUrl = `https://www.booking.com/hotel/${cc}/${generatedSlug}.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1`;
      console.log(`[RapidAPI Booking] ⚠️ No slug in API response, using generated: ${directUrl}`);
      return directUrl;
    }

    console.log(`[RapidAPI Booking] ⚠️ Pas de slug trouvé pour hotel_id=${hotelId}, fallback recherche`);
    return null;
  } catch (error) {
    console.error(`[RapidAPI Booking] Erreur getHotelDetails ${hotelId}:`, error);
    // Fallback en cas d'erreur
    if (hotelName) {
      const slug = generateHotelSlug(hotelName);
      const cc = countryCode || 'nl';
      return `https://www.booking.com/hotel/${cc}/${slug}.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1`;
    }
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
    // 1. Obtenir le dest_id
    const destInfo = await getDestinationId(destination);
    if (!destInfo) {
      console.error(`[RapidAPI Booking] Ville non trouvée: ${destination}`);
      return [];
    }

    // 2. Rechercher les hôtels
    const params = new URLSearchParams({
      dest_id: destInfo.destId,
      search_type: destInfo.destType,
      arrival_date: checkIn,
      departure_date: checkOut,
      adults: guests.toString(),
      room_qty: rooms.toString(),
      page_number: '1',
      currency_code: 'EUR',
      sort_by: sortBy,
      languagecode: 'fr',
      units: 'metric',
    });

    if (minPrice) params.append('price_min', minPrice.toString());
    if (maxPrice) params.append('price_max', maxPrice.toString());

    // Filtre étoiles
    if (minStars && minStars > 1) {
      const classes = [];
      for (let i = minStars; i <= 5; i++) {
        classes.push(i.toString());
      }
      params.append('categories_filter', `class::${classes.join(',class::')}`);
    }

    const url = `${RAPIDAPI_BASE_URL}/searchHotels?${params.toString()}`;
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
    const properties = data.data?.hotels || data.data?.result || data.result || [];

    // Calculer le nombre de nuits
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

    // 3. Transformer les résultats et récupérer les URLs directes
    const rawHotels = Array.isArray(properties) ? properties : [];
    const availableHotels = rawHotels
      .filter((p: any) => {
        // Exclure les hôtels sold out
        if (p.soldout === 1 || p.soldout === true) return false;
        // Garder seulement ceux avec un prix
        const price = p.property?.priceBreakdown?.grossPrice?.value
          || p.price_breakdown?.gross_price
          || p.min_total_price
          || p.composite_price_breakdown?.gross_amount_per_night?.value
          || 0;
        return price > 0;
      })
      .slice(0, limit);

    // Récupérer les URLs Booking directes pour les 5 premiers (limite API calls)
    const hotelUrlPromises = availableHotels.slice(0, 5).map(async (p: any) => {
      const hotelId = p.hotel_id || p.property?.id || p.id;
      const hotelName = p.property?.name || p.hotel_name || p.hotel_name_trans;
      const countryCode = p.property?.countryCode || p.country_trans || p.cc1;
      if (hotelId) {
        return getHotelBookingUrl(hotelId.toString(), checkIn, checkOut, guests, hotelName, countryCode);
      }
      return null;
    });
    const hotelUrls = await Promise.all(hotelUrlPromises);

    const hotels: BookingHotel[] = availableHotels.map((p: any, index: number) => {
      // Extraire le prix (plusieurs formats possibles selon la version de l'API)
      const grossPrice = p.property?.priceBreakdown?.grossPrice?.value
        || p.price_breakdown?.gross_price
        || p.min_total_price
        || p.composite_price_breakdown?.gross_amount_per_night?.value
        || 0;
      const totalPrice = Math.round(grossPrice);
      const pricePerNight = nights > 0 ? Math.round(totalPrice / nights) : totalPrice;

      // Extraire les coordonnées
      const latitude = p.property?.latitude || p.latitude || 0;
      const longitude = p.property?.longitude || p.longitude || 0;

      // Extraire le rating
      const reviewScore = p.property?.reviewScore || p.review_score || 8.0;
      const reviewCount = p.property?.reviewCount || p.review_nr || 0;

      // Extraire les étoiles
      const stars = Math.round(
        p.property?.propertyClass || p.property?.accuratePropertyClass || p.class || 3
      );

      // Extraire le check-in/check-out
      const checkInTime = p.property?.checkin?.fromTime || p.checkin?.from || '15:00';
      const checkOutTime = p.property?.checkout?.untilTime || p.checkout?.until || '11:00';

      // Petit-déjeuner
      const breakfastIncluded = p.property?.hasBreakfast === true
        || p.hotel_include_breakfast === 1
        || false;

      // URL de réservation : priorité à l'URL directe obtenue via getHotelDetails
      const directUrl = index < 5 ? hotelUrls[index] : null;
      const hotelName = p.property?.name || p.hotel_name || p.hotel_name_trans || 'Hotel';
      const fallbackUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${hotelName} ${destination}`)}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}&no_rooms=1&lang=fr`;
      const bookingUrl = directUrl || p.property?.url || p.url || fallbackUrl;

      // Photo
      const photoUrl = p.property?.photoUrls?.[0]
        || p.main_photo_url?.replace('square60', 'square200')
        || p.property?.mainPhotoUrl
        || '';

      return {
        id: `booking-${p.hotel_id || p.property?.id || p.id || index}`,
        name: hotelName,
        address: p.property?.address || p.address || p.address_trans || 'Adresse non disponible',
        city: p.property?.city || p.city || destination,
        latitude,
        longitude,
        stars,
        rating: reviewScore,
        reviewCount,
        pricePerNight,
        totalPrice,
        currency: 'EUR',
        breakfastIncluded,
        checkIn: checkInTime,
        checkOut: checkOutTime,
        distanceToCenter: parseFloat(p.property?.distanceFromCenter || p.distance_to_cc || p.distance || '0'),
        photoUrl,
        bookingUrl: bookingUrl.startsWith('http') ? bookingUrl : `https://www.booking.com${bookingUrl}`,
        available: true,
      };
    });

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
