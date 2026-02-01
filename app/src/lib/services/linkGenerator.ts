/**
 * Service de génération de liens de réservation (Bug #10)
 *
 * Exigences:
 * - Liens avec dates dynamiques (check-in, check-out, date de vol)
 * - Restaurant: URL Google Maps
 * - Hôtel: Booking.com avec dates
 * - Vol: Aviasales avec lien affilié Travelpayouts (commission ~40% du revenu Aviasales)
 * - Attraction: Site officiel, Viator (affilié 8%), ou Google Maps
 */

/**
 * Types d'éléments pour la génération de liens
 */
export interface RestaurantForLink {
  name: string;
  address: string;
  placeId?: string;
}

export interface HotelForLink {
  name: string;
  city: string;
  placeId?: string;
}

export interface FlightForLink {
  origin: string;
  destination: string;
}

export interface AttractionForLink {
  name: string;
  address: string;
  website?: string;
  placeId?: string;
}

export interface ReservationContext {
  checkIn?: string;
  checkOut?: string;
  date?: string;
  returnDate?: string;
  passengers?: number;
}

export type ReservableElement =
  | ({ type: 'restaurant' } & RestaurantForLink)
  | ({ type: 'hotel' } & HotelForLink)
  | ({ type: 'flight' } & FlightForLink)
  | ({ type: 'attraction' } & AttractionForLink);

/**
 * Formate une date pour utilisation dans une URL (YYYY-MM-DD)
 * IMPORTANT: Utilise la date LOCALE, pas UTC, pour éviter les décalages de timezone
 */
export function formatDateForUrl(date: string | Date | null | undefined): string {
  if (!date) {
    return '';
  }

  if (date instanceof Date) {
    // IMPORTANT: Utiliser getFullYear/Month/Date pour la date LOCALE
    // et non toISOString() qui convertit en UTC
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Si c'est déjà une chaîne au format YYYY-MM-DD, la retourner
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  // Essayer de parser la chaîne
  try {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      return '';
    }
    // Utiliser la date locale
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

/**
 * Formate une date pour Booking.com (YYYY-MM-DD)
 */
export function formatDateForBooking(date: string | Date): string {
  return formatDateForUrl(date);
}

/**
 * Génère un lien Google Maps pour un restaurant
 */
export function generateRestaurantLink(restaurant: RestaurantForLink): string {
  const { name, address, placeId } = restaurant;

  // Si on a un placeId, utiliser l'URL directe
  if (placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }

  // Sinon, recherche par nom et adresse
  const query = `${name}, ${address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Génère un lien Booking.com pour un hôtel avec dates
 */
export function generateHotelLink(
  hotel: HotelForLink,
  context: ReservationContext
): string {
  const { name, city } = hotel;
  const { checkIn, checkOut } = context;

  const searchQuery = `${name} ${city}`;
  const baseUrl = 'https://www.booking.com/searchresults.html';

  const params = new URLSearchParams();
  params.set('ss', searchQuery);

  if (checkIn) {
    params.set('checkin', formatDateForBooking(checkIn));
  }

  if (checkOut) {
    params.set('checkout', formatDateForBooking(checkOut));
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Génère un lien Aviasales pour recherche de vols
 *
 * Format URL Aviasales: /search/{ORIGIN}{DDMM}{DESTINATION}{DDMM}{PASSENGERS}
 * Exemple aller simple: /search/CDG2302BCN1 (CDG le 23/02, BCN, 1 passager)
 * Exemple aller-retour: /search/CDG2302BCN01031 (CDG le 23/02, BCN retour 01/03, 1 passager)
 *
 * Ce lien est ensuite converti en lien affilié via l'API Travelpayouts
 * (POST /api/affiliate-link) pour tracker les commissions.
 */
export function generateFlightLink(
  flight: FlightForLink,
  context: ReservationContext
): string {
  const { origin, destination } = flight;
  const { date, returnDate, passengers = 1 } = context;

  // Formater la date au format DDMM pour Aviasales
  const formatDateForAviasales = (dateStr: string): string => {
    if (!dateStr) return '';
    // dateStr est au format YYYY-MM-DD
    const [, month, day] = dateStr.split('-');
    return `${day}${month}`;
  };

  const dateStr = date ? formatDateForUrl(date) : '';
  const returnDateStr = returnDate ? formatDateForUrl(returnDate) : '';

  // Construire l'URL Aviasales
  // Format: /search/{ORIGIN}{DDMM}{DESTINATION}{DDMM_RETOUR}{PASSENGERS}
  let searchPath = `${origin.toUpperCase()}`;

  if (dateStr) {
    searchPath += formatDateForAviasales(dateStr);
  }

  searchPath += destination.toUpperCase();

  if (returnDateStr) {
    searchPath += formatDateForAviasales(returnDateStr);
  }

  searchPath += passengers.toString();

  return `https://www.aviasales.com/search/${searchPath}?currency=eur`;
}

/**
 * Convertit un lien Aviasales (ou autre) en lien affilié Travelpayouts
 * Appelle l'API interne /api/affiliate-link
 *
 * Usage: const affiliateUrl = await generateAffiliateLink(aviasalesUrl);
 */
export async function generateAffiliateLink(
  url: string,
  baseUrl: string = ''
): Promise<string> {
  try {
    const apiUrl = baseUrl ? `${baseUrl}/api/affiliate-link` : '/api/affiliate-link';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      console.error('[AffiliateLink] API error:', response.status);
      return url; // Fallback: retourner le lien original
    }

    const data = await response.json();
    return data.success ? data.affiliate : url;
  } catch (error) {
    console.error('[AffiliateLink] Error:', error);
    return url; // Fallback: retourner le lien original
  }
}

/**
 * Convertit plusieurs liens en liens affiliés en une seule requête (max 10)
 */
export async function generateAffiliateLinks(
  urls: string[],
  baseUrl: string = ''
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  try {
    const apiUrl = baseUrl ? `${baseUrl}/api/affiliate-link` : '/api/affiliate-link';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    });

    if (!response.ok) {
      // Fallback: retourner les liens originaux
      urls.forEach(url => result.set(url, url));
      return result;
    }

    const data = await response.json();
    const links = data.links || [data];

    for (const link of links) {
      result.set(link.original, link.success ? link.affiliate : link.original);
    }
  } catch {
    urls.forEach(url => result.set(url, url));
  }

  return result;
}

