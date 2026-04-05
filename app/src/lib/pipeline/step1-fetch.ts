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
import { searchAttractionsMultiQueryWithFallback, searchMustSeeWithFallback, searchRestaurantsWithFallback } from '../services/serpApiPlaces';
// canUseSerpApi no longer needed — Google Places (New) handles quota automatically
// SerpAPI is only used as fallback via the wrapper functions
import { suggestDayTrips, generateDayTripsWithAI, DAY_TRIP_DATABASE, type DayTripSuggestion } from '../services/dayTripSuggestions';
import { searchAttractionsOverpass } from '../services/overpassAttractions';
import { searchViatorActivities, getViatorProductCoordinates } from '../services/viator';
import { findKnownViatorProduct } from '../services/viatorKnownProducts';
import { searchTripAdvisorRestaurants } from '../services/tripadvisor';
import { searchHotels } from '../services/hotels';
import { searchAirbnbListings } from '../services/airbnb';
import { generateTravelTips } from '../services/travelTips';
import { resolveBudget, generateBudgetStrategy } from '../services/budgetResolver';
import { findBestFlights, selectFlightByBudget } from '../tripFlights';
import { searchGooglePlacesAttractions } from './services/googlePlacesAttractions';
import { getMustSeeAttractions, type Attraction } from '../services/attractions';
import { resolveCoordinates } from '../services/coordsResolver';
import { fetchWeatherForecast } from '../services/weather';
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

function extractViatorProductCode(activity: Attraction): string | null {
  if (activity.id?.startsWith('viator-')) return activity.id.replace(/^viator-/, '').trim() || null;
  const booking = activity.bookingUrl || '';
  const match = booking.match(/\/d\d+-([A-Za-z0-9]+)/);
  return match?.[1] || null;
}

