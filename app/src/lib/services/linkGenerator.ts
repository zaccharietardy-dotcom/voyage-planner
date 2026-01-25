/**
 * Service de génération de liens de réservation (Bug #10)
 *
 * Exigences:
 * - Liens avec dates dynamiques (check-in, check-out, date de vol)
 * - Restaurant: URL Google Maps
 * - Hôtel: Booking.com avec dates
 * - Vol: Google Flights avec dates exactes
 * - Attraction: Site officiel ou Google Maps
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
}

export type ReservableElement =
  | ({ type: 'restaurant' } & RestaurantForLink)
  | ({ type: 'hotel' } & HotelForLink)
  | ({ type: 'flight' } & FlightForLink)
  | ({ type: 'attraction' } & AttractionForLink);

/**
 * Formate une date pour utilisation dans une URL (YYYY-MM-DD)
 */
export function formatDateForUrl(date: string | Date | null | undefined): string {
  if (!date) {
    return '';
  }

  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
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
    return parsed.toISOString().split('T')[0];
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
 * Génère un lien Google Flights avec dates
 */
export function generateFlightLink(
  flight: FlightForLink,
  context: ReservationContext
): string {
  const { origin, destination } = flight;
  const { date, returnDate } = context;

  // Format Google Flights URL
  // https://www.google.com/travel/flights?q=flights+from+CDG+to+BCN+on+2026-01-28
  const baseUrl = 'https://www.google.com/travel/flights';

  let query = `flights from ${origin} to ${destination}`;

  if (date) {
    query += ` on ${formatDateForUrl(date)}`;
  }

  if (returnDate) {
    query += ` return ${formatDateForUrl(returnDate)}`;
  }

  const params = new URLSearchParams();
  params.set('q', query);

  return `${baseUrl}?${params.toString()}`;
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
