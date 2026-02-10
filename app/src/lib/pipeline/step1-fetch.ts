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
