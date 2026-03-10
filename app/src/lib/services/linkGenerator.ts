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

import { buildDirectBookingHotelUrl } from './bookingLinks';

/**
 * Mapping ville → code IATA principal.
 * Utilisé par generateFlightLink() pour construire des URLs Aviasales valides.
 * Aviasales exige des codes IATA 3 lettres, pas des noms de ville.
 */
const CITY_TO_IATA: Record<string, string> = {
  // France
  paris: 'CDG', lyon: 'LYS', marseille: 'MRS', nice: 'NCE', toulouse: 'TLS',
  bordeaux: 'BOD', nantes: 'NTE', strasbourg: 'SXB', lille: 'LIL', montpellier: 'MPL',
  // Europe West
  london: 'LHR', londres: 'LHR', manchester: 'MAN', edinburgh: 'EDI', edimbourg: 'EDI',
  dublin: 'DUB', amsterdam: 'AMS', rotterdam: 'RTM', brussels: 'BRU', bruxelles: 'BRU',
  luxembourg: 'LUX', geneva: 'GVA', geneve: 'GVA', zurich: 'ZRH', bern: 'BRN', berne: 'BRN',
  // Europe South
  barcelona: 'BCN', barcelone: 'BCN', madrid: 'MAD', malaga: 'AGP', seville: 'SVQ', sevilla: 'SVQ',
  valencia: 'VLC', valence: 'VLC', palma: 'PMI', ibiza: 'IBZ', tenerife: 'TFS',
  lisbon: 'LIS', lisbonne: 'LIS', porto: 'OPO', faro: 'FAO',
  rome: 'FCO', roma: 'FCO', milan: 'MXP', milano: 'MXP', venice: 'VCE', venise: 'VCE',
  florence: 'FLR', firenze: 'FLR', naples: 'NAP', napoli: 'NAP', turin: 'TRN', torino: 'TRN',
  palermo: 'PMO', catania: 'CTA', bologna: 'BLQ',
  athens: 'ATH', athenes: 'ATH', thessaloniki: 'SKG', heraklion: 'HER', santorini: 'JTR',
  malta: 'MLA', 'la valette': 'MLA', valletta: 'MLA',
  // Europe Central & East
  berlin: 'BER', munich: 'MUC', frankfurt: 'FRA', hamburg: 'HAM', dusseldorf: 'DUS', cologne: 'CGN',
  vienna: 'VIE', vienne: 'VIE', prague: 'PRG', warsaw: 'WAW', varsovie: 'WAW',
  budapest: 'BUD', bucharest: 'OTP', bucarest: 'OTP', sofia: 'SOF',
  zagreb: 'ZAG', belgrade: 'BEG', ljubljana: 'LJU',
  // Europe North
  copenhagen: 'CPH', copenhague: 'CPH', stockholm: 'ARN', oslo: 'OSL',
  helsinki: 'HEL', reykjavik: 'KEF', tallinn: 'TLL', riga: 'RIX', vilnius: 'VNO',
  // Turkey & Middle East
  istanbul: 'IST', ankara: 'ESB', antalya: 'AYT',
  dubai: 'DXB', 'abu dhabi': 'AUH', doha: 'DOH', riyadh: 'RUH', jeddah: 'JED',
  'tel aviv': 'TLV',
  // North Africa
  marrakech: 'RAK', casablanca: 'CMN', tunis: 'TUN', algiers: 'ALG', alger: 'ALG',
  cairo: 'CAI', 'le caire': 'CAI',
  // Sub-Saharan Africa
  cape: 'CPT', capetown: 'CPT', johannesburg: 'JNB', nairobi: 'NBO', lagos: 'LOS',
  // Asia East
  tokyo: 'HND', osaka: 'KIX', kyoto: 'KIX', seoul: 'ICN',
  beijing: 'PEK', pekin: 'PEK', shanghai: 'PVG', guangzhou: 'CAN', shenzhen: 'SZX',
  'hong kong': 'HKG', hongkong: 'HKG', taipei: 'TPE',
  // Southeast Asia
  bangkok: 'BKK', singapore: 'SIN', singapour: 'SIN',
  'kuala lumpur': 'KUL', jakarta: 'CGK', manila: 'MNL',
  'ho chi minh': 'SGN', hanoi: 'HAN', 'ha noi': 'HAN',
  bali: 'DPS', denpasar: 'DPS', phuket: 'HKT', 'chiang mai': 'CNX',
  // South Asia
  delhi: 'DEL', 'new delhi': 'DEL', mumbai: 'BOM', bombay: 'BOM',
  bangalore: 'BLR', colombo: 'CMB', kathmandu: 'KTM',
  // Americas
  'new york': 'JFK', 'los angeles': 'LAX', chicago: 'ORD', miami: 'MIA',
  'san francisco': 'SFO', boston: 'BOS', washington: 'IAD', seattle: 'SEA',
  'las vegas': 'LAS', houston: 'IAH', atlanta: 'ATL', denver: 'DEN',
  toronto: 'YYZ', montreal: 'YUL', vancouver: 'YVR',
  'mexico city': 'MEX', mexico: 'MEX', cancun: 'CUN',
  'buenos aires': 'EZE', 'sao paulo': 'GRU', rio: 'GIG', 'rio de janeiro': 'GIG',
  bogota: 'BOG', lima: 'LIM', santiago: 'SCL',
  // Oceania
  sydney: 'SYD', melbourne: 'MEL', auckland: 'AKL',
  // Russia / Central Asia
  moscow: 'SVO', moscou: 'SVO', 'saint petersburg': 'LED', 'saint-petersbourg': 'LED',
};

