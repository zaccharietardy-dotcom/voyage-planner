/**
 * Pipeline V2 — Step 1: Parallel Data Fetch
 *
 * All API calls happen in a single Promise.all.
 * No serial chains, no sequential dependencies.
 */

import type { TripPreferences } from '../types';
import type { FetchedData } from './types';

import { getCityCenterCoordsAsync, findNearbyAirportsAsync } from '../services/geocoding';
import { compareTransportOptions } from '../services/transport';
import { searchAttractionsMultiQuery, searchMustSeeAttractions, searchRestaurantsWithSerpApi } from '../services/serpApiPlaces';
import { searchAttractionsOverpass } from '../services/overpassAttractions';
import { searchViatorActivities } from '../services/viator';
import { searchTripAdvisorRestaurants } from '../services/tripadvisor';
import { searchHotels } from '../services/hotels';
import { generateTravelTips } from '../services/travelTips';
import { resolveBudget, generateBudgetStrategy } from '../services/budgetResolver';
import { findBestFlights, selectFlightByBudget } from '../tripFlights';
import { searchGooglePlacesAttractions } from './services/googlePlacesAttractions';
import { getMustSeeAttractions, type Attraction } from '../services/attractions';
import { resolveCoordinates } from '../services/coordsResolver';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Retry wrapper: retries a promise factory once with a delay on rejection.
 * Used for critical API calls (Google Places, SerpAPI) that occasionally timeout.
 */
async function withRetry<T>(
  promiseFactory: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 3000
): Promise<T> {
  try {
    return await promiseFactory();
  } catch (error) {
    if (retries <= 0) throw error;
    console.warn(`[Pipeline V2] Retrying after ${delayMs}ms...`, error instanceof Error ? error.message : error);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return withRetry(promiseFactory, retries - 1, delayMs);
  }
}

/**
 * Fetch all external data in parallel.
 * Two phases: coords first (needed by other calls), then everything else.
 */
