const BOOKING_BASE_ORIGIN = 'https://www.booking.com';

const COUNTRY_CODE_BY_KEYWORD: Record<string, string> = {
  amsterdam: 'nl',
  rotterdam: 'nl',
  hague: 'nl',
  utrecht: 'nl',
  netherlands: 'nl',
  paysbas: 'nl',
  pays_bas: 'nl',

  barcelona: 'es',
  madrid: 'es',
  valencia: 'es',
  seville: 'es',
  sevilla: 'es',
  malaga: 'es',
  bilbao: 'es',
  spain: 'es',
  espagne: 'es',

  paris: 'fr',
  lyon: 'fr',
  marseille: 'fr',
  nice: 'fr',
  bordeaux: 'fr',
  toulouse: 'fr',
  nantes: 'fr',
  strasbourg: 'fr',
  france: 'fr',

  rome: 'it',
  roma: 'it',
  milan: 'it',
  milano: 'it',
  florence: 'it',
  firenze: 'it',
  venice: 'it',
  venezia: 'it',
  naples: 'it',
  napoli: 'it',
  italy: 'it',
  italie: 'it',

  berlin: 'de',
  munich: 'de',
  frankfurt: 'de',
  hamburg: 'de',
  cologne: 'de',
  germany: 'de',
  allemagne: 'de',

  london: 'gb',
  manchester: 'gb',
  edinburgh: 'gb',
  birmingham: 'gb',
  england: 'gb',
  scotland: 'gb',
  uk: 'gb',
  royaumeuni: 'gb',
  royaume_uni: 'gb',

  lisbon: 'pt',
  porto: 'pt',
  portugal: 'pt',

  brussels: 'be',
  bruxelles: 'be',
  bruges: 'be',
  antwerp: 'be',
  belgium: 'be',
  belgique: 'be',

  vienna: 'at',
  wien: 'at',
  austria: 'at',
  autriche: 'at',
  prague: 'cz',
  czech: 'cz',
  budapest: 'hu',
  hungary: 'hu',
  copenhagen: 'dk',
  denmark: 'dk',
  stockholm: 'se',
  sweden: 'se',
  oslo: 'no',
  norway: 'no',
  helsinki: 'fi',
  finland: 'fi',
  dublin: 'ie',
  ireland: 'ie',
  athens: 'gr',
  greece: 'gr',
  istanbul: 'tr',
  turkey: 'tr',
  morocco: 'ma',
  marrakech: 'ma',
  maroc: 'ma',
  tokyo: 'jp',
  japan: 'jp',
  japon: 'jp',
  'new york': 'us',
  'los angeles': 'us',
  usa: 'us',
  'united states': 'us',
};

type BuildDirectBookingHotelUrlParams = {
  hotelName: string;
  destinationHint?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  existingUrl?: string;
};

type BuildBookingSearchUrlParams = {
  hotelName: string;
  destinationHint?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  existingUrl?: string;
};

type NormalizeHotelBookingUrlParams = {
  url?: string | null;
  hotelName: string;
  destinationHint?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
};

function toBookingUrl(url: string): URL | null {
  const raw = url.trim();
  if (!raw) return null;

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw);
    }

    if (raw.startsWith('/')) {
      return new URL(raw, BOOKING_BASE_ORIGIN);
    }

    if (/^(hotel|searchresults)/i.test(raw)) {
      return new URL(`/${raw}`, BOOKING_BASE_ORIGIN);
    }

    if (raw.includes('booking.com')) {
      const normalized = raw.startsWith('//')
        ? `https:${raw}`
        : `https://${raw.replace(/^https?:\/\//i, '')}`;
      return new URL(normalized);
    }
  } catch {
    return null;
  }

  return null;
}

function extractCountryCodeFromHotelPath(pathname: string): string | null {
  const parts = pathname.toLowerCase().split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'hotel' && /^[a-z]{2}$/.test(parts[1])) {
    return parts[1];
  }
  return null;
}

function sanitizeDate(input?: string): string | undefined {
  if (!input) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : undefined;
}

export function isBookingDomain(url?: string | null): boolean {
  if (!url) return false;

  const parsed = toBookingUrl(url);
  if (parsed) {
    return parsed.hostname.toLowerCase().includes('booking.com');
  }

  const lower = url.toLowerCase();
  return lower.startsWith('/hotel/') || lower.startsWith('hotel/');
}

export function isBookingHotelPath(url?: string | null): boolean {
  if (!url) return false;

  const lower = url.toLowerCase().trim();
  if (lower.startsWith('/hotel/') || lower.startsWith('hotel/')) {
    return true;
  }

  const parsed = toBookingUrl(url);
  if (!parsed) return false;

  return parsed.pathname.toLowerCase().includes('/hotel/');
}

