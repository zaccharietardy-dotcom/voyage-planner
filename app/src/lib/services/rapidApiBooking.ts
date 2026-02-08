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
 * Détecte le code pays Booking.com à partir de la destination
 */
function getCountryCodeFromDestination(destination: string): string {
  const dest = destination.toLowerCase();

  // Map des villes/pays vers codes Booking.com
  const countryMap: Record<string, string> = {
    // Pays-Bas
    'amsterdam': 'nl', 'rotterdam': 'nl', 'hague': 'nl', 'utrecht': 'nl', 'netherlands': 'nl',
    // Espagne
    'barcelona': 'es', 'madrid': 'es', 'valencia': 'es', 'seville': 'es', 'sevilla': 'es',
    'malaga': 'es', 'bilbao': 'es', 'spain': 'es', 'espagne': 'es',
    // France
    'paris': 'fr', 'lyon': 'fr', 'marseille': 'fr', 'nice': 'fr', 'bordeaux': 'fr',
    'toulouse': 'fr', 'nantes': 'fr', 'strasbourg': 'fr', 'france': 'fr',
    // Italie
    'rome': 'it', 'roma': 'it', 'milan': 'it', 'milano': 'it', 'florence': 'it',
    'firenze': 'it', 'venice': 'it', 'venezia': 'it', 'naples': 'it', 'napoli': 'it', 'italy': 'it', 'italie': 'it',
    // Allemagne
    'berlin': 'de', 'munich': 'de', 'frankfurt': 'de', 'hamburg': 'de', 'cologne': 'de',
    'germany': 'de', 'allemagne': 'de',
    // UK
    'london': 'gb', 'manchester': 'gb', 'edinburgh': 'gb', 'birmingham': 'gb', 'uk': 'gb',
    'england': 'gb', 'scotland': 'gb',
    // Portugal
    'lisbon': 'pt', 'porto': 'pt', 'portugal': 'pt',
    // Belgique
    'brussels': 'be', 'bruxelles': 'be', 'bruges': 'be', 'antwerp': 'be', 'belgium': 'be', 'belgique': 'be',
    // Autres
    'vienna': 'at', 'wien': 'at', 'austria': 'at', 'autriche': 'at',
    'prague': 'cz', 'czech': 'cz',
    'budapest': 'hu', 'hungary': 'hu',
    'copenhagen': 'dk', 'denmark': 'dk',
    'stockholm': 'se', 'sweden': 'se',
    'oslo': 'no', 'norway': 'no',
    'helsinki': 'fi', 'finland': 'fi',
    'dublin': 'ie', 'ireland': 'ie',
    'athens': 'gr', 'greece': 'gr',
    'istanbul': 'tr', 'turkey': 'tr',
    'morocco': 'ma', 'marrakech': 'ma', 'maroc': 'ma',
    'new york': 'us', 'los angeles': 'us', 'usa': 'us', 'united states': 'us',
    'tokyo': 'jp', 'japan': 'jp', 'japon': 'jp',
  };

  for (const [key, code] of Object.entries(countryMap)) {
    if (dest.includes(key)) {
      return code;
    }
  }

  return 'nl'; // Default
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
      // Si l'API échoue mais qu'on a le nom de l'hôtel, utiliser une URL de recherche
      if (hotelName) {
        const searchUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName)}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1&lang=fr`;
        return searchUrl;
      }
      return null;
    }

    const data = await response.json();
    const hotelData = data.data || data;

    // Log pour debug - voir les champs disponibles dans la réponse

    // Chercher le slug dans plusieurs champs possibles
    const slug = hotelData.url
      || hotelData.hotel_url
      || hotelData.link
      || hotelData.pagename
      || hotelData.hotel_slug
      || (hotelData.hotel && hotelData.hotel.url);

    if (slug) {
      const slugStr = String(slug);
      // Valider que le slug est bien un lien/path Booking.com (pas Facebook, blog, etc.)
      const isBookingSlug = slugStr.includes('booking.com')
        || slugStr.startsWith('/hotel/')
        || slugStr.startsWith('hotel/')
        || (!slugStr.startsWith('http') && !slugStr.includes('facebook') && !slugStr.includes('blogspot') && !slugStr.includes('instagram') && !slugStr.includes('twitter'));

      if (isBookingSlug) {
        const baseUrl = slugStr.startsWith('http') ? slugStr : `https://www.booking.com${slugStr.startsWith('/') ? '' : '/'}${slugStr}`;
        // Double-check: l'URL résolue doit être sur booking.com
        if (baseUrl.includes('booking.com') && !baseUrl.includes('facebook') && !baseUrl.includes('blogspot')) {
          const separator = baseUrl.includes('?') ? '&' : '?';
          return `${baseUrl}${separator}checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1`;
        }
      }
    }

    // Fallback: URL de recherche Booking.com avec le nom de l'hôtel (plus fiable que slug généré)
    if (hotelName) {
      const cc = countryCode || (hotelData.country_code?.toLowerCase()) || 'nl';
      const searchUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName)}&dest_type=city&checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1&lang=fr`;
      return searchUrl;
    }

    return null;
  } catch (error) {
    console.error(`[RapidAPI Booking] Erreur getHotelDetails ${hotelId}:`, error);
    // Fallback en cas d'erreur: URL de recherche (plus fiable que slug généré)
    if (hotelName) {
      return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName)}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${adults}&no_rooms=1&lang=fr`;
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
    // Utiliser getCountryCodeFromDestination comme fallback si l'API ne retourne pas le code pays
    const destinationCountryCode = getCountryCodeFromDestination(destination);

    const hotelUrlPromises = availableHotels.slice(0, 5).map(async (p: any) => {
      const hotelId = p.hotel_id || p.property?.id || p.id;
      const hotelName = p.property?.name || p.hotel_name || p.hotel_name_trans;
      const countryCode = p.property?.countryCode || p.country_trans || p.cc1 || destinationCountryCode;
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
      // IMPORTANT: Valider que l'URL est bien sur booking.com (pas Facebook, blogs, etc.)
      const directUrl = index < 5 ? hotelUrls[index] : null;
      const hotelName = p.property?.name || p.hotel_name || p.hotel_name_trans || 'Hotel';
      const fallbackUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${hotelName} ${destination}`)}&checkin=${checkIn}&checkout=${checkOut}&group_adults=${guests}&no_rooms=1&lang=fr`;

      // Valider que l'URL candidate est bien une URL Booking.com
      const isValidBookingUrl = (url: string | null | undefined): boolean => {
        if (!url) return false;
        const urlLower = url.toLowerCase();
        if (!urlLower.includes('booking.com')) return false;
        const badDomains = ['facebook', 'blogspot', 'instagram', 'twitter', 'tripadvisor', 'airbnb'];
        return !badDomains.some(domain => urlLower.includes(domain));
      };

      // Priorité: URL directe > URL API > fallback (toujours valide)
      let bookingUrl = fallbackUrl; // Fallback garanti sur Booking.com
      if (isValidBookingUrl(directUrl)) {
        bookingUrl = directUrl!;
      } else if (isValidBookingUrl(p.property?.url)) {
        bookingUrl = p.property.url;
      } else if (isValidBookingUrl(p.url)) {
        bookingUrl = p.url;
      }

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
        rating: Math.round((reviewScore || 0) * 10) / 10,
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

    // Enrichir les hôtels sans adresse avec Google Places
    const enrichedHotels = await Promise.all(
      hotels.map(hotel => enrichHotelWithGooglePlaces(hotel, destination))
    );

    return enrichedHotels;
  } catch (error) {
    console.error('[RapidAPI Booking] Erreur recherche hôtels:', error);
    return [];
  }
}