export async function fetchAllData(preferences: TripPreferences): Promise<FetchedData> {
  const T0 = Date.now();
  const { origin, destination } = preferences;

  // Phase 0: Geocoding (needed by subsequent calls)
  const [originCoords, destCoords, originAirports, destAirports] = await Promise.all([
    getCityCenterCoordsAsync(origin).then(c => c || { lat: 48.8566, lng: 2.3522 }),
    getCityCenterCoordsAsync(destination).then(c => c || { lat: 48.8566, lng: 2.3522 }),
    findNearbyAirportsAsync(origin),
    findNearbyAirportsAsync(destination),
  ]);

  console.log(`[Pipeline V2] Phase 0: Coords resolved in ${Date.now() - T0}ms`);

  // Pre-compute dates
  const resolvedBudget = resolveBudget(preferences);
  const startDate = new Date(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);

  const activityTypes = preferences.activities || [];

  // Phase 1: Everything in parallel
  const results = await Promise.allSettled([
    // 0: Google Places Text Search — attractions with popularity (with retry)
    withRetry(() => searchGooglePlacesAttractions(destination, destCoords)),
    // 1: SerpAPI — attractions with GPS + rating (with retry)
    withRetry(() => searchAttractionsMultiQuery(destination, destCoords, {
      types: activityTypes,
      limit: 40,
    })),
    // 2: Overpass — free OSM POIs
    searchAttractionsOverpass(destination, destCoords),
    // 3: Viator — bookable experiences
    searchViatorActivities(destination, destCoords, {
      types: activityTypes,
      limit: 20,
    }),
    // 4: Must-see attractions (user-specified)
    preferences.mustSee?.trim()
      ? searchMustSeeAttractions(preferences.mustSee, destination, destCoords)
      : Promise.resolve([]),
    // 5: TripAdvisor restaurants
    searchTripAdvisorRestaurants(destination, { limit: 30 }),
    // 6: SerpAPI restaurants (for GPS)
    searchRestaurantsWithSerpApi(destination, {
      latitude: destCoords.lat,
      longitude: destCoords.lng,
      limit: 20,
    }),
    // 7: Booking.com hotels
    searchHotels(destination, {
      budgetLevel: preferences.budgetLevel,
      cityCenter: destCoords,
      checkInDate: startDate,
      checkOutDate: endDate,
      guests: preferences.groupSize || 2,
    }),
    // 8: Transport comparison
    compareTransportOptions({
      origin,
      destination,
      originCoords,
      destCoords,
      date: startDate,
      returnDate: endDate,
      passengers: preferences.groupSize || 1,
      preferences: {
        prioritize: 'balanced',
        forceIncludeMode: preferences.transport as any,
      },
    }),
    // 9: Travel tips
    generateTravelTips(origin, destination, startDate, preferences.durationDays),
    // 10: Budget strategy
    generateBudgetStrategy(
      resolvedBudget,
      destination,
      preferences.durationDays,
      preferences.groupSize || 1,
      activityTypes,
      preferences.mealPreference,
    ),
  ]);

  // Extract results safely (fulfilled or empty array)
  const extract = <T>(idx: number, fallback: T): T => {
    const r = results[idx];
    if (r.status === 'fulfilled') return r.value as T;
    console.warn(`[Pipeline V2] Step 1 promise #${idx} failed:`, (r as PromiseRejectedResult).reason?.message || r);
    return fallback;
  };

  const googlePlacesAttractions = extract(0, []);
  const serpApiAttractions = extract(1, []);
  const overpassAttractions = extract(2, []);
  const viatorActivities = extract(3, []);
  let mustSeeAttractions: Attraction[] = extract(4, [] as Attraction[]);
  const tripAdvisorRestaurants = extract(5, []);
  const serpApiRestaurants = extract(6, []);
  const bookingHotels = extract(7, []);
  const transportOptions = extract(8, []);
  const travelTips = extract(9, null);
  const budgetStrategy = extract(10, null as any);

  // ── Resolve GPS for Viator activities (they default to city-center coords) ──
  const viatorEstimated = viatorActivities.filter(
    (a: Attraction) => a.dataReliability === 'estimated'
  );
  if (viatorEstimated.length > 0) {
    console.log(`[Pipeline V2] Resolving GPS for ${viatorEstimated.length} Viator activities...`);
    await Promise.allSettled(
      viatorEstimated.map(async (activity: Attraction) => {
        try {
          const coords = await resolveCoordinates(
            activity.name, destination, destCoords, 'attraction'
          );
          if (coords) {
            activity.latitude = coords.lat;
            activity.longitude = coords.lng;
            activity.dataReliability = 'verified';
          }
        } catch { /* keep city-center as fallback */ }
      })
    );
    const resolved = viatorEstimated.filter((a: Attraction) => a.dataReliability === 'verified').length;
    console.log(`[Pipeline V2] Resolved GPS for ${resolved}/${viatorEstimated.length} Viator activities`);
  }

  // ── Inject curated must-sees from hardcoded database ──────────────────────
  // When the user hasn't specified explicit must-see attractions, use our curated
  // database (attractions.ts) to inject iconic landmarks (Colisée, Vatican, etc.)
  // Even when the user HAS specified some, merge in curated ones they didn't mention.
  const curatedMustSees = getMustSeeAttractions(destination);
  if (curatedMustSees.length > 0) {
    const existingNames = new Set(mustSeeAttractions.map((a: any) => a.name.toLowerCase()));
    let injectedCount = 0;
    for (const curated of curatedMustSees) {
      if (!existingNames.has(curated.name.toLowerCase())) {
        mustSeeAttractions.push(curated);
        existingNames.add(curated.name.toLowerCase());
        injectedCount++;
      }
    }
    if (injectedCount > 0) {
      console.log(`[Pipeline V2] Injected ${injectedCount} curated must-see attractions for "${destination}" from local database`);
      console.log(`[Pipeline V2]   → ${curatedMustSees.map(a => a.name).join(', ')}`);
    }
  }

  // ── AI fallback: generate must-sees for uncovered destinations ──────────
  // When the local database has no curated must-sees AND the user didn't specify any,
  // use Claude Haiku for NAMES + resolveCoordinates for verified GPS.
  if (curatedMustSees.length === 0 && mustSeeAttractions.length === 0) {
    console.log(`[Pipeline V2] No curated must-sees for "${destination}" — generating via AI...`);
    try {
      const aiMustSees = await generateMustSeesWithAI(destination, destCoords);
      if (aiMustSees.length > 0) {
        mustSeeAttractions.push(...aiMustSees);
        console.log(`[Pipeline V2] AI generated ${aiMustSees.length} must-sees: ${aiMustSees.map(a => a.name).join(', ')}`);
      }
    } catch (e) {
      console.warn(`[Pipeline V2] AI must-see generation failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Phase 2: Flights (depends on transport selection)
  // Wrapped with a 20s timeout to prevent slow flight APIs from blocking the pipeline
  let outboundFlight = null;
  let returnFlight = null;
  let flightAlternatives = { outbound: [] as any[], return: [] as any[] };

  const bestTransport = transportOptions.find((t: any) => t.recommended) || transportOptions[0];
  const shouldSearchFlights = (bestTransport as any)?.mode === 'plane'
    || preferences.transport === 'plane'
    || preferences.transport === 'optimal'; // optimal often means plane for long distances
  if (shouldSearchFlights) {
    const FLIGHT_TIMEOUT = 20_000; // 20s max for flight search
    const T_FLIGHTS = Date.now();
    try {
      const flightResult = await Promise.race([
        findBestFlights(
          originAirports, destAirports, startDate, endDate,
          preferences, originCoords, destCoords
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Flight search timeout (${FLIGHT_TIMEOUT / 1000}s)`)), FLIGHT_TIMEOUT)
        ),
      ]);
      outboundFlight = flightResult.outboundFlight;
      returnFlight = flightResult.returnFlight;
      flightAlternatives = {
        outbound: flightResult.outboundFlightAlternatives || [],
        return: flightResult.returnFlightAlternatives || [],
      };
      console.log(`[Pipeline V2] Flights found in ${Date.now() - T_FLIGHTS}ms`);
    } catch (e) {
      console.warn(`[Pipeline V2] Flight search failed (${Date.now() - T_FLIGHTS}ms):`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`[Pipeline V2] Step 1: All data fetched in ${Date.now() - T0}ms`);
  console.log(`[Pipeline V2]   Activities: ${googlePlacesAttractions.length} Google + ${serpApiAttractions.length} SerpAPI + ${overpassAttractions.length} Overpass + ${viatorActivities.length} Viator`);
  console.log(`[Pipeline V2]   Restaurants: ${tripAdvisorRestaurants.length} TA + ${serpApiRestaurants.length} SerpAPI`);
  console.log(`[Pipeline V2]   Hotels: ${bookingHotels.length} | Transport options: ${transportOptions.length}`);

  return {
    destCoords,
    originCoords,
    originAirports,
    destAirports,
    googlePlacesAttractions,
    serpApiAttractions,
    overpassAttractions,
    viatorActivities,
    mustSeeAttractions,
    tripAdvisorRestaurants,
    serpApiRestaurants,
    bookingHotels,
    transportOptions,
    outboundFlight,
    returnFlight,
    flightAlternatives,
    travelTips,
    budgetStrategy,
    resolvedBudget,
  };
}

