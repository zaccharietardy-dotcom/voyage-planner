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
 * Génère un lien Google Flights avec dates
 *
 * On utilise Skyscanner qui a des URLs prévisibles et bien structurées:
 * https://www.skyscanner.fr/transport/vols/ORY/BCN/260128/260204/
 * Format de date: YYMMDD
 *
 * Alternative: Google Flights avec format tfs encodé (complexe)
 */
export function generateFlightLink(
  flight: FlightForLink,
  context: ReservationContext
): string {
  const { origin, destination } = flight;
  const { date, returnDate, passengers = 1 } = context;

  // Fonction pour formater la date au format YYMMDD pour Skyscanner
  const formatDateForSkyscanner = (dateStr: string): string => {
    if (!dateStr) return '';
    // dateStr est au format YYYY-MM-DD
    const [year, month, day] = dateStr.split('-');
    // Prendre les 2 derniers chiffres de l'année
    const shortYear = year.slice(2);
    return `${shortYear}${month}${day}`;
  };

  const dateStr = date ? formatDateForUrl(date) : '';
  const returnDateStr = returnDate ? formatDateForUrl(returnDate) : '';

  // Construire l'URL Skyscanner
  // Format: /transport/vols/{origin}/{destination}/{date_aller}/{date_retour}/?adults=N
  const baseUrl = 'https://www.skyscanner.fr/transport/vols';

  let url = `${baseUrl}/${origin.toLowerCase()}/${destination.toLowerCase()}/`;

  if (dateStr) {
    url += `${formatDateForSkyscanner(dateStr)}/`;
  }

  if (returnDateStr) {
    url += `${formatDateForSkyscanner(returnDateStr)}/`;
  }

  // Toujours ajouter les paramètres de passagers (Skyscanner défaut à 1 sinon)
  const hasReturn = returnDateStr ? '1' : '0';
  url += `?adults=${passengers}&adultsv2=${passengers}&cabinclass=economy&children=0&childrenv2=&infants=0&preferdirects=false&rtn=${hasReturn}`;

  return url;
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