/**
 * Génère un lien pour une attraction (site officiel ou Google Maps)
 */
export function generateAttractionLink(attraction: AttractionForLink): string {
  const { name, address, website, placeId } = attraction;

  // Priorité 1: Site officiel
  if (website) {
    return website;
  }

  // Priorité 2: Google Maps avec placeId
  if (placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }

  // Priorité 3: Recherche Google Maps
  const query = `${name}, ${address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Génère un lien de réservation basé sur le type d'élément
 */
export function generateReservationLink(
  element: ReservableElement,
  context: ReservationContext
): string {
  switch (element.type) {
    case 'restaurant':
      return generateRestaurantLink(element);

    case 'hotel':
      return generateHotelLink(element, context);

    case 'flight':
      return generateFlightLink(element, context);

    case 'attraction':
      return generateAttractionLink(element);

    default:
      // Type exhaustif, ne devrait jamais arriver
      throw new Error(`Unknown element type`);
  }
}

/**
 * Génère des liens de recherche d'hôtels vers Google Hotels ET Booking.com
 * Ces liens permettent à l'utilisateur de voir les hôtels DISPONIBLES en temps réel
 */
export function generateHotelSearchLinks(
  destination: string,
  checkIn: string | Date,
  checkOut: string | Date,
  guests: number = 2
): { googleHotels: string; booking: string } {
  const checkInStr = formatDateForUrl(checkIn);
  const checkOutStr = formatDateForUrl(checkOut);

  // Google Hotels URL
  const googleParams = new URLSearchParams({
    q: `hotels ${destination}`,
    hl: 'fr',
    gl: 'fr',
  });
  if (checkInStr) googleParams.set('checkin', checkInStr);
  if (checkOutStr) googleParams.set('checkout', checkOutStr);
  googleParams.set('guests', guests.toString());

  // Booking.com URL
  const bookingParams = new URLSearchParams({
    ss: destination,
    group_adults: guests.toString(),
    no_rooms: '1',
    group_children: '0',
  });
  if (checkInStr) bookingParams.set('checkin', checkInStr);
  if (checkOutStr) bookingParams.set('checkout', checkOutStr);

  return {
    googleHotels: `https://www.google.com/travel/hotels?${googleParams.toString()}`,
    booking: `https://www.booking.com/searchresults.html?${bookingParams.toString()}`,
  };
}