function buildViatorLocationCandidates(activityName: string, destination: string): string[] {
  const clean = activityName
    .replace(/\s+/g, ' ')
    .replace(/[|•]/g, ' ')
    .replace(/\b(private|privée?|guided|visite guidée|skip[-\s]?the[-\s]?line|with artist|life style)\b/gi, '')
    .trim();

  const candidates = new Set<string>();
  candidates.add(`${clean}, ${destination}`);

  // Try to extract landmark after common French connectors.
  const landmarkMatch = clean.match(/\b(?:à|au|aux|du|de la|de l'|des)\s+(.+)$/i);
  if (landmarkMatch?.[1]) {
    candidates.add(`${landmarkMatch[1].trim()}, ${destination}`);
  }

  return Array.from(candidates).filter(Boolean);
}

/**
 * Fetch all external data in parallel.
 * Two phases: coords first (needed by other calls), then everything else.
 */
import type { OnPipelineEvent } from './types';

export async function fetchAllData(preferences: TripPreferences, onEvent?: OnPipelineEvent, destinationIntel?: import('./step0-destination-intel').DestinationIntel | null): Promise<FetchedData> {
  const T0 = Date.now();
  const { origin, destination } = preferences;

  /** Wrapper to emit api_call/api_done events around a promise */
  function tracked<T>(label: string, promise: Promise<T>): Promise<T> {
    const t0 = Date.now();
    onEvent?.({ type: 'api_call', step: 1, label, timestamp: t0 });
    return promise.then(
      (result) => {
        onEvent?.({ type: 'api_done', step: 1, label, durationMs: Date.now() - t0, timestamp: Date.now() });
        return result;
      },
      (err) => {
        onEvent?.({ type: 'api_done', step: 1, label, durationMs: Date.now() - t0, detail: `ERROR: ${err?.message || err}`, timestamp: Date.now() });
        throw err;
      }
    );
  }

  // Phase 0: Geocoding (needed by subsequent calls)
  onEvent?.({ type: 'api_call', step: 1, label: 'Geocoding', timestamp: Date.now() });
  const [originCoords, destCoords, originAirports, destAirports] = await Promise.all([
    getCityCenterCoordsAsync(origin).then(c => {
      if (!c) throw new Error(`[Pipeline] Geocoding failed for origin: ${origin}. Cannot proceed without valid coordinates.`);
      return c;
    }),
    getCityCenterCoordsAsync(destination).then(c => {
      if (!c) throw new Error(`[Pipeline] Geocoding failed for destination: ${destination}. Cannot proceed without valid coordinates.`);
      return c;
    }),
    findNearbyAirportsAsync(origin),
    findNearbyAirportsAsync(destination),
  ]);

  console.log(`[Pipeline V2] Phase 0: Coords resolved in ${Date.now() - T0}ms`);
  onEvent?.({ type: 'api_done', step: 1, label: 'Geocoding', durationMs: Date.now() - T0, timestamp: Date.now() });

  // Pre-compute dates
  const resolvedBudget = resolveBudget(preferences);
  const startDate = new Date(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);

  const activityTypes = preferences.activities || [];

  // Phase 0b: Day-trip suggestions (curated DB + AI fallback)
  let dayTripSuggestions: DayTripSuggestion[] = [];
  if (preferences.durationDays >= 3) {
    dayTripSuggestions = suggestDayTrips(destination, destCoords, {
      durationDays: preferences.durationDays,
      groupType: preferences.groupType,
      budgetLevel: preferences.budgetLevel,
      preferredActivities: activityTypes,
      startDate,
      prePurchasedTickets: preferences.prePurchasedTickets,
    });

    // AI fallback for uncovered destinations
    if (dayTripSuggestions.length === 0 && preferences.durationDays >= 4) {
      try {
        const aiSuggestions = await generateDayTripsWithAI(destination, destCoords, {
          durationDays: preferences.durationDays,
          groupType: preferences.groupType,
          budgetLevel: preferences.budgetLevel,
          preferredActivities: activityTypes.map(String),
        });
        dayTripSuggestions = aiSuggestions;
        if (aiSuggestions.length > 0) {
          console.log(`[Pipeline V2] Phase 0b: AI generated ${aiSuggestions.length} day trip suggestions`);
        }
      } catch (e) {
        console.warn('[Pipeline V2] AI day trip generation failed:', e instanceof Error ? e.message : e);
      }
    }

    // Force day trip suggestions that match user must-sees (even if not top-scored)
    const mustSeeStr = preferences.mustSee || '';
    if (mustSeeStr) {
      const mustSeeNames = mustSeeStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const normalizedDest = destination.toLowerCase().trim();
      const allDestMatches = DAY_TRIP_DATABASE.filter(t =>
        normalizedDest.includes(t.fromCity) || t.fromCity.includes(normalizedDest)
      );
      for (const ms of mustSeeNames) {
        const alreadyIncluded = dayTripSuggestions.some(s =>
          s.name.toLowerCase().includes(ms) || s.destination.toLowerCase().includes(ms) ||
          s.keyAttractions.some(k => k.toLowerCase().includes(ms))
        );
        if (alreadyIncluded) continue;

        const match = allDestMatches.find(t =>
          t.name.toLowerCase().includes(ms) || t.destination.toLowerCase().includes(ms) ||
          t.keyAttractions.some(k => k.toLowerCase().includes(ms))
        );
        if (match) {
          dayTripSuggestions.push(match);
          console.log(`[Pipeline V2] Phase 0b: forced day trip "${match.name}" — matches must-see "${ms}"`);
        }
      }
    }

    if (dayTripSuggestions.length > 0) {
      console.log(`[Pipeline V2] Phase 0b: ${dayTripSuggestions.length} day trip(s) suggested: ${dayTripSuggestions.map(d => d.name).join(', ')}`);
    }
  }

  // Phase 1: Everything in parallel (tracked for monitoring)
  const results = await Promise.allSettled([
    // 0: Google Places (New) → SerpAPI fallback — attractions with GPS + rating (with retry)
    // Legacy Google Places search removed — New API returns same data (saves ~€0.16/trip)
    tracked('Places attractions', withRetry(() => searchAttractionsMultiQueryWithFallback(destination, destCoords, {
          types: activityTypes,
          limit: 40,
        }))),
    // 2: Overpass — free OSM POIs
    tracked('OpenStreetMap', searchAttractionsOverpass(destination, destCoords)),
    // 3: Viator — bookable experiences
    tracked('Viator', searchViatorActivities(destination, destCoords, {
      types: activityTypes,
      limit: 20,
    })),
    // 4: Must-see attractions (user-specified) — Google Places (New) → SerpAPI fallback
    tracked('Must-sees', preferences.mustSee?.trim()
      ? searchMustSeeWithFallback(preferences.mustSee, destination, destCoords)
      : Promise.resolve([])),
    // 5: TripAdvisor removed — SerpAPI covers restaurant data (saves $8/month)
    tracked('TripAdvisor (skipped)', Promise.resolve([])),
    // 6: Google Places (New) → SerpAPI fallback — restaurants with GPS
    tracked('Places restaurants', searchRestaurantsWithFallback(destination, {
          latitude: destCoords.lat,
          longitude: destCoords.lng,
          limit: 20,
        })),
    // 7: Booking.com hotels
    tracked('Booking.com', searchHotels(destination, {
      budgetLevel: preferences.budgetLevel,
      cityCenter: destCoords,
      checkInDate: startDate,
      checkOutDate: endDate,
      guests: preferences.groupSize || 2,
    })),
    // 8: Transport comparison
    tracked('Transport routes', compareTransportOptions({
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
    })),
    // 9: Travel tips
    tracked('Travel tips', generateTravelTips(origin, destination, startDate, preferences.durationDays)),
    // 10: Budget strategy
    tracked('Budget strategy', generateBudgetStrategy(
      resolvedBudget,
      destination,
      preferences.durationDays,
      preferences.groupSize || 1,
      activityTypes,
      preferences.mealPreference,
    )),
    // 11: Weather forecast (Open-Meteo, free, no key)
    tracked('Weather forecast', fetchWeatherForecast(destCoords, startDate, preferences.durationDays)),
    // 12: Airbnb listings (apartments/bnb alternative to hotels)
    tracked('Airbnb', searchAirbnbListings(destination, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10), {
      guests: preferences.groupSize || 2,
      maxPricePerNight: typeof resolvedBudget === 'number' && resolvedBudget > 0 ? Math.round(resolvedBudget / (preferences.durationDays || 3) * 0.4) : undefined,
      limit: 15,
      cityCenter: destCoords,
    })),
  ]);

  // Extract results safely (fulfilled or empty array)
  const extract = <T>(idx: number, fallback: T): T => {
    const r = results[idx];
    if (r.status === 'fulfilled') return r.value as T;
    console.warn(`[Pipeline V2] Step 1 promise #${idx} failed:`, (r as PromiseRejectedResult).reason?.message || r);
    return fallback;
  };

  const googlePlacesAttractions: Attraction[] = []; // Legacy search removed (cost optimization)
  const serpApiAttractions = extract(0, []);
  const overpassAttractions = extract(1, []);
  const viatorActivities = extract(2, []);
  const mustSeeAttractions: Attraction[] = extract(3, [] as Attraction[]);
  const tripAdvisorRestaurants = extract(4, []);
  const serpApiRestaurants = extract(5, []);
  const bookingHotels = extract(6, []);
  const transportOptions = extract(7, []);
  const travelTips = extract(8, null);
  const budgetStrategy = extract(9, null as any);
  const weatherForecasts = extract(10, []);
  const airbnbListings: import('../types').Accommodation[] = extract(11, []);

  // Place Details enrichment removed — Google Places (New) already returns
  // regularOpeningHours in field mask (saves ~€0.10/trip, 20 API calls)

  // ── Resolve GPS for Viator activities (they default to city-center coords) ──
  const viatorEstimated = viatorActivities.filter(
    (a: Attraction) =>
      a.dataReliability === 'estimated' &&
      !(a.qualityFlags || []).includes('viator_low_plus_value')
  );
  if (viatorEstimated.length > 0) {
    console.log(`[Pipeline V2] Resolving GPS for ${viatorEstimated.length} Viator activities...`);
    const productCoordsCache = new Map<string, { lat: number; lng: number } | null>();

    await Promise.allSettled(
      viatorEstimated.map(async (activity: Attraction) => {
        try {
          // 1) Try Viator product details first (true source coordinates when available).
          const productCode = extractViatorProductCode(activity);
          if (productCode) {
            let viatorCoords = productCoordsCache.get(productCode);
            if (viatorCoords === undefined) {
              viatorCoords = await getViatorProductCoordinates(productCode, destCoords);
              productCoordsCache.set(productCode, viatorCoords);
            }
            if (viatorCoords) {
              activity.latitude = viatorCoords.lat;
              activity.longitude = viatorCoords.lng;
              activity.dataReliability = 'verified';
              activity.geoSource = 'place';
              activity.geoConfidence = 'high';
              activity.qualityFlags = (activity.qualityFlags || []).filter((flag) => flag !== 'viator_city_center_fallback');
              return;
            }
          }

          // 2) Known curated coordinates (local dictionary).
          const knownViatorProduct = findKnownViatorProduct(activity.name);
          if (knownViatorProduct?.lat && knownViatorProduct?.lng) {
            activity.latitude = knownViatorProduct.lat;
            activity.longitude = knownViatorProduct.lng;
            activity.dataReliability = 'verified';
            activity.geoSource = 'known_product';
            activity.geoConfidence = 'high';
            activity.qualityFlags = (activity.qualityFlags || []).filter((flag) => flag !== 'viator_city_center_fallback');
            return;
          }

          // 3) Fallback geocoding from a cleaned candidate query.
          // Important: keep SerpAPI geocoding disabled for Viator fallback to avoid expensive
          // per-activity paid requests when product/location coordinates are unavailable.
          const candidates = buildViatorLocationCandidates(activity.name, destination);
          const fallbackCandidate = candidates[0];
          if (fallbackCandidate) {
            const coords = await resolveCoordinates(
              fallbackCandidate,
              destination,
              destCoords,
              'attraction'
            );
            if (coords) {
              activity.latitude = coords.lat;
              activity.longitude = coords.lng;
              // Fallback geocoding improves map placement but is less reliable than Viator product coordinates.
              if (activity.dataReliability !== 'verified') {
                activity.dataReliability = 'estimated';
              }
              activity.geoSource = 'geocode';
              activity.geoConfidence = 'medium';
              activity.qualityFlags = (activity.qualityFlags || []).filter((flag) => flag !== 'viator_city_center_fallback');
              return;
            }
          }
        } catch {
          // keep city-center fallback
        }

        activity.geoSource = 'city_fallback';
        activity.geoConfidence = 'low';
        activity.qualityFlags = Array.from(new Set([...(activity.qualityFlags || []), 'viator_city_center_fallback']));
      })
    );
    const verified = viatorEstimated.filter((a: Attraction) => a.dataReliability === 'verified').length;
    console.log(`[Pipeline V2] Resolved precise Viator GPS for ${verified}/${viatorEstimated.length} activities`);
  }

  // ── Fetch activities and restaurants for each day trip ──────────────────────
  const dayTripActivities: Record<string, Attraction[]> = {};
  const dayTripRestaurants: Record<string, import('../types').Restaurant[]> = {};

  if (dayTripSuggestions.length > 0) {
    console.log(`[Pipeline V2] Fetching data for ${dayTripSuggestions.length} day trip destination(s)...`);
    const dayTripFetches = dayTripSuggestions.map(async (dt) => {
      const dtCoords = { lat: dt.latitude, lng: dt.longitude };
      const dtName = dt.destination || dt.name;
      try {
        const [acts, restos] = await Promise.allSettled([
          searchGooglePlacesAttractions(dtName, dtCoords),
          searchRestaurantsWithFallback(dtName, {
                latitude: dtCoords.lat,
                longitude: dtCoords.lng,
                limit: 8,
              }),
        ]);

        const activities = acts.status === 'fulfilled' ? acts.value.slice(0, 10) : [];
        const restaurants = restos.status === 'fulfilled' ? restos.value.slice(0, 8) : [];

        // Tag activities with day trip destination
        for (const a of activities) {
          (a as any).dayTripDestination = dtName;
        }

        dayTripActivities[dtName] = activities;
        dayTripRestaurants[dtName] = restaurants;

        console.log(`[Pipeline V2] Day trip "${dtName}": ${activities.length} activities, ${restaurants.length} restaurants`);
      } catch (e) {
        console.warn(`[Pipeline V2] Day trip "${dtName}" fetch failed:`, e instanceof Error ? e.message : e);
        dayTripActivities[dtName] = [];
        dayTripRestaurants[dtName] = [];
      }
    });
    await Promise.allSettled(dayTripFetches);
  }

  // ── Inject curated must-sees from hardcoded database ──────────────────────
  // When the user hasn't specified explicit must-see attractions, use our curated
  // database (attractions.ts) to inject iconic landmarks (Colisée, Vatican, etc.)
  // Even when the user HAS specified some, merge in curated ones they didn't mention.
  const curatedMustSees = getMustSeeAttractions(destination);
  if (curatedMustSees.length > 0) {
    // Normalize for accent-insensitive, fuzzy matching (not just exact name)
    // This prevents "Maison Anne Frank" (curated) duplicating "Maison d'Anne Frank" (fetched)
    const normalizeFuzzy = (name: string) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const existingNormalized = mustSeeAttractions.map((a: any) => normalizeFuzzy(a.name));
    let injectedCount = 0;
    for (const curated of curatedMustSees) {
      const curatedNorm = normalizeFuzzy(curated.name);
      // Check exact normalized match OR substring match (one contains the other)
      const isDuplicate = existingNormalized.some(existingNorm =>
        existingNorm === curatedNorm || existingNorm.includes(curatedNorm) || curatedNorm.includes(existingNorm)
      );
      if (!isDuplicate) {
        mustSeeAttractions.push(curated);
        existingNormalized.push(curatedNorm);
        injectedCount++;
      }
    }
    if (injectedCount > 0) {
      console.log(`[Pipeline V2] Injected ${injectedCount} curated must-see attractions for "${destination}" from local database`);
      console.log(`[Pipeline V2]   → ${curatedMustSees.map(a => a.name).join(', ')}`);
    }
  }

  // ── Step 0 Intelligence: inject LLM-curated must-sees ──────────────────
  // When destination intel is available (cache or LLM), merge its must-see attractions
  // into the pool. These are expert-curated and should always be present.
  if (destinationIntel?.mustSeeAttractions?.length) {
    const normalizeFuzzy = (name: string) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const existingNormalized = mustSeeAttractions.map((a: any) => normalizeFuzzy(a.name));
    let intelInjected = 0;
    for (const intel of destinationIntel.mustSeeAttractions) {
      const intelNorm = normalizeFuzzy(intel.name);
      const isDuplicate = existingNormalized.some(n => n === intelNorm || n.includes(intelNorm) || intelNorm.includes(n));
      if (!isDuplicate) {
        mustSeeAttractions.push({
          id: `intel-${intelNorm.substring(0, 20)}`,
          name: intel.name,
          type: intel.type as any,
          description: intel.whyImportant,
          mustSee: true,
          latitude: 0,
          longitude: 0,
          duration: intel.estimatedDuration,
          estimatedCost: 0,
          rating: 4.5,
          bookingRequired: false,
          openingHours: { open: '09:00', close: '18:00' },
        });
        existingNormalized.push(intelNorm);
        intelInjected++;
      }
    }
    if (intelInjected > 0) {
      console.log(`[Pipeline V2] Step 0 Intel: injected ${intelInjected} must-sees for "${destination}"`);
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
  const selectedTransportMode = (bestTransport as any)?.mode || preferences.transport;
  const shouldSearchFlights = selectedTransportMode === 'plane'
    || preferences.transport === 'plane'
    || transportOptions.some((t: any) => t.mode === 'plane');
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
  console.log(`[Pipeline V2]   Activities: ${googlePlacesAttractions.length} Google + ${serpApiAttractions.length} Places/SerpAPI + ${overpassAttractions.length} Overpass + ${viatorActivities.length} Viator`);
  console.log(`[Pipeline V2]   Restaurants: ${tripAdvisorRestaurants.length} TA + ${serpApiRestaurants.length} Places/SerpAPI`);
  // Merge Airbnb listings into hotel pool
  const allAccommodations = [...bookingHotels, ...airbnbListings];
  console.log(`[Pipeline V2]   Hotels: ${bookingHotels.length} Booking + ${airbnbListings.length} Airbnb | Transport options: ${transportOptions.length}`);

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
    bookingHotels: allAccommodations,
    transportOptions,
    outboundFlight,
    returnFlight,
    flightAlternatives,
    weatherForecasts,
    dayTripSuggestions,
    dayTripActivities,
    dayTripRestaurants,
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
      model: 'claude-haiku-4-5',
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
  const jsonStr = text.trim();
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
