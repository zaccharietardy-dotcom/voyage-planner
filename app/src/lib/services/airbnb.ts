/**
 * Service de recherche Airbnb via RapidAPI
 *
 * Utilise l'API "Airbnb19" (DataCrawler) sur RapidAPI
 * https://rapidapi.com/DataCrawler/api/airbnb19
 *
 * Flow: searchDestination (v1) → searchPropertyByPlaceId (v2)
 *
 * Variables d'environnement requises :
 * - getRapidApiKey() : clé RapidAPI
 * - getAirbnbHost() : host de l'API (défaut: airbnb19.p.rapidapi.com)
 *
 * Fallback: si l'API échoue, génère un lien de recherche Airbnb pré-filtré
 */

import { Accommodation } from '../types';

function getRapidApiKey() { return process.env.RAPIDAPI_KEY || ''; }
function getAirbnbHost() { return process.env.RAPIDAPI_AIRBNB_HOST || 'airbnb19.p.rapidapi.com'; }

export function isAirbnbApiConfigured(): boolean {
  return !!getRapidApiKey();
}

interface AirbnbSearchOptions {
  maxPricePerNight?: number;
  minPricePerNight?: number;
  guests?: number;
  requireKitchen?: boolean;
  limit?: number;
  cityCenter?: { lat: number; lng: number };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function isValidAirbnbRoomUrl(url?: string | null, listingId?: string): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('airbnb.com')) return false;

    const match = parsed.pathname.match(/^\/rooms\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match?.[1]) return false;

    if (listingId && match[1] !== listingId) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Étape 1: Résoudre la destination en Place ID Google via searchDestination
 */
async function resolveDestinationId(destination: string): Promise<{ id: string; name: string } | null> {
  try {
    const params = new URLSearchParams({ query: destination });
    const data = await fetchWithRetry(
      `https://${getAirbnbHost()}/api/v1/searchDestination?${params}`,
      { 'x-rapidapi-key': getRapidApiKey(), 'x-rapidapi-host': getAirbnbHost() },
    );

    if (!data || !data.status || !data.data || data.data.length === 0) return null;

    const first = data.data[0];
    return { id: first.id, name: first.display_name || first.location_name || destination };
  } catch (error) {
    console.error('[Airbnb] Erreur résolution destination:', error);
    return null;
  }
}

/**
 * Étape 2: Rechercher les propriétés via searchPropertyByPlaceId (v2)
 *
 * Retourne des items au format:
 * {
 *   listing: { id, legacyName, legacyCity, legacyCoordinate: { latitude, longitude } },
 *   avgRatingLocalized: "4.93 (97)",
 *   contextualPictures: [{ picture: "https://..." }],
 *   structuredDisplayPrice: {
 *     primaryLine: { accessibilityLabel: "€ 1,133 for 4 nights" },
 *     explanationData: { priceDetails: [{ items: [{ description: "4 nights x € 283.23" }] }] }
 *   },
 *   title: "Flat in Barcelona"
 * }
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 3
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[Airbnb] HTTP ${response.status}`);
      return null;
    }
    const data = asRecord(await response.json());
    // Rate limit → wait and retry
    const message = typeof data.message === 'string' ? data.message : '';
    if (message.includes('rate limit')) {
      const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
      console.warn(`[Airbnb] Rate limited, retry ${attempt + 1}/${maxRetries} dans ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return data;
  }
  return null;
}

async function searchByPlaceId(
  placeId: string,
  checkIn: string,
  checkOut: string,
  options: AirbnbSearchOptions,
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    placeId,
    adults: (options.guests || 2).toString(),
    currency: 'EUR',
  });

  if (checkIn) params.set('checkin', checkIn);
  if (checkOut) params.set('checkout', checkOut);
  // Ne PAS passer priceMax à l'API — elle filtre trop agressivement et retourne 0 résultats
  // pour les budgets serrés. On triera par prix côté client après.
  if (options.minPricePerNight) params.set('priceMin', options.minPricePerNight.toString());

  const data = await fetchWithRetry(
    `https://${getAirbnbHost()}/api/v2/searchPropertyByPlaceId?${params}`,
    { 'x-rapidapi-key': getRapidApiKey(), 'x-rapidapi-host': getAirbnbHost() },
  );

  const isOk = !!data && data.status === true;
  const dataPayload = data ? asRecord(data.data) : {};
  const message = data && typeof data.message === 'string' ? data.message : 'no data';
  if (!isOk || Object.keys(dataPayload).length === 0) {
    console.warn(`[Airbnb] API error: ${message}`);
    return [];
  }

  const list = dataPayload.list;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/**
 * Recherche des logements Airbnb pour une destination
 */
