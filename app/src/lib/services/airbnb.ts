/**
 * Service de recherche Airbnb via RapidAPI
 *
 * Utilise l'API "Airbnb19" (DataCrawler) sur RapidAPI
 * https://rapidapi.com/DataCrawler/api/airbnb19
 *
 * Flow: searchDestination (v1) → searchPropertyByPlaceId (v2)
 *
 * Variables d'environnement requises :
 * - RAPIDAPI_KEY : clé RapidAPI
 * - RAPIDAPI_AIRBNB_HOST : host de l'API (défaut: airbnb19.p.rapidapi.com)
 *
 * Fallback: si l'API échoue, génère un lien de recherche Airbnb pré-filtré
 */

import { Accommodation } from '../types';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_AIRBNB_HOST = process.env.RAPIDAPI_AIRBNB_HOST || 'airbnb19.p.rapidapi.com';

export function isAirbnbApiConfigured(): boolean {
  return !!RAPIDAPI_KEY;
}

interface AirbnbSearchOptions {
  maxPricePerNight?: number;
  minPricePerNight?: number;
  guests?: number;
  requireKitchen?: boolean;
  limit?: number;
}

/**
 * Étape 1: Résoudre la destination en Place ID Google via searchDestination
 */
async function resolveDestinationId(destination: string): Promise<{ id: string; name: string } | null> {
  try {
    const params = new URLSearchParams({ query: destination });
    const data = await fetchWithRetry(
      `https://${RAPIDAPI_AIRBNB_HOST}/api/v1/searchDestination?${params}`,
      { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': RAPIDAPI_AIRBNB_HOST },
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
async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[Airbnb] HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    // Rate limit → wait and retry
    if (data.message && data.message.includes('rate limit')) {
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
): Promise<any[]> {
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
    `https://${RAPIDAPI_AIRBNB_HOST}/api/v2/searchPropertyByPlaceId?${params}`,
    { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': RAPIDAPI_AIRBNB_HOST },
  );

  if (!data || !data.status || !data.data) {
    console.warn(`[Airbnb] API error: ${data?.message || 'no data'}`);
    return [];
  }

  return data.data.list || [];
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
  if (!RAPIDAPI_KEY) {
    console.warn('[Airbnb] RAPIDAPI_KEY non configurée, fallback lien de recherche');
    return generateFallbackAirbnb(destination, checkIn, checkOut, options);
  }

  try {
    // Étape 1: Résoudre la destination
    console.log(`[Airbnb] Résolution destination: "${destination}"...`);
    const place = await resolveDestinationId(destination);

    if (!place) {
      console.warn('[Airbnb] Destination non trouvée, fallback');
      return generateFallbackAirbnb(destination, checkIn, checkOut, options);
    }

    console.log(`[Airbnb] Place ID: ${place.id} (${place.name})`);

    // Étape 2: Rechercher les propriétés via v2
    console.log(`[Airbnb] Recherche propriétés (${checkIn} → ${checkOut})...`);
    const listings = await searchByPlaceId(place.id, checkIn, checkOut, options);

    if (listings.length === 0) {
      console.warn('[Airbnb] Aucun résultat, fallback');
      return generateFallbackAirbnb(destination, checkIn, checkOut, options);
    }

    console.log(`[Airbnb] ${listings.length} propriétés trouvées`);

    const nights = Math.max(1, Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
    ));

    const accommodations: Accommodation[] = listings
      .slice(0, options.limit || 10)
      .map((item: any) => {
        const listing = item.listing || {};
        const coords = listing.legacyCoordinate || {};
        const pricePerNight = extractPricePerNight(item, nights);
        const { rating, reviewCount } = extractRating(item);
        const photos = extractPhotos(item);
        const listingId = listing.id || '';

        // Le title contient souvent le type : "Flat in Barcelona", "Loft in Barcelona"
        const title = item.title || listing.title || '';
        const isEntireHome = title.toLowerCase().includes('flat') ||
          title.toLowerCase().includes('apartment') ||
          title.toLowerCase().includes('loft') ||
          title.toLowerCase().includes('home') ||
          title.toLowerCase().includes('condo') ||
          title.toLowerCase().includes('house') ||
          listing.legacyPDPType === 'MARKETPLACE';

        return {
          id: `airbnb-${listingId}`,
          name: listing.legacyName || title || `Airbnb à ${destination}`,
          type: isEntireHome ? 'apartment' as const : 'bnb' as const,
          address: listing.legacyCity || destination,
          latitude: coords.latitude || 0,
          longitude: coords.longitude || 0,
          rating,
          reviewCount,
          pricePerNight,
          totalPrice: pricePerNight * nights,
          currency: 'EUR',
          amenities: isEntireHome ? ['Logement entier', 'WiFi'] : ['WiFi'],
          photos,
          checkInTime: '15:00',
          checkOutTime: '11:00',
          bookingUrl: `https://www.airbnb.com/rooms/${listingId}?check_in=${checkIn}&check_out=${checkOut}&adults=${options.guests || 2}`,
          distanceToCenter: undefined,
          breakfastIncluded: false,
          description: listing.legacyName || title || undefined,
        };
      })
      .filter((a: Accommodation) => a.pricePerNight > 0);

    // Si cuisine requise, ne garder que les logements entiers
    let filtered = accommodations;
    if (options.requireKitchen) {
      const entireHomes = accommodations.filter(a => a.type === 'apartment');
      if (entireHomes.length > 0) {
        console.log(`[Airbnb] ✅ ${entireHomes.length} logements entiers (avec cuisine probable)`);
        filtered = entireHomes;
      }
    }

    // Trier par prix croissant pour que les moins chers soient en premier
    filtered.sort((a, b) => a.pricePerNight - b.pricePerNight);

    // Log le range de prix trouvé
    if (filtered.length > 0) {
      console.log(`[Airbnb] Prix: ${filtered[0].pricePerNight}€ - ${filtered[filtered.length - 1].pricePerNight}€/nuit`);
      if (options.maxPricePerNight) {
        const affordable = filtered.filter(a => a.pricePerNight <= options.maxPricePerNight! * 1.5);
        if (affordable.length > 0) {
          console.log(`[Airbnb] ${affordable.length} logements ≤ ${Math.round(options.maxPricePerNight * 1.5)}€/nuit`);
          return affordable;
        }
        console.log(`[Airbnb] Aucun logement ≤ ${options.maxPricePerNight}€, on retourne les moins chers`);
      }
    }

    console.log(`[Airbnb] ✅ ${filtered.length} logements valides`);
    return filtered;
  } catch (error) {
    console.error('[Airbnb] Erreur:', error);
    return generateFallbackAirbnb(destination, checkIn, checkOut, options);
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
function extractPricePerNight(item: any, nights: number): number {
  const sp = item.structuredDisplayPrice || {};
  const expl = sp.explanationData || {};

  // 1. Chercher dans priceDetails le prix par nuit ("4 nights x € 283.23")
  if (expl.priceDetails) {
    for (const group of expl.priceDetails) {
      for (const detail of group.items || []) {
        const desc = detail.description || '';
        const match = desc.match(/(\d+)\s*nights?\s*x\s*[€$£]\s*([\d,.]+)/i);
        if (match) {
          return parseFloat(match[2].replace(',', ''));
        }
      }
    }
  }

  // 2. Extraire du accessibilityLabel ("€ 1,133 for 4 nights")
  const label = sp.primaryLine?.accessibilityLabel || '';
  const totalMatch = label.match(/[€$£]\s*([\d,.]+)/);
  if (totalMatch && nights > 0) {
    return Math.round(parseFloat(totalMatch[1].replace(',', '')) / nights);
  }

  // 3. Extraire du price ("€ 1,133")
  const priceStr = sp.primaryLine?.price || '';
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
function extractRating(item: any): { rating: number; reviewCount: number } {
  const ratingStr = item.avgRatingLocalized || '';
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
function extractPhotos(item: any): string[] {
  const pics = item.contextualPictures || [];
  return pics.slice(0, 5).map((p: any) => p.picture || '').filter(Boolean);
}

/**
 * Fallback: génère un Accommodation "virtuel" avec un lien de recherche Airbnb pré-filtré
 */
function generateFallbackAirbnb(
  destination: string,
  checkIn: string,
  checkOut: string,
  options: AirbnbSearchOptions,
): Accommodation[] {
  const nights = Math.max(1, Math.ceil(
    (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24)
  ));
  const maxPrice = options.maxPricePerNight || 80;
  const guests = options.guests || 2;

  const searchUrl = `https://www.airbnb.com/s/${encodeURIComponent(destination)}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${guests}&price_max=${maxPrice}&room_types%5B%5D=Entire%20home%2Fapt`;

  console.log(`[Airbnb] Fallback: lien de recherche généré`);

  return [{
    id: 'airbnb-search-link',
    name: `Airbnb à ${destination} (rechercher)`,
    type: 'apartment' as const,
    address: destination,
    latitude: 0,
    longitude: 0,
    rating: 8,
    reviewCount: 0,
    pricePerNight: maxPrice,
    totalPrice: maxPrice * nights,
    currency: 'EUR',
    amenities: options.requireKitchen ? ['Logement entier', 'Cuisine équipée', 'WiFi'] : ['WiFi'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    bookingUrl: searchUrl,
    distanceToCenter: undefined,
    breakfastIncluded: false,
    description: `Rechercher un logement entier à ${destination} (max ${maxPrice}€/nuit)`,
  }];
}