/**
 * Generate must-see attractions via Claude Haiku (names only) + resolveCoordinates (verified GPS).
 * Used for destinations not in the hardcoded attractions database.
 *
 * Phase 1: Haiku generates attraction names + metadata (reliable for well-known landmarks)
 * Phase 2: resolveCoordinates() verifies GPS via Travel Places → Nominatim → Gemini → SerpAPI
 *          If GPS resolution fails for an item, it's dropped (never use hallucinated coords)
 */
async function generateMustSeesWithAI(
  destination: string,
  destCoords: { lat: number; lng: number }
): Promise<Attraction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  // Phase 1: Get attraction names + metadata from Haiku (fast, cheap)
  const response = await Promise.race([
    client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Liste les 5-8 attractions absolument incontournables de ${destination}.

Retourne UNIQUEMENT un JSON array. Chaque item :
{
  "name": "Nom officiel du lieu",
  "type": "culture|nature|gastronomy|shopping|nightlife|adventure|wellness|beach",
  "description": "1 phrase descriptive",
  "duration": nombre de minutes (60-180),
  "estimatedCost": euros par personne (0 si gratuit),
  "rating": note sur 5
}

Règles : UNIQUEMENT des lieux réels, célèbres et vérifiables. Inclure les landmarks les plus iconiques que tout touriste doit visiter.`,
      }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI must-see timeout (10s)')), 10000)
    ),
  ]);

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  // Parse JSON from response
  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('[Pipeline V2] AI must-see: no JSON array found in response');
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const items = Array.isArray(parsed) ? parsed : [];

  // Phase 2: Resolve GPS coordinates via verified APIs (never trust Haiku GPS)
  const attractions: Attraction[] = [];
  const resolvePromises = items.map(async (a: any, i: number) => {
    const name = a.name?.trim();
    if (!name) return null;

    const coords = await resolveCoordinates(name, destination, destCoords, 'attraction');
    if (!coords) {
      console.warn(`[Pipeline V2] AI must-see: GPS resolution failed for "${name}", skipping`);
      return null;
    }

    return {
      id: `ai-mustsee-${destination.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${i}`,
      name,
      type: a.type || 'culture',
      description: a.description || '',
      duration: Math.max(30, Math.min(240, a.duration || 90)),
      estimatedCost: Math.max(0, a.estimatedCost || 0),
      latitude: coords.lat,
      longitude: coords.lng,
      rating: Math.max(1, Math.min(5, a.rating || 4.5)),
      mustSee: true,
      bookingRequired: false,
      openingHours: { open: '09:00', close: '18:00' },
      dataReliability: 'generated' as const,
    } as Attraction;
  });

  const results = await Promise.allSettled(resolvePromises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      attractions.push(r.value);
    }
  }

  return attractions;
}