export function isBookingSearchUrl(url?: string | null): boolean {
  if (!url) return false;

  const lower = url.toLowerCase().trim();
  if (lower.startsWith('/searchresults') || lower.startsWith('searchresults')) {
    return true;
  }

  const parsed = toBookingUrl(url);
  if (!parsed) return false;

  return parsed.pathname.toLowerCase().startsWith('/searchresults');
}

export function generateBookingHotelSlug(hotelName: string): string {
  const cleaned = hotelName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(hotel|hostel|b&b|bed and breakfast|apartments?|residence|inn|guesthouse|suites?)\b/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned || 'hotel';
}

export function getBookingCountryCode(destinationOrCountryHint?: string): string {
  if (!destinationOrCountryHint) return 'nl';

  const lower = destinationOrCountryHint
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (/^[a-z]{2}$/.test(lower)) {
    return lower;
  }

  for (const [keyword, code] of Object.entries(COUNTRY_CODE_BY_KEYWORD)) {
    if (lower.includes(keyword)) {
      return code;
    }
  }

  return 'nl';
}

export function buildDirectBookingHotelUrl({
  hotelName,
  destinationHint,
  checkIn,
  checkOut,
  adults,
  existingUrl,
}: BuildDirectBookingHotelUrlParams): string {
  const parsedExisting = existingUrl && isBookingHotelPath(existingUrl)
    ? toBookingUrl(existingUrl)
    : null;

  const countryFromPath = parsedExisting
    ? extractCountryCodeFromHotelPath(parsedExisting.pathname)
    : null;
  const countryCode = countryFromPath || getBookingCountryCode(destinationHint);

  const slug = generateBookingHotelSlug(hotelName);
  const basePath = parsedExisting
    ? `${BOOKING_BASE_ORIGIN}${parsedExisting.pathname}`
    : `${BOOKING_BASE_ORIGIN}/hotel/${countryCode}/${slug}.html`;

  const params = parsedExisting
    ? new URLSearchParams(parsedExisting.searchParams.toString())
    : new URLSearchParams();

  const normalizedCheckIn = sanitizeDate(checkIn);
  const normalizedCheckOut = sanitizeDate(checkOut);
  const normalizedAdults = adults && adults > 0 ? adults : 2;

  if (normalizedCheckIn) params.set('checkin', normalizedCheckIn);
  if (normalizedCheckOut) params.set('checkout', normalizedCheckOut);
  params.set('group_adults', String(normalizedAdults));
  params.set('group_children', '0');
  params.set('no_rooms', '1');

  return `${basePath}?${params.toString()}`;
}

export function buildBookingSearchUrl({
  hotelName,
  destinationHint,
  checkIn,
  checkOut,
  adults,
  existingUrl,
}: BuildBookingSearchUrlParams): string {
  const parsedExisting = existingUrl && isBookingSearchUrl(existingUrl)
    ? toBookingUrl(existingUrl)
    : null;

  const params = parsedExisting
    ? new URLSearchParams(parsedExisting.searchParams.toString())
    : new URLSearchParams();

  const normalizedCheckIn = sanitizeDate(checkIn);
  const normalizedCheckOut = sanitizeDate(checkOut);
  const normalizedAdults = adults && adults > 0 ? adults : 2;
  const searchLabel = [hotelName, destinationHint].filter(Boolean).join(' ').trim();

  if (searchLabel) {
    params.set('ss', searchLabel);
  }
  if (normalizedCheckIn) params.set('checkin', normalizedCheckIn);
  if (normalizedCheckOut) params.set('checkout', normalizedCheckOut);
  params.set('group_adults', String(normalizedAdults));
  params.set('group_children', '0');
  params.set('no_rooms', '1');

  return `${BOOKING_BASE_ORIGIN}/searchresults.html?${params.toString()}`;
}

export function normalizeHotelBookingUrl({
  url,
  hotelName,
  destinationHint,
  checkIn,
  checkOut,
  adults,
}: NormalizeHotelBookingUrlParams): string {
  const raw = url?.trim();

  if (raw && raw.toLowerCase().includes('airbnb.com')) {
    return raw;
  }

  if (!raw) {
    return buildBookingSearchUrl({
      hotelName,
      destinationHint,
      checkIn,
      checkOut,
      adults,
    });
  }

  if (isBookingHotelPath(raw)) {
    return buildDirectBookingHotelUrl({
      hotelName,
      destinationHint,
      checkIn,
      checkOut,
      adults,
      existingUrl: raw,
    });
  }

  if (isBookingSearchUrl(raw)) {
    return buildBookingSearchUrl({
      hotelName,
      destinationHint,
      checkIn,
      checkOut,
      adults,
      existingUrl: raw,
    });
  }

  if (isBookingDomain(raw)) {
    return buildBookingSearchUrl({
      hotelName,
      destinationHint,
      checkIn,
      checkOut,
      adults,
    });
  }

  return raw;
}