export async function searchAirbnbListings(
  destination: string,
  checkIn: string,
  checkOut: string,
  options: AirbnbSearchOptions = {},
): Promise<Accommodation[]> {
  if (!getRapidApiKey()) {
    console.warn('[Airbnb] getRapidApiKey() non configurée, fallback lien de recherche');
    return generateFallbackAirbnb(destination, checkIn, checkOut, options, options.cityCenter);
  }

  try {
    // Étape 1: Résoudre la destination
    const place = await resolveDestinationId(destination);

    if (!place) {
      console.warn('[Airbnb] Destination non trouvée, fallback');
      return generateFallbackAirbnb(destination, checkIn, checkOut, options, options.cityCenter);
    }

    // Étape 2: Rechercher les propriétés via v2
    const listings = await searchByPlaceId(place.id, checkIn, checkOut, options);

    if (listings.length === 0) {
      console.warn('[Airbnb] Aucun résultat, fallback');
      return generateFallbackAirbnb(destination, checkIn, checkOut, options, options.cityCenter);
    }

    const nights = Math.max(1, Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
    ));

    const sampledListings = listings.slice(0, options.limit || 10);
    let rejectedMissingId = 0;
    let rejectedInvalidUrl = 0;
    let rejectedPrice = 0;

    const accommodations: Accommodation[] = [];
    for (const item of sampledListings) {
      const listing = asRecord(item.listing);
      const listingId = String(listing.id || '').trim();
      if (!listingId) {
        rejectedMissingId++;
        continue;
      }

      const coords = asRecord(listing.legacyCoordinate);
      const pricePerNight = extractPricePerNight(item, nights);
      if (pricePerNight <= 0) {
        rejectedPrice++;
        continue;
      }

      const bookingUrl = `https://www.airbnb.com/rooms/${listingId}?check_in=${checkIn}&check_out=${checkOut}&adults=${options.guests || 2}`;
      if (!isValidAirbnbRoomUrl(bookingUrl, listingId)) {
        rejectedInvalidUrl++;
        continue;
      }

      const { rating, reviewCount } = extractRating(item);
      const photos = extractPhotos(item);

      // Le title contient souvent le type : "Flat in Barcelona", "Loft in Barcelona"
      const title = String(item.title || listing.title || '');
      const isEntireHome = title.toLowerCase().includes('flat') ||
        title.toLowerCase().includes('apartment') ||
        title.toLowerCase().includes('loft') ||
        title.toLowerCase().includes('home') ||
        title.toLowerCase().includes('condo') ||
        title.toLowerCase().includes('house') ||
        listing.legacyPDPType === 'MARKETPLACE';

      const legacyName = typeof listing.legacyName === 'string' ? listing.legacyName : '';
      const legacyCity = typeof listing.legacyCity === 'string' ? listing.legacyCity : '';
      const latitude = typeof coords.latitude === 'number' ? coords.latitude : 0;
      const longitude = typeof coords.longitude === 'number' ? coords.longitude : 0;

      accommodations.push({
        id: `airbnb-${listingId}`,
        name: legacyName || title || `Airbnb à ${destination}`,
        type: isEntireHome ? 'apartment' as const : 'bnb' as const,
        address: legacyCity || destination,
        latitude,
        longitude,
        rating,
        reviewCount,
        pricePerNight,
        totalPrice: pricePerNight * nights,
        currency: 'EUR',
        amenities: isEntireHome ? ['Logement entier', 'WiFi'] : ['WiFi'],
        photos,
        checkInTime: '15:00',
        checkOutTime: '11:00',
        bookingUrl,
        distanceToCenter: undefined,
        breakfastIncluded: false,
        description: legacyName || title || undefined,
      });
    }

    console.log(
      `[Airbnb] Audit destination=${destination} raw=${listings.length} sampled=${sampledListings.length} kept=${accommodations.length} rejectedMissingId=${rejectedMissingId} rejectedInvalidUrl=${rejectedInvalidUrl} rejectedPrice=${rejectedPrice}`
    );

    // Si cuisine requise, ne garder que les logements entiers
    let filtered = accommodations;
    if (options.requireKitchen) {
      const entireHomes = accommodations.filter(a => a.type === 'apartment');
      if (entireHomes.length > 0) {
        filtered = entireHomes;
      }
    }

    // Trier par prix croissant pour que les moins chers soient en premier
    filtered.sort((a, b) => a.pricePerNight - b.pricePerNight);

    // Log le range de prix trouvé
    if (filtered.length > 0) {
      if (options.maxPricePerNight) {
        const affordable = filtered.filter(a => a.pricePerNight <= options.maxPricePerNight! * 1.5);
        if (affordable.length > 0) {
          return affordable;
        }
      }
    }

    return filtered;
  } catch (error) {
    console.error('[Airbnb] Erreur:', error);
    return generateFallbackAirbnb(destination, checkIn, checkOut, options, options.cityCenter);
  }
}