/**
 * Convert a city name or IATA code to a valid 3-letter IATA code.
 * - If already a valid 3-letter uppercase code → return as-is
 * - Normalize accents, lookup in CITY_TO_IATA map
 * - Fallback: first 3 chars uppercased (better than full city name)
 */
export function cityToIata(cityOrCode: string): string {
  const trimmed = cityOrCode.trim();

  // Already an IATA code? (exactly 3 uppercase letters)
  if (/^[A-Z]{3}$/.test(trimmed)) {
    return trimmed;
  }

  // Normalize: remove accents, lowercase
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Direct lookup
  if (CITY_TO_IATA[normalized]) {
    return CITY_TO_IATA[normalized];
  }

  // Try partial match (e.g., "Ho Chi Minh City" → "ho chi minh city" contains "ho chi minh")
  for (const [city, iata] of Object.entries(CITY_TO_IATA)) {
    if (normalized.includes(city) || city.includes(normalized)) {
      return iata;
    }
  }

  // Fallback: first 3 characters uppercased
  return trimmed.substring(0, 3).toUpperCase();
}

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
  const { checkIn, checkOut, passengers } = context;

  return buildDirectBookingHotelUrl({
    hotelName: name,
    destinationHint: city,
    checkIn: checkIn ? formatDateForBooking(checkIn) : undefined,
    checkOut: checkOut ? formatDateForBooking(checkOut) : undefined,
    adults: passengers,
  });
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
  // Format: /search/{ORIGIN_IATA}{DDMM}{DEST_IATA}{DDMM_RETOUR}{PASSENGERS}
  let searchPath = `${cityToIata(origin)}`;

  if (dateStr) {
    searchPath += formatDateForAviasales(dateStr);
  }

  searchPath += cityToIata(destination);

  if (returnDateStr) {
    searchPath += formatDateForAviasales(returnDateStr);
  }

  searchPath += passengers.toString();

  return `https://www.aviasales.com/search/${searchPath}?currency=eur&locale=fr`;
}

/**
 * Génère un lien Omio pour recherche de vols
 * Format: /vols/{origin}/{destination}?departure_date=YYYY-MM-DD
 */
export function generateFlightOmioLink(
  origin: string,
  destination: string,
  date?: string,
  passengers: number = 1
): string {
  const originSlug = toOmioLocationSlug(origin);
  const destSlug = toOmioLocationSlug(destination);
  const dateParam = date ? `?departure_date=${date}` : '';
  const passengerParams = passengers > 1
    ? `${dateParam ? '&' : '?'}${Array.from({ length: passengers }, () => 'passengers%5B%5D=adult').join('&')}`
    : '';
  return `https://www.omio.fr/vols/${originSlug}/${destSlug}${dateParam}${passengerParams}`;
}

/**
 * Generates a Google Flights search URL for a given origin/destination/date.
 * Used as an alternative to Aviasales/Omio.
 */
export function generateGoogleFlightsLink(
  origin: string,
  destination: string,
  date?: string,
  returnDate?: string,
  passengers: number = 1
): string {
  const originIata = cityToIata(origin);
  const destIata = cityToIata(destination);

  let url = `https://www.google.com/travel/flights?hl=fr&curr=EUR`;

  // Build the search query
  const parts: string[] = [];
  parts.push(`from ${originIata}`);
  parts.push(`to ${destIata}`);

  if (date) {
    const dateStr = formatDateForUrl(date);
    if (dateStr) parts.push(`depart ${dateStr}`);
  }
  if (returnDate) {
    const returnStr = formatDateForUrl(returnDate);
    if (returnStr) parts.push(`return ${returnStr}`);
  }
  if (passengers > 1) {
    parts.push(`${passengers} passengers`);
  }

  url += `&q=${encodeURIComponent(parts.join(' '))}`;

  return url;
}

/**
 * Build a Google Maps directions URL between two coordinates
 */
export function buildDirectionsUrl(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  mode: string = 'transit'
): string {
  const travelMode = mode === 'walk' || mode === 'walking' ? 'walking'
    : mode === 'car' || mode === 'taxi' ? 'driving'
    : 'transit';
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${travelMode}`;
}

/**
 * Normalise un lieu en slug Omio robuste.
 * Gère accents, apostrophes et ponctuation pour éviter les liens cassés.
 */
export function toOmioLocationSlug(location: string): string {
  return location
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
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
 * Génère des liens de recherche d'hôtels vers Google Hotels, Booking.com ET Airbnb
 * Ces liens permettent à l'utilisateur de voir les hébergements DISPONIBLES en temps réel
 */
export function generateHotelSearchLinks(
  destination: string,
  checkIn: string | Date,
  checkOut: string | Date,
  guests: number = 2
): { googleHotels: string; booking: string; airbnb: string } {
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

  // Airbnb URL
  // Format dates Airbnb: YYYY-MM-DD
  const airbnbParams = new URLSearchParams({
    query: destination,
    adults: guests.toString(),
  });
  if (checkInStr) airbnbParams.set('checkin', checkInStr);
  if (checkOutStr) airbnbParams.set('checkout', checkOutStr);

  return {
    googleHotels: `https://www.google.com/travel/hotels?${googleParams.toString()}`,
    booking: `https://www.booking.com/searchresults.html?${bookingParams.toString()}`,
    airbnb: `https://www.airbnb.fr/s/${encodeURIComponent(destination.trim())}/homes?${airbnbParams.toString()}`,
  };
}