/**
 * Enrichit un hôtel avec Google Places si l'adresse est manquante
 */
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export async function enrichHotelWithGooglePlaces(hotel: BookingHotel, destinationCity?: string): Promise<BookingHotel> {
  // Si l'adresse est déjà valide, pas besoin d'enrichir
  if (hotel.address && hotel.address !== 'Adresse non disponible' && !hotel.address.includes('non disponible')) {
    return hotel;
  }

  // Si pas de clé Google Places, on ne peut pas enrichir
  if (!GOOGLE_PLACES_API_KEY) {
    return hotel;
  }

  try {

    // Recherche Google Places Text Search
    const searchQuery = `${hotel.name} ${hotel.city || ''} hotel`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[RapidAPI Booking] Google Places error: ${response.status}`);
      return hotel;
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];

      // Valider que le résultat Google Places est dans la bonne ville/pays
      const addressLower = (place.formatted_address || '').toLowerCase();
      const cityLower = (hotel.city || '').toLowerCase();
      const destLower = (destinationCity || '').toLowerCase();
      const cityInAddress = cityLower && addressLower.includes(cityLower);
      const destInAddress = destLower && addressLower.includes(destLower);

      // Vérification par distance si coordonnées existantes non-nulles
      let distanceOk = true;
      if (place.geometry?.location && hotel.latitude && hotel.longitude) {
        const dLat = place.geometry.location.lat - hotel.latitude;
        const dLng = place.geometry.location.lng - hotel.longitude;
        const approxDistKm = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
        if (approxDistKm > 50) {
          distanceOk = false;
        }
      }

      if (!cityInAddress && !destInAddress && !distanceOk) {
        console.warn(`[RapidAPI Booking] ❌ Google Places résultat rejeté pour "${hotel.name}": "${place.formatted_address}" n'est pas dans ${hotel.city || destinationCity}`);
        return hotel;
      }

      // Mettre à jour l'adresse
      if (place.formatted_address) {
        hotel.address = place.formatted_address;
      }

      // Mettre à jour les coordonnées si elles semblent être des fallback (0,0 ou très génériques)
      if (place.geometry?.location) {
        const newLat = place.geometry.location.lat;
        const newLng = place.geometry.location.lng;

        // Si les coordonnées actuelles sont 0 ou très proches du centre-ville générique
        if (hotel.latitude === 0 || hotel.longitude === 0 ||
            (Math.abs(hotel.latitude - newLat) > 0.01 && hotel.latitude === Math.round(hotel.latitude * 100) / 100)) {
          hotel.latitude = newLat;
          hotel.longitude = newLng;
        }
      }
    }
  } catch (error) {
    console.warn(`[RapidAPI Booking] Erreur enrichissement Google Places:`, error);
  }

  return hotel;
}