/**
 * Extrait le prix par nuit depuis la structure v2
 *
 * Sources (par ordre de fiabilité) :
 * 1. explanationData.priceDetails → "4 nights x € 283.23"
 * 2. primaryLine.accessibilityLabel → "€ 1,133 for 4 nights" (divisé par nuits)
 * 3. primaryLine.price → "€ 1,133" (divisé par nuits)
 */
function extractPricePerNight(item: Record<string, unknown>, nights: number): number {
  const sp = asRecord(item.structuredDisplayPrice);
  const expl = asRecord(sp.explanationData);

  // 1. Chercher dans priceDetails le prix par nuit ("4 nights x € 283.23")
  const priceDetails = Array.isArray(expl.priceDetails) ? expl.priceDetails : [];
  if (priceDetails.length > 0) {
    for (const group of priceDetails) {
      const groupRecord = asRecord(group);
      const items = Array.isArray(groupRecord.items) ? groupRecord.items : [];
      for (const detail of items) {
        const detailRecord = asRecord(detail);
        const desc = typeof detailRecord.description === 'string' ? detailRecord.description : '';
        const match = desc.match(/(\d+)\s*nights?\s*x\s*[€$£]\s*([\d,.]+)/i);
        if (match) {
          return parseFloat(match[2].replace(',', ''));
        }
      }
    }
  }

  // 2. Extraire du accessibilityLabel ("€ 1,133 for 4 nights")
  const primaryLine = asRecord(sp.primaryLine);
  const label = typeof primaryLine.accessibilityLabel === 'string' ? primaryLine.accessibilityLabel : '';
  const totalMatch = label.match(/[€$£]\s*([\d,.]+)/);
  if (totalMatch && nights > 0) {
    return Math.round(parseFloat(totalMatch[1].replace(',', '')) / nights);
  }

  // 3. Extraire du price ("€ 1,133")
  const priceStr = typeof primaryLine.price === 'string' ? primaryLine.price : '';
  const priceMatch = priceStr.match(/[\d,.]+/);
  if (priceMatch && nights > 0) {
    return Math.round(parseFloat(priceMatch[0].replace(',', '')) / nights);
  }

  return 0;
}

/**
 * Extrait le rating et le nombre de reviews depuis avgRatingLocalized
 * Format: "4.93 (97)" ou "4.93"
 */
function extractRating(item: Record<string, unknown>): { rating: number; reviewCount: number } {
  const ratingStr = typeof item.avgRatingLocalized === 'string' ? item.avgRatingLocalized : '';
  const match = ratingStr.match(/([\d.]+)\s*\((\d+)\)/);

  if (match) {
    return {
      rating: parseFloat(match[1]) * 2, // Convertir /5 → /10
      reviewCount: parseInt(match[2]),
    };
  }

  // Fallback: juste un nombre
  const numMatch = ratingStr.match(/([\d.]+)/);
  if (numMatch) {
    return { rating: parseFloat(numMatch[1]) * 2, reviewCount: 0 };
  }

  return { rating: 8, reviewCount: 0 };
}

/**
 * Extrait les URLs des photos depuis contextualPictures
 */
function extractPhotos(item: Record<string, unknown>): string[] {
  const pics = Array.isArray(item.contextualPictures) ? item.contextualPictures : [];
  return pics
    .slice(0, 5)
    .map((pic) => {
      const rec = asRecord(pic);
      return typeof rec.picture === 'string' ? rec.picture : '';
    })
    .filter(Boolean);
}

/**
 * Fallback: Ne génère plus de faux Airbnb.
 * Retourne un tableau vide pour que le système utilise Booking.com
 */
function generateFallbackAirbnb(
  _destination: string,
  _checkIn: string,
  _checkOut: string,
  _options: AirbnbSearchOptions,
  _cityCenter?: { lat: number; lng: number },
): Accommodation[] {
  // Retourne vide pour que Booking.com soit utilisé à la place
  return [];
}
