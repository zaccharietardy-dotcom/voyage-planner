/**
 * Pipeline V2 — Step 7: Schedule Assembly
 *
 * Converts balanced clusters + restaurants + transport into a fully-slotted Trip.
 * Uses the existing DayScheduler for time slot management.
 */

import type { Trip, TripDay, TripItem, TripPreferences, Flight, Accommodation, TransportOptionSummary, Restaurant } from '../types';
import type { FetchedData, ActivityCluster, MealAssignment, BalancedPlan, ScoredActivity } from './types';
import { DayScheduler, parseTime } from '../services/scheduler';
import type { ScheduleItem } from '../services/scheduler';
import { calculateDistance } from '../services/geocoding';
import { getDirections } from '../services/directions';
import { fetchPlaceImage, fetchRestaurantPhotoByPlaceId } from './services/wikimediaImages';
import type { OnPipelineEvent } from './types';
import { isAppropriateForMeal, getCuisineFamily, isBreakfastSpecialized } from './step4-restaurants';
import { searchRestaurantsNearby } from '../services/serpApiPlaces';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { normalizeHotelBookingUrl } from '../services/bookingLinks';
import { sanitizeApiKeyLeaksInString, sanitizeGoogleMapsUrl } from '../services/googlePlacePhoto';
import { dedupeActivitiesBySimilarity, isDuplicateActivityCandidate } from './utils/activityDedup';
// ---------------------------------------------------------------------------
// Directions cache — used to store pre-fetched real travel times
// ---------------------------------------------------------------------------
type DirectionsCache = Map<string, { duration: number; distance: number }>;

function directionsCacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  return `${fromLat.toFixed(5)},${fromLng.toFixed(5)}→${toLat.toFixed(5)},${toLng.toFixed(5)}`;
}

// Simple UUID generator (avoids external dependency)
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const MODE_LABELS: Record<string, string> = {
  train: '🚄 Train', bus: '🚌 Bus', car: '🚗 Voiture',
  combined: '🔄 Transport', ferry: '⛴️ Ferry',
};

/** Static images for transport types (Unsplash free-to-use) */
const TRANSPORT_IMAGES: Record<string, string> = {
  flight: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
  train: '/images/transport/train-sncf-duplex.jpg',
  bus: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=600&h=400&fit=crop',
  ferry: 'https://images.unsplash.com/photo-1534008897995-27a23e859048?w=600&h=400&fit=crop',
  car: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=600&h=400&fit=crop',
  combined: '/images/transport/train-sncf-duplex.jpg',
  walking: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=600&h=400&fit=crop',
  transit: '/images/transport/train-sncf-duplex.jpg',
};

const PIPELINE_MEDIA_PROXY = !['0', 'false', 'off'].includes(
  String(process.env.PIPELINE_MEDIA_PROXY || 'true').toLowerCase()
);

function normalizeTransportMode(rawMode?: string): TripItem['transportMode'] | undefined {
  if (!rawMode) return undefined;
  const mode = rawMode.toLowerCase();
  if (mode === 'train' || mode === 'bus' || mode === 'car' || mode === 'ferry') return mode;
  if (mode === 'walk' || mode === 'walking') return 'walking';
  if (mode === 'taxi' || mode === 'driving') return 'car';
  if (mode === 'public' || mode === 'metro' || mode === 'tram' || mode === 'subway' || mode === 'combined' || mode === 'transit') return 'transit';
  return undefined;
}

function dominantTransitLegMode(transitLegs?: TripItem['transitLegs']): TripItem['transportMode'] | undefined {
  if (!transitLegs || transitLegs.length === 0) return undefined;
  const weightedDurations = new Map<string, number>();
  for (const leg of transitLegs) {
    const mode = normalizeTransportMode(leg.mode);
    if (!mode) continue;
    const duration = Number.isFinite(leg.duration) ? leg.duration : 1;
    weightedDurations.set(mode, (weightedDurations.get(mode) || 0) + Math.max(1, duration));
  }
  if (weightedDurations.size === 0) return undefined;
  return [...weightedDurations.entries()].sort((a, b) => b[1] - a[1])[0][0] as TripItem['transportMode'];
}

export function getTransportModeFromItemData(itemData: any): TripItem['transportMode'] | undefined {
  const explicit = normalizeTransportMode(itemData?.transportMode) || normalizeTransportMode(itemData?.mode);
  if (explicit) return explicit;
  const fromLegs = dominantTransitLegMode(itemData?.transitLegs);
  if (fromLegs) return fromLegs;

  const title = String(itemData?.title || '').toLowerCase();
  if (title.includes('train')) return 'train';
  if (title.includes('bus')) return 'bus';
  if (title.includes('ferry')) return 'ferry';
  if (title.includes('car') || title.includes('voiture')) return 'car';
  return undefined;
}

function getTransportImage(itemData: any): string {
  const mode = getTransportModeFromItemData(itemData);
  if (mode && TRANSPORT_IMAGES[mode]) return TRANSPORT_IMAGES[mode];
  return TRANSPORT_IMAGES.train;
}

function normalizeRestaurantGooglePhotoUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const sanitized = sanitizeApiKeyLeaksInString(sanitizeGoogleMapsUrl(raw));
  if (sanitized.startsWith('/api/place-photo?')) return sanitized;
  if (sanitized.includes('maps.googleapis.com/maps/api/place/photo')) {
    return sanitizeGoogleMapsUrl(sanitized);
  }
  return undefined;
}

function extractGoogleRestaurantPhotos(restaurant?: Partial<Restaurant>): string[] {
  const photos = Array.isArray(restaurant?.photos) ? restaurant.photos : [];
  const normalized = photos
    .map((photo) => normalizeRestaurantGooglePhotoUrl(photo))
    .filter((photo): photo is string => Boolean(photo));
  return [...new Set(normalized)];
}

function enforceGoogleRestaurantPhotoPolicy(restaurant?: Restaurant): void {
  if (!restaurant) return;
  const googlePhotos = extractGoogleRestaurantPhotos(restaurant);
  if (googlePhotos.length > 0) {
    restaurant.photos = googlePhotos;
  } else {
    delete restaurant.photos;
  }
}

function getRestaurantPrimaryGooglePhoto(itemData: any): string | undefined {
  const fromPhotos = extractGoogleRestaurantPhotos(itemData as Partial<Restaurant>)[0];
  if (fromPhotos) return fromPhotos;
  return normalizeRestaurantGooglePhotoUrl(itemData?.imageUrl) || normalizeRestaurantGooglePhotoUrl(itemData?.photoUrl);
}

export function normalizeReturnTransportBookingUrl(rawUrl: string | undefined, returnDate: Date): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    const returnDateStr = returnDate.toISOString().split('T')[0];
    if (url.searchParams.has('departure_date')) {
      url.searchParams.set('departure_date', returnDateStr);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function inferInterItemTransportMode(distanceKm: number, travelMinutes: number): TripItem['transportToPrevious'] {
  if (distanceKm <= 1.2) return 'walk';
  if (distanceKm >= 6) return 'car';
  if (distanceKm >= 3.5 && travelMinutes <= 20) return 'car';
  return 'public';
}

type GeoPoint = { latitude: number; longitude: number };

function asGeoPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, any>;

  const directLat = Number(obj.latitude ?? obj.lat);
  const directLng = Number(obj.longitude ?? obj.lng);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { latitude: directLat, longitude: directLng };
  }

  if (obj.location && typeof obj.location === 'object') {
    const locLat = Number(obj.location.latitude ?? obj.location.lat);
    const locLng = Number(obj.location.longitude ?? obj.location.lng);
    if (Number.isFinite(locLat) && Number.isFinite(locLng)) {
      return { latitude: locLat, longitude: locLng };
    }
  }

  if (obj.toCoords && typeof obj.toCoords === 'object') {
    const toLat = Number(obj.toCoords.lat ?? obj.toCoords.latitude);
    const toLng = Number(obj.toCoords.lng ?? obj.toCoords.longitude);
    if (Number.isFinite(toLat) && Number.isFinite(toLng)) {
      return { latitude: toLat, longitude: toLng };
    }
  }

  return null;
}

function getLatestScheduledGeoPoint(scheduler: DayScheduler): GeoPoint | null {
  const scheduled = scheduler.getItems();
  for (let i = scheduled.length - 1; i >= 0; i--) {
    const point = asGeoPoint((scheduled[i] as ScheduleItem).data);
    if (point) return point;
  }
  return null;
}

export function normalizeSuggestedDayStartHour(
  suggestedHour: number,
  opts: { isFirstDay: boolean; isLastDay: boolean; isDayTrip: boolean }
): number {
  let hour = Number.isFinite(suggestedHour) ? suggestedHour : 9;
  hour = Math.max(6, Math.min(11, hour));

  if (opts.isFirstDay || opts.isLastDay) {
    // Arrival/departure days: default at 9:00 unless transport constraints force later.
    hour = Math.min(hour, 9);
  } else {
    // Full days: default at 8:00 to maximize usable morning and reduce idle gaps.
    hour = Math.min(hour, 8);
  }

  return hour;
}

function sanitizeTripMediaAndSecrets(trip: Trip): void {
  const seen = new WeakSet<object>();

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const sanitizedUrl = PIPELINE_MEDIA_PROXY ? sanitizeGoogleMapsUrl(value) : value;
      return sanitizeApiKeyLeaksInString(sanitizedUrl);
    }

    if (!value || typeof value !== 'object') return value;
    if (seen.has(value as object)) return value;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = visit(value[i]);
      }
      return value;
    }

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = visit(record[key]);
    }
    return record;
  };

  visit(trip);
}

/**
 * Assemble the final Trip object from all pipeline outputs.
 */
export async function assembleTripSchedule(
  plan: BalancedPlan,
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  flights: { outbound: Flight | null; return: Flight | null },
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  data: FetchedData,
  restaurantGeoPool?: Restaurant[],
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  const startDate = new Date(preferences.startDate);
  const days: TripDay[] = [];

  // Pre-fetch Wikipedia summaries for top activities (non-blocking enrichment)
  const wikiDescriptions = new Map<string, string>();
  try {
    const allActivities = clusters.flatMap(c => c.activities);
    const activityNames = [...new Set(allActivities.map(a => a.name))].slice(0, 25);
    const wikiLang = getWikiLanguageForDestination(preferences.destination);
    const wikiResults = await Promise.race([
      batchFetchWikipediaSummaries(activityNames, wikiLang),
      new Promise<Map<string, null>>((resolve) => setTimeout(() => resolve(new Map()), 8000)),
    ]);
    for (const [name, summary] of wikiResults.entries()) {
      if (summary?.extract) {
        wikiDescriptions.set(name, summary.extract);
      }
    }
    if (wikiDescriptions.size > 0) {
      console.log(`[Pipeline V2] Wikipedia: ${wikiDescriptions.size}/${activityNames.length} descriptions enriched`);
    }
  } catch (e) {
    console.warn('[Pipeline V2] Wikipedia enrichment failed (non-critical):', e);
  }

  // ---------------------------------------------------------------------------
  // PRE-PASS: geo-optimize all days, prefetch real directions, re-optimize
  // ---------------------------------------------------------------------------
  const prepassStartLat = hotel?.latitude || data.destCoords.lat;
  const prepassStartLng = hotel?.longitude || data.destCoords.lng;

  // Shared geoOptimize function (extracted so it can be called in the pre-pass)
  const geoOptimizeFn = (activities: ScoredActivity[], sLat: number, sLng: number) => {
    if (activities.length <= 2) return activities;

    const routeCost = (route: ScoredActivity[]): number => {
      if (route.length === 0) return 0;
      let total = 0;
      let maxLeg = 0;
      let longLegPenalty = 0;

      const firstLeg = calculateDistance(sLat, sLng, route[0].latitude, route[0].longitude);
      total += firstLeg;
      maxLeg = Math.max(maxLeg, firstLeg);
      if (firstLeg > 3) longLegPenalty += (firstLeg - 3) * 1.4;

      for (let i = 1; i < route.length; i++) {
        const leg = calculateDistance(
          route[i - 1].latitude, route[i - 1].longitude,
          route[i].latitude, route[i].longitude
        );
        total += leg;
        maxLeg = Math.max(maxLeg, leg);
        if (leg > 3) longLegPenalty += (leg - 3) * 1.4;
      }

      const lastActivity = route[route.length - 1];
      const returnLeg = calculateDistance(lastActivity.latitude, lastActivity.longitude, sLat, sLng);
      total += returnLeg * 0.5;

      const maxLegPenalty = Math.max(0, maxLeg - 4) * 2.5;
      return total + longLegPenalty + maxLegPenalty;
    };

    const buildGreedyFromFirst = (firstIndex: number): ScoredActivity[] => {
      const ordered: ScoredActivity[] = [];
      const remaining = [...activities];
      const first = remaining.splice(firstIndex, 1)[0];
      ordered.push(first);

      let curLat = first.latitude;
      let curLng = first.longitude;
      while (remaining.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = calculateDistance(curLat, curLng, remaining[i].latitude, remaining[i].longitude);
          if (d < nearestDist) {
            nearestDist = d;
            nearestIdx = i;
          }
        }
        const next = remaining.splice(nearestIdx, 1)[0];
        ordered.push(next);
        curLat = next.latitude;
        curLng = next.longitude;
      }
      return ordered;
    };

    let bestRoute: ScoredActivity[] = [];
    let bestCost = Infinity;
    for (let i = 0; i < activities.length; i++) {
      const candidate = buildGreedyFromFirst(i);
      const candidateCost = routeCost(candidate);
      if (candidateCost < bestCost) {
        bestCost = candidateCost;
        bestRoute = candidate;
      }
    }

    let improved = true;
    let route = [...bestRoute];
    while (improved) {
      improved = false;
      for (let i = 0; i < route.length - 2; i++) {
        for (let k = i + 1; k < route.length - 1; k++) {
          const nextRoute = [
            ...route.slice(0, i + 1),
            ...route.slice(i + 1, k + 1).reverse(),
            ...route.slice(k + 1),
          ];
          const nextCost = routeCost(nextRoute);
          if (nextCost + 0.01 < bestCost) {
            route = nextRoute;
            bestCost = nextCost;
            improved = true;
          }
        }
      }
    }

    return route;
  };

  // Step 1: Run geoOptimize for all days and collect ordered activities
  const prepassActivities = new Map<number, ScoredActivity[]>();
  for (const balancedDay of plan.days) {
    const cluster = clusters.find(c => c.dayNumber === balancedDay.dayNumber);
    const rawOrdered = reorderByPlan(cluster, balancedDay.activityOrder);
    const optimized = geoOptimizeFn(rawOrdered, prepassStartLat, prepassStartLng);
    prepassActivities.set(balancedDay.dayNumber, optimized);
  }

  // Step 2: Prefetch real directions for all consecutive pairs
  let directionsCache: DirectionsCache = new Map();
  try {
    directionsCache = await prefetchDirectionsForDays(prepassActivities, prepassStartLat, prepassStartLng);
  } catch (e) {
    console.warn('[Pipeline V2] Directions prefetch failed — falling back to Haversine:', e);
  }

  // Step 3: Re-run 2-opt per day with real times (if cache has entries)
  if (directionsCache.size > 0) {
    let reoptCount = 0;
    for (const [dayNum, activities] of prepassActivities) {
      const before = activities.map(a => a.name).join(' → ');
      const reoptimized = reoptimizeWithRealTimes(activities, prepassStartLat, prepassStartLng, directionsCache);
      prepassActivities.set(dayNum, reoptimized);
      const after = reoptimized.map(a => a.name).join(' → ');
      if (before !== after) {
        reoptCount++;
        console.log(`[Pipeline V2] Day ${dayNum} re-optimized with real times: ${after}`);

        // Prefetch any new pairs introduced by the re-ordering
        const newPairs = collectDirectionPairs(
          new Map([[dayNum, reoptimized]]),
          prepassStartLat,
          prepassStartLng
        ).filter(p => !directionsCache.has(directionsCacheKey(p.fromLat, p.fromLng, p.toLat, p.toLng)));

        if (newPairs.length > 0) {
          try {
            const results = await Promise.allSettled(
              newPairs.map(({ fromLat, fromLng, toLat, toLng }) =>
                getDirections({
                  from: { lat: fromLat, lng: fromLng },
                  to: { lat: toLat, lng: toLng },
                  mode: 'transit',
                })
              )
            );
            for (let i = 0; i < results.length; i++) {
              if (results[i].status === 'fulfilled') {
                const dir = (results[i] as PromiseFulfilledResult<any>).value;
                if (dir && typeof dir.duration === 'number') {
                  const p = newPairs[i];
                  directionsCache.set(
                    directionsCacheKey(p.fromLat, p.fromLng, p.toLat, p.toLng),
                    { duration: dir.duration, distance: dir.distance }
                  );
                }
              }
            }
          } catch {
            // Non-critical — cache will just miss those new pairs
          }
        }
      }
    }
    if (reoptCount > 0) {
      console.log(`[Pipeline V2] 2-opt re-optimization: ${reoptCount}/${prepassActivities.size} days changed with real times`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-day restaurant dedup: track restaurant names used across ALL days
  // to prevent the same restaurant appearing on multiple days
  // ---------------------------------------------------------------------------
  const crossDayUsedRestaurantNames = new Set<string>();
  const crossDayUsedRestaurantIds = new Set<string>();
  // Pre-populate from meals already assigned by step4
  for (const m of meals) {
    if (m.restaurant) {
      crossDayUsedRestaurantIds.add(m.restaurant.id);
      crossDayUsedRestaurantNames.add(m.restaurant.name);
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-day activity dedup: prevent the same activity from appearing on multiple days.
  // This can happen when rebalancing/must-see injection puts an activity into a cluster
  // while another copy remained from a different source.
  // ---------------------------------------------------------------------------
  let seenActivitiesAcrossDays: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }> = [];
  for (const [dayNum, activities] of prepassActivities) {
    const dedupResult = dedupeActivitiesBySimilarity(
      activities,
      seenActivitiesAcrossDays,
      { nearDistanceKm: 0.35, canonicalDistanceKm: 2.5 }
    );
    if (dedupResult.dropped > 0) {
      console.log(`[Pipeline V2] Cross-day dedup: removed ${dedupResult.dropped} duplicate activity(ies) from Day ${dayNum}`);
    }
    prepassActivities.set(dayNum, dedupResult.deduped);
    seenActivitiesAcrossDays = dedupResult.seen as typeof seenActivitiesAcrossDays;
  }

  // ---------------------------------------------------------------------------
  // MAIN LOOP: schedule each day using pre-computed activities + directions cache
  // ---------------------------------------------------------------------------
  for (const balancedDay of plan.days) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + balancedDay.dayNumber - 1);

    const isFirstDay = balancedDay.dayNumber === 1;
    const isLastDay = balancedDay.dayNumber === preferences.durationDays;

    // Compute day bounds
    let dayStartHour = normalizeSuggestedDayStartHour(
      parseInt(balancedDay.suggestedStartTime?.split(':')[0] || '9', 10),
      { isFirstDay, isLastDay, isDayTrip: !!balancedDay.isDayTrip }
    );
    let dayEndHour = 22;

    // Detect ground transport (train/bus/car) — used when no flights
    const isGroundTransport = transport && transport.mode !== 'plane';
    const hasOutboundTransport = isFirstDay && isGroundTransport;
    const hasReturnTransport = isLastDay && isGroundTransport;

    // Compute outbound arrival hour for ground transport
    let groundArrivalHour: number | null = null;
    if (hasOutboundTransport && transport) {
      if (transport.transitLegs?.length) {
        const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
        groundArrivalHour = new Date(lastLeg.arrival).getHours();
      } else {
        // Estimated: depart 08:00 + total duration
        groundArrivalHour = 8 + Math.ceil(transport.totalDuration / 60);
      }
    }

    // Compute return departure hour for ground transport
    // Transit legs have outbound dates — they almost never match the return day
    // Use estimated afternoon departure (15:00 gives a full morning for activities)
    let groundDepartureHour: number | null = null;
    if (hasReturnTransport && transport) {
      // Estimate based on total duration: leave at 15:00 by default
      // If the trip is very long (>4h), leave earlier (14:00) to arrive at reasonable time
      const durationHours = (transport.totalDuration || 120) / 60;
      groundDepartureHour = durationHours > 4 ? 14 : 15;
    }

    if (isFirstDay && flights.outbound) {
      // Use display time (local airport time) if available, otherwise parse ISO
      const arrivalHour = flights.outbound.arrivalTimeDisplay
        ? parseInt(flights.outbound.arrivalTimeDisplay.split(':')[0], 10)
        : new Date(flights.outbound.arrivalTime).getHours();
      dayStartHour = Math.max(dayStartHour, arrivalHour + 1); // +1h for transfer
    } else if (hasOutboundTransport && groundArrivalHour !== null) {
      // Ground transport: activities start after arrival
      dayStartHour = Math.max(dayStartHour, groundArrivalHour + 1);
    }

    if (isLastDay && flights.return) {
      const departureHour = flights.return.departureTimeDisplay
        ? parseInt(flights.return.departureTimeDisplay.split(':')[0], 10)
        : new Date(flights.return.departureTime).getHours();
      if (departureHour >= 14) {
        dayStartHour = Math.min(dayStartHour, 8);
      }
      // Need to be at airport 2h before departure, plus 1h transfer = 3h before
      // But ensure at least a 3h window for the last day (activities + checkout)
      dayEndHour = Math.max(dayStartHour + 3, departureHour - 3);
      // If flight is very early (before noon), start earlier
      if (departureHour <= 12) {
        dayStartHour = Math.min(dayStartHour, 7);
      }
    } else if (hasReturnTransport && groundDepartureHour !== null) {
      if (groundDepartureHour >= 14) {
        dayStartHour = Math.min(dayStartHour, 8);
      }
      // Ground transport: need to be at station ~30min before
      dayEndHour = Math.max(dayStartHour + 3, groundDepartureHour - 1);
      if (groundDepartureHour <= 12) {
        dayStartHour = Math.min(dayStartHour, 7);
      }
    }

    const dayStart = parseTime(dayDate, `${String(dayStartHour).padStart(2, '0')}:00`);
    const dayEnd = parseTime(dayDate, `${String(Math.min(dayEndHour, 23)).padStart(2, '0')}:00`);

    const scheduler = new DayScheduler(dayDate, dayStart, dayEnd);

    // 1. Fixed items: flights OR ground transport
    if (isFirstDay && flights.outbound) {
      const depTime = new Date(flights.outbound.departureTime);
      const arrTime = new Date(flights.outbound.arrivalTime);
      scheduler.insertFixedItem({
        id: `flight-out-${balancedDay.dayNumber}`,
        title: `Vol ${flights.outbound.flightNumber}`,
        type: 'flight',
        startTime: depTime,
        endTime: arrTime,
        data: flights.outbound,
      });
    } else if (hasOutboundTransport && transport) {
      // Ground transport outbound (train, bus, car)
      const { start: tStart, end: tEnd } = getGroundTransportTimes(transport, dayDate, 'outbound');
      scheduler.insertFixedItem({
        id: `transport-out-${balancedDay.dayNumber}`,
        title: `${MODE_LABELS[transport.mode] || '🚊 Transport'} → ${preferences.destination}`,
        type: 'transport',
        startTime: tStart,
        endTime: tEnd,
        data: {
          ...transport,
          description: transport.segments?.map(s => `${s.from} → ${s.to}`).join(' | '),
          locationName: `${preferences.origin} → ${preferences.destination}`,
          transitLegs: transport.transitLegs,
          transitDataSource: transport.dataSource,
          priceRange: transport.priceRange,
          estimatedCost: transport.totalPrice,
          bookingUrl: transport.bookingUrl,
          transportMode: normalizeTransportMode(transport.mode),
          transportRole: 'longhaul',
        },
      });
    }

    // IMPORTANT: Return flight/transport is inserted AFTER activities (see section 9 below)
    // This prevents the cursor from jumping past dayEnd, blocking activity insertion.
    // We prepare the data here but insert it later.
    let returnTransportData: {
      id: string; title: string; type: string;
      startTime: Date; endTime: Date; data: any;
    } | null = null;

    if (isLastDay && flights.return) {
      returnTransportData = {
        id: `flight-ret-${balancedDay.dayNumber}`,
        title: `Vol ${flights.return.flightNumber}`,
        type: 'flight',
        startTime: new Date(flights.return.departureTime),
        endTime: new Date(flights.return.arrivalTime),
        data: flights.return,
      };
    } else if (hasReturnTransport && transport) {
      const { start: tStart, end: tEnd } = getGroundTransportTimes(transport, dayDate, 'return');

      // Build return transit legs with CORRECT dates (not outbound dates)
      let returnTransitLegs: typeof transport.transitLegs = undefined;
      if (transport.transitLegs?.length) {
        const reversedLegs = transport.transitLegs.slice().reverse();
        let cumulativeMs = tStart.getTime();

        returnTransitLegs = reversedLegs.map((leg) => {
          const legDep = new Date(cumulativeMs);
          const legDurMs = (leg.duration || 30) * 60 * 1000;
          const legArr = new Date(cumulativeMs + legDurMs);
          cumulativeMs = legArr.getTime();

          return {
            mode: leg.mode,
            from: leg.to,
            to: leg.from,
            departure: legDep.toISOString(),
            arrival: legArr.toISOString(),
            duration: leg.duration,
            operator: leg.operator,
            line: leg.line,
          };
        });
      }

      returnTransportData = {
        id: `transport-ret-${balancedDay.dayNumber}`,
        title: `${MODE_LABELS[transport.mode] || '🚊 Transport'} → ${preferences.origin}`,
        type: 'transport',
        startTime: tStart,
        endTime: tEnd,
        data: {
          ...transport,
          description: transport.segments?.map(s => `${s.to} → ${s.from}`).join(' | '),
          locationName: `${preferences.destination} → ${preferences.origin}`,
          transitLegs: returnTransitLegs,
          transitDataSource: transport.dataSource,
          priceRange: transport.priceRange,
          estimatedCost: transport.totalPrice,
          bookingUrl: normalizeReturnTransportBookingUrl(transport.bookingUrl, tStart),
          transportMode: normalizeTransportMode(transport.mode),
          transportRole: 'longhaul',
        },
      };
    }

    // 2. Prepare meal data early (needed for scheduling order decisions)
    const dayMeals = meals.filter(m => m.dayNumber === balancedDay.dayNumber);
    const breakfast = dayMeals.find(m => m.mealType === 'breakfast');
    const lunch = dayMeals.find(m => m.mealType === 'lunch');
    const dinner = dayMeals.find(m => m.mealType === 'dinner');

    // Determine which meals to skip based on time constraints
    const hasReturnTravel = !!(flights.return || hasReturnTransport);
    // Skip breakfast only if we physically can't have it (arriving after 10am)
    const skipBreakfast = isFirstDay && dayStartHour >= 10;
    // Skip lunch only if the day ends before lunch time (e.g. very early departure)
    const skipLunch = (isLastDay && hasReturnTravel && dayEndHour <= 12) ||
                       (isFirstDay && dayStartHour >= 14);
    // Skip dinner only if the day ends before dinner time
    const skipDinner = (isLastDay && hasReturnTravel && dayEndHour < 19) ||
                       (isFirstDay && dayStartHour >= 20);

    // 3. Hotel check-in (first day) / check-out (last day)
    // IMPORTANT: On the last day, insert breakfast BEFORE checkout.
    // Otherwise checkout advances the cursor past breakfast's maxEndTime (10:00).
    // On the first day we prioritize check-in near arrival time, so it is not pushed
    // after dinner by late conflict resolution.
    if (isFirstDay && hotel) {
      let checkinTime = parseTime(dayDate, hotel.checkInTime || '15:00');
      // If there's a flight, check-in must be AFTER arrival + transfer
      if (flights.outbound) {
        const arrivalHour = flights.outbound.arrivalTimeDisplay
          ? parseInt(flights.outbound.arrivalTimeDisplay.split(':')[0], 10)
          : new Date(flights.outbound.arrivalTime).getHours();
        const arrivalMin = flights.outbound.arrivalTimeDisplay
          ? parseInt(flights.outbound.arrivalTimeDisplay.split(':')[1], 10)
          : new Date(flights.outbound.arrivalTime).getMinutes();
        const earliestCheckin = parseTime(dayDate, `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMin).padStart(2, '0')}`);
        // Add 1h for transfer from airport
        const earliestCheckinWithTransfer = new Date(earliestCheckin.getTime() + 60 * 60 * 1000);
        if (earliestCheckinWithTransfer > checkinTime) {
          checkinTime = earliestCheckinWithTransfer;
        }
      } else if (hasOutboundTransport && groundArrivalHour !== null) {
        // Ground transport: check-in after arrival at destination
        const earliestCheckin = parseTime(dayDate, `${String(groundArrivalHour).padStart(2, '0')}:30`);
        if (earliestCheckin > checkinTime) {
          checkinTime = earliestCheckin;
        }
      }
      // If check-in falls past midnight (e.g. flight arrives 23:30 + 1h transfer = 00:30),
      // cap it at 23:59 so it displays correctly within the day boundary
      const midnight = new Date(dayDate);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 0, 0);
      if (checkinTime >= midnight) {
        checkinTime = parseTime(dayDate, '23:59');
      }
      const checkinData = {
        id: `checkin-${balancedDay.dayNumber}`,
        title: `Check-in ${hotel.name}`,
        type: 'checkin',
        startTime: checkinTime,
        endTime: new Date(checkinTime.getTime() + 30 * 60 * 1000),
        data: hotel,
      };

      // Insert immediately so check-in stays anchored near arrival.
      // If fixed insert conflicts, fallback to addItem from that minimum start.
      const checkinResult = scheduler.insertFixedItem(checkinData);
      if (!checkinResult) {
        scheduler.addItem({
          id: `checkin-fallback-${balancedDay.dayNumber}`,
          title: checkinData.title,
          type: 'checkin',
          duration: 30,
          minStartTime: checkinData.startTime,
          maxEndTime: parseTime(dayDate, '22:30'),
          data: checkinData.data,
        });
      }
    }

    // Last day breakfast: DEFERRED to after reoptMealFromPool runs (see section 4c below).
    // This allows the rescue logic to find a real restaurant before we insert the scheduler item.
    // We still insert checkout here since it's a fixed-time item.

    if (isLastDay && hotel) {
      let checkoutTime = parseTime(dayDate, hotel.checkOutTime || '11:00');
      // If there's a return flight, check-out must be well before departure
      if (flights.return) {
        const departureHour = flights.return.departureTimeDisplay
          ? parseInt(flights.return.departureTimeDisplay.split(':')[0], 10)
          : new Date(flights.return.departureTime).getHours();
        // Check-out at least 3h before flight
        const latestCheckout = parseTime(dayDate, `${String(Math.max(7, departureHour - 3)).padStart(2, '0')}:00`);
        if (latestCheckout < checkoutTime) {
          checkoutTime = latestCheckout;
        }
      }
      scheduler.insertFixedItem({
        id: `checkout-${balancedDay.dayNumber}`,
        title: `Check-out ${hotel.name}`,
        type: 'checkout',
        startTime: new Date(checkoutTime.getTime() - 30 * 60 * 1000),
        endTime: checkoutTime,
        data: hotel,
      });
    }

    // 4. Get activities from pre-pass (already geo-optimized + re-optimized with real times)
    const orderedActivitiesRaw = prepassActivities.get(balancedDay.dayNumber) || [];
    const intraDayDedup = dedupeActivitiesBySimilarity(
      orderedActivitiesRaw,
      [],
      { nearDistanceKm: 0.35, canonicalDistanceKm: 2.5 }
    );
    const orderedActivities = intraDayDedup.deduped;
    if (intraDayDedup.dropped > 0) {
      console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: removed ${intraDayDedup.dropped} intra-day duplicate activity(ies)`);
    }

    const mustSeeCount = orderedActivities.filter(a => a.mustSee).length;
    console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ${orderedActivities.length} activities to schedule (${mustSeeCount} must-sees), dayStart=${dayStartHour}:00, dayEnd=${dayEndHour}:00, window=${dayEndHour - dayStartHour}h, cursor=${formatTimeHHMM(scheduler.getCurrentTime())}`);
    for (const a of orderedActivities) {
      console.log(`[Pipeline V2]   → "${a.name}" (${a.duration || 60}min, score=${a.score.toFixed(1)}, mustSee=${!!a.mustSee})`);
    }

    // 4b. Restaurant re-optimization after geoOptimize
    // After activity reordering, a restaurant assigned near the old cluster centroid
    // may now be far from the nearest activity. Search the FULL restaurant pool
    // for a better option near the actual neighbor activity.
    // Hard max: restaurant must be within 500m of the neighbor activity.
    const MEAL_REOPT_LIMITS: Record<string, number> = {
      breakfast: 0.5,
      lunch: 0.5,
      dinner: 0.5,
    };

    const usedRestaurantIds = new Set<string>(crossDayUsedRestaurantIds);
    const usedRestaurantNames = new Set<string>(crossDayUsedRestaurantNames);
    // Track all already-assigned restaurants on this day
    const dayMealsAll = meals.filter(m => m.dayNumber === balancedDay.dayNumber);
    for (const m of dayMealsAll) {
      if (m.restaurant) {
        usedRestaurantIds.add(m.restaurant.id);
        usedRestaurantNames.add(m.restaurant.name);
      }
    }

    const reoptMealFromPool = async (
      meal: typeof lunch,
      neighborActivity: ScoredActivity | undefined,
      mealType: 'breakfast' | 'lunch' | 'dinner',
    ) => {
      if (!meal || !neighborActivity) return;
      if (!neighborActivity.latitude || !neighborActivity.longitude) return;

      const maxDist = MEAL_REOPT_LIMITS[mealType] || 2.0;

      // Helper: search pool for best restaurant near neighborActivity
      const findBestInPool = (pool: Restaurant[], maxCurrentDist?: number): { best: Restaurant | null; dist: number } => {
        const SEARCH_RADII = [0.5, 0.8, 1.2];
        let bestCandidate: Restaurant | null = null;
        let bestDist = Infinity;

        for (const radius of SEARCH_RADII) {
          for (const r of pool) {
            if (usedRestaurantIds.has(r.id) || usedRestaurantNames.has(r.name)) continue;
            if (!r.latitude || !r.longitude) continue;
            if (!isAppropriateForMeal(r, mealType)) continue;
            if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;

            const dist = calculateDistance(
              neighborActivity.latitude!, neighborActivity.longitude!,
              r.latitude, r.longitude
            );
            if (dist > radius) continue;
            // If we have a current restaurant, only accept closer options
            if (maxCurrentDist !== undefined && dist >= maxCurrentDist) continue;

            if (dist < bestDist || (dist === bestDist && (r.rating || 3) > ((bestCandidate as any)?.rating || 3))) {
              bestDist = dist;
              bestCandidate = r;
            }
          }
          if (bestCandidate) break;
        }
        return { best: bestCandidate, dist: bestDist };
      };

      // Helper: fetch restaurants from API near neighborActivity
      const fetchNearbyFromAPI = async (): Promise<Restaurant[]> => {
        try {
          const nearbyResults = await searchRestaurantsNearby(
            { lat: neighborActivity.latitude!, lng: neighborActivity.longitude! },
            preferences.destination,
            { mealType, maxDistance: 800, limit: 5 }
          );
          if (nearbyResults.length > 0 && restaurantGeoPool) {
            restaurantGeoPool.push(...nearbyResults);
          }
          return nearbyResults;
        } catch (err) {
          console.warn(`[Pipeline V2] Restaurant re-opt API fetch failed:`, err);
          return [];
        }
      };

      // CASE A: meal has no restaurant at all (step4 failed to assign)
      if (!meal.restaurant) {
        console.log(`[Pipeline V2] Restaurant re-opt: no restaurant assigned for day ${balancedDay.dayNumber} ${mealType}, searching pool + API near "${neighborActivity.name || 'activity'}"...`);

        // Try pool first
        let { best: bestCandidate, dist: bestDist } = restaurantGeoPool?.length
          ? findBestInPool(restaurantGeoPool)
          : { best: null, dist: Infinity };

        // If pool has nothing close, fetch from API
        if (!bestCandidate) {
          const nearbyResults = await fetchNearbyFromAPI();
          if (nearbyResults.length > 0) {
            const freshResult = findBestInPool(nearbyResults);
            if (freshResult.best) {
              bestCandidate = freshResult.best;
              bestDist = freshResult.dist;
            }
          }
        }

        if (bestCandidate) {
          console.log(`[Pipeline V2] Restaurant re-opt (rescue) day ${balancedDay.dayNumber} ${mealType}: found "${bestCandidate.name}" (${bestDist.toFixed(2)}km from ${neighborActivity.name})`);
          meal.restaurant = bestCandidate;
          meal.restaurantAlternatives = [];
          usedRestaurantIds.add(bestCandidate.id);
          usedRestaurantNames.add(bestCandidate.name);
          crossDayUsedRestaurantIds.add(bestCandidate.id);
          crossDayUsedRestaurantNames.add(bestCandidate.name);
        }
        // Fill alternatives from pool with cuisine diversity
        if (meal.restaurant && restaurantGeoPool && restaurantGeoPool.length > 0) {
          const nearbyAlts: { r: Restaurant; dist: number; family: string }[] = [];
          for (const r of restaurantGeoPool) {
            if (r.id === meal.restaurant.id) continue;
            if (usedRestaurantIds.has(r.id) || usedRestaurantNames.has(r.name)) continue;
            if (!r.latitude || !r.longitude) continue;
            if (!isAppropriateForMeal(r, mealType)) continue;
            if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
            const dist = calculateDistance(
              neighborActivity.latitude!, neighborActivity.longitude!,
              r.latitude, r.longitude
            );
            if (dist <= 1.5) nearbyAlts.push({ r, dist, family: getCuisineFamily(r) });
          }
          nearbyAlts.sort((a, b) => a.dist - b.dist);
          // Pass 1: pick alts with different cuisine families
          const primaryFamily = getCuisineFamily(meal.restaurant);
          const usedFamilies = new Set([primaryFamily]);
          const diverseAlts: Restaurant[] = [];
          for (const alt of nearbyAlts) {
            if (diverseAlts.length >= 2) break;
            if (!usedFamilies.has(alt.family)) {
              diverseAlts.push(alt.r);
              usedFamilies.add(alt.family);
            }
          }
          // Pass 2: fill remaining slots with closest
          for (const alt of nearbyAlts) {
            if (diverseAlts.length >= 2) break;
            if (!diverseAlts.some(d => d.id === alt.r.id)) {
              diverseAlts.push(alt.r);
            }
          }
          meal.restaurantAlternatives = diverseAlts;
        }
        return;
      }

      // CASE B: meal has a restaurant — check if it needs re-optimization
      const rLat = meal.restaurant.latitude;
      const rLng = meal.restaurant.longitude;
      if (!rLat || !rLng) return;

      const currentDist = calculateDistance(
        neighborActivity.latitude, neighborActivity.longitude,
        rLat, rLng
      );
      if (currentDist <= 0.3) return; // Already within 300m — no need to re-opt

      // First check existing alternatives (fast path)
      const alternatives = meal.restaurantAlternatives || [];
      for (const alt of alternatives) {
        if (!alt.latitude || !alt.longitude) continue;
        if (!isAppropriateForMeal(alt, mealType)) continue;
        if (mealType === 'breakfast' && !isBreakfastSpecialized(alt)) continue;
        const altDist = calculateDistance(
          neighborActivity.latitude, neighborActivity.longitude,
          alt.latitude, alt.longitude
        );
        if (altDist < currentDist && altDist <= maxDist) {
          console.log(`[Pipeline V2] Restaurant re-opt (alt) day ${balancedDay.dayNumber} ${mealType}: "${meal.restaurant.name}" (${currentDist.toFixed(1)}km) → "${alt.name}" (${altDist.toFixed(1)}km)`);
          const oldRestaurant = meal.restaurant;
          meal.restaurant = alt;
          meal.restaurantAlternatives = [oldRestaurant, ...alternatives.filter(a => a.id !== alt.id)];
          usedRestaurantIds.add(alt.id);
          usedRestaurantNames.add(alt.name);
          crossDayUsedRestaurantIds.add(alt.id);
          crossDayUsedRestaurantNames.add(alt.name);
          return;
        }
      }

      // Try existing pool first
      let { best: bestCandidate, dist: bestDist } = restaurantGeoPool?.length
        ? findBestInPool(restaurantGeoPool, currentDist)
        : { best: null, dist: Infinity };

      // If pool has nothing close AND current restaurant is too far, fetch from API
      if (!bestCandidate && currentDist > maxDist) {
        console.log(`[Pipeline V2] Restaurant re-opt: pool has nothing near ${neighborActivity.name || 'activity'} (day ${balancedDay.dayNumber} ${mealType}), fetching nearby restaurants via API...`);
        const nearbyResults = await fetchNearbyFromAPI();
        if (nearbyResults.length > 0) {
          const freshResult = findBestInPool(nearbyResults, currentDist);
          if (freshResult.best) {
            bestCandidate = freshResult.best;
            bestDist = freshResult.dist;
          }
        }
      }

      if (bestCandidate) {
        console.log(`[Pipeline V2] Restaurant re-opt (pool) day ${balancedDay.dayNumber} ${mealType}: "${meal.restaurant.name}" (${currentDist.toFixed(1)}km) → "${bestCandidate.name}" (${bestDist.toFixed(1)}km)`);
        meal.restaurantAlternatives = [meal.restaurant, ...(meal.restaurantAlternatives || []).slice(0, 2)].slice(0, 2);
        meal.restaurant = bestCandidate;
        usedRestaurantIds.add(bestCandidate.id);
        usedRestaurantNames.add(bestCandidate.name);
        crossDayUsedRestaurantIds.add(bestCandidate.id);
        crossDayUsedRestaurantNames.add(bestCandidate.name);
      }

      // Re-filter alternatives: only keep alternatives within reasonable distance of the neighbor
      if (meal.restaurant && meal.restaurantAlternatives && neighborActivity.latitude && neighborActivity.longitude) {
        const MAX_ALT_DIST = 1.2; // km
        meal.restaurantAlternatives = meal.restaurantAlternatives.filter(alt => {
          if (!alt.latitude || !alt.longitude) return false;
          const altDist = calculateDistance(
            neighborActivity.latitude!, neighborActivity.longitude!,
            alt.latitude, alt.longitude
          );
          return altDist <= MAX_ALT_DIST;
        });
        // If we lost all alternatives, find new ones from pool near the neighbor
        if (meal.restaurantAlternatives.length === 0 && restaurantGeoPool && restaurantGeoPool.length > 0) {
          const nearbyAlts: { r: Restaurant; dist: number }[] = [];
          for (const r of restaurantGeoPool) {
            if (r.id === meal.restaurant.id) continue;
            if (usedRestaurantIds.has(r.id) || usedRestaurantNames.has(r.name)) continue;
            if (!r.latitude || !r.longitude) continue;
            if (!isAppropriateForMeal(r, mealType)) continue;
            if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
            const dist = calculateDistance(
              neighborActivity.latitude!, neighborActivity.longitude!,
              r.latitude, r.longitude
            );
            if (dist <= MAX_ALT_DIST) {
              nearbyAlts.push({ r, dist });
            }
          }
          nearbyAlts.sort((a, b) => a.dist - b.dist);
          meal.restaurantAlternatives = nearbyAlts.slice(0, 2).map(({ r }) => r);
        }
      }
    };

    // Breakfast rescue: runs even when day has no activities (e.g., departure day)
    if (breakfast && !breakfast.restaurant && hotel && !hotel.breakfastIncluded && !skipBreakfast) {
      const hotelAsNeighbor = { latitude: hotel.latitude, longitude: hotel.longitude, name: hotel.name } as ScoredActivity;
      await reoptMealFromPool(breakfast, hotelAsNeighbor, 'breakfast');
    }

    if (orderedActivities.length > 0) {
      // Lunch neighbor: the activity before the mid-point (likely scheduled just before lunch break)
      const midIdx = Math.floor(orderedActivities.length / 2);
      const lunchNeighborIdx = Math.max(0, midIdx - 1);
      await reoptMealFromPool(lunch, orderedActivities[lunchNeighborIdx], 'lunch');
      // Dinner neighbor: blend last activity (60%) + hotel (40%) to favor restaurants
      // on the path back toward the hotel (avoids long late-night returns)
      const lastAct = orderedActivities[orderedActivities.length - 1];
      const dinnerNeighbor = hotel && lastAct
        ? {
            ...lastAct,
            latitude: lastAct.latitude * 0.6 + hotel.latitude * 0.4,
            longitude: lastAct.longitude * 0.6 + hotel.longitude * 0.4,
          }
        : lastAct;
      await reoptMealFromPool(dinner, dinnerNeighbor, 'dinner');
    }

    // 4c. Last-day breakfast (deferred from section 3 so reoptMealFromPool could rescue it)
    // Uses insertFixedItem to bypass cursor (which is past checkout by now)
    if (isLastDay && !skipBreakfast && dayStartHour <= 10) {
      const bkfStart = parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`);
      if (breakfast?.restaurant) {
        scheduler.insertFixedItem({
          id: `meal-${balancedDay.dayNumber}-breakfast`,
          title: `Petit-déjeuner — ${breakfast.restaurant.name}`,
          type: 'restaurant',
          startTime: bkfStart,
          endTime: new Date(bkfStart.getTime() + 45 * 60 * 1000),
          data: { ...breakfast.restaurant, _alternatives: breakfast.restaurantAlternatives || [] },
        });
      } else if (hotel?.breakfastIncluded) {
        scheduler.insertFixedItem({
          id: `hotel-breakfast-${balancedDay.dayNumber}`,
          title: `Petit-déjeuner à l'hôtel`,
          type: 'restaurant',
          startTime: bkfStart,
          endTime: new Date(bkfStart.getTime() + 30 * 60 * 1000),
          data: { name: hotel.name || 'Hôtel', description: 'Petit-déjeuner inclus', latitude: hotel.latitude, longitude: hotel.longitude, estimatedCost: 0 },
        });
      } else {
        // Self-catered breakfast placeholder
        const bkfTitle = hotel ? 'Petit-déjeuner à l\'hôtel' : 'Petit-déjeuner — Café/Boulangerie à proximité';
        const bkfData = hotel
          ? { name: hotel.name || 'Hôtel', description: 'Petit-déjeuner', latitude: hotel.latitude, longitude: hotel.longitude, estimatedCost: 0 }
          : { name: 'Café/Boulangerie', description: 'Petit-déjeuner à proximité de l\'hôtel', latitude: data.destCoords.lat, longitude: data.destCoords.lng, estimatedCost: 8 };
        scheduler.insertFixedItem({
          id: `self-breakfast-${balancedDay.dayNumber}`,
          title: bkfTitle,
          type: 'restaurant',
          startTime: bkfStart,
          endTime: new Date(bkfStart.getTime() + 30 * 60 * 1000),
          data: bkfData,
        });
      }
    }

    // 5. Insert breakfast for non-last days
    if (!isLastDay && breakfast?.restaurant && !skipBreakfast && dayStartHour <= 10) {
      scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-breakfast`,
        title: `Petit-déjeuner — ${breakfast.restaurant.name}`,
        type: 'restaurant',
        duration: 45,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:30'),
        data: { ...breakfast.restaurant, _alternatives: breakfast.restaurantAlternatives || [] },
      });
    } else if (!isLastDay && !breakfast?.restaurant && !skipBreakfast && hotel?.breakfastIncluded && dayStartHour <= 10) {
      // Hotel breakfast fallback
      scheduler.addItem({
        id: `hotel-breakfast-${balancedDay.dayNumber}`,
        title: `Petit-déjeuner à l'hôtel`,
        type: 'restaurant',
        duration: 30,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:00'),
        data: { name: hotel?.name || 'Hôtel', description: 'Petit-déjeuner inclus', latitude: hotel?.latitude, longitude: hotel?.longitude, estimatedCost: 0 },
      });
    } else if (!isLastDay && !breakfast?.restaurant && !skipBreakfast && !hotel?.breakfastIncluded && dayStartHour <= 10) {
      // Self-catered breakfast placeholder
      let bkfTitle: string;
      let bkfData: any;
      if (hotel) {
        bkfTitle = 'Petit-déjeuner à l\'hôtel';
        bkfData = { name: hotel.name || 'Hôtel', description: 'Petit-déjeuner', latitude: hotel.latitude, longitude: hotel.longitude, estimatedCost: 0 };
      } else {
        bkfTitle = 'Petit-déjeuner — Café/Boulangerie à proximité';
        bkfData = { name: 'Café/Boulangerie', description: 'Petit-déjeuner à proximité de l\'hôtel', latitude: data.destCoords.lat, longitude: data.destCoords.lng, estimatedCost: 8 };
      }
      scheduler.addItem({
        id: `self-breakfast-${balancedDay.dayNumber}`,
        title: bkfTitle,
        type: 'restaurant',
        duration: 30,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:00'),
        data: bkfData,
      });
    }

    // 5b. Check if any activity on this day includes a meal (cooking class, food tour, etc.)
    // Determine WHICH meal it replaces based on position in the day:
    // - Activities in the first half of the day → replace lunch
    // - Activities in the second half → replace dinner
    // - If only 1-2 activities total, a meal-inclusive one replaces the nearest meal
    let skipLunchForMealActivity = false;
    let skipDinnerForMealActivity = false;
    const mealInclusiveActivities = orderedActivities.filter(act => (act as any).includesMeal === true);
    if (mealInclusiveActivities.length > 0) {
      const totalActs = orderedActivities.length;
      for (const mia of mealInclusiveActivities) {
        const idx = orderedActivities.indexOf(mia);
        // If in the first half of the day → replaces lunch; second half → replaces dinner
        if (idx < totalActs / 2) {
          skipLunchForMealActivity = true;
        } else {
          skipDinnerForMealActivity = true;
        }
      }
      console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: meal-inclusive activity found — skipLunch=${skipLunchForMealActivity}, skipDinner=${skipDinnerForMealActivity}`);
    }

    // 6. Pre-insert lunch if the day starts late (after 14:30 — arrival day)
    // In this case, the interleave loop will never hit the 11:30-14:30 window
    let lunchInserted = false;
    let dinnerInserted = false;

    const initialCursor = scheduler.getCurrentTime();
    const initialHour = initialCursor.getHours() + initialCursor.getMinutes() / 60;

    // If cursor starts between 11:30 and 14:30, insert lunch NOW before activities
    if (!skipLunch && !skipLunchForMealActivity && lunch?.restaurant && initialHour >= 11.5 && initialHour < 14.5 && orderedActivities.length > 0) {
      const result = scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-lunch`,
        title: `Déjeuner — ${lunch.restaurant.name}`,
        type: 'restaurant',
        duration: 60,
        minStartTime: parseTime(dayDate, '12:00'),
        maxEndTime: parseTime(dayDate, '14:30'),
        data: { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] },
      });
      if (result) lunchInserted = true;
    }

    // 7. Interleave activities with lunch and dinner at appropriate positions
    for (let i = 0; i < orderedActivities.length; i++) {
      const activity = orderedActivities[i];
      const prev = getLatestScheduledGeoPoint(scheduler) || (i === 0 ? hotel : orderedActivities[i - 1]);
      let travelTime = prev ? estimateTravel(prev, activity, directionsCache) : 10;
      // Round travel time to nearest 5 minutes for clean schedule times
      travelTime = Math.round(travelTime / 5) * 5;

      // Day-trip activities: long travel from hotel (by car/bus, not transit)
      if (balancedDay.isDayTrip && i === 0 && hotel) {
        const distKm = calculateDistance(
          hotel.latitude, hotel.longitude,
          activity.latitude, activity.longitude
        );
        // Day trips use car/bus speed (~50km/h average), NOT transit
        travelTime = Math.round((distKm / 50) * 60 / 5) * 5; // Rounded to 5 min
      }

      // Check if it's time for lunch (cursor between 11:30 and 14:30)
      const cursorTime = scheduler.getCurrentTime();
      const cursorHour = cursorTime.getHours() + cursorTime.getMinutes() / 60;

      if (!lunchInserted && !skipLunch && !skipLunchForMealActivity && lunch?.restaurant && cursorHour >= 11.5 && cursorHour < 14.5) {
        const result = scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-lunch`,
          title: `Déjeuner — ${lunch.restaurant.name}`,
          type: 'restaurant',
          duration: 60,
          minStartTime: parseTime(dayDate, '12:00'),
          maxEndTime: parseTime(dayDate, '14:30'),
          data: { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] },
        });
        if (result) lunchInserted = true;
      }

      // Check if it's time for dinner (cursor between 18:30 and 21:00)
      const cursorTime2 = scheduler.getCurrentTime();
      const cursorHour2 = cursorTime2.getHours() + cursorTime2.getMinutes() / 60;

      if (!dinnerInserted && !skipDinner && !skipDinnerForMealActivity && dinner?.restaurant && cursorHour2 >= 18.5 && cursorHour2 < 21) {
        const result = scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-dinner`,
          title: `Dîner — ${dinner.restaurant.name}`,
          type: 'restaurant',
          duration: 75,
          minStartTime: parseTime(dayDate, '19:00'),
          maxEndTime: parseTime(dayDate, '22:00'),
          data: { ...dinner.restaurant, _alternatives: dinner.restaurantAlternatives || [] },
        });
        if (result) dinnerInserted = true;
      }

      // Skip activities that are closed on this day (per-day opening hours)
      if (!isActivityOpenOnDay(activity, dayDate)) {
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Skipping "${activity.name}" — closed on ${DAY_NAMES_EN[dayDate.getDay()]}`);
        continue;
      }

      // Enforce opening/closing hours
      const activityMaxEndTime = getActivityMaxEndTime(activity, dayDate);
      const activityMinStartTime = getActivityMinStartTime(activity, dayDate);

      // Minimum meaningful duration for this activity type (e.g., 60min for museums)
      const actMinDuration = getMinDuration(activity.name || '', activity.type || '');
      // Day-trip activities get extended duration (whole-day excursion)
      const baseActivityDuration = balancedDay.isDayTrip
        ? Math.max(activity.duration || 120, 180) // At least 3h for day-trip activities
        : (activity.duration || 60);
      // Hard floor on final scheduling input to avoid absurdly short iconic visits (e.g. Louvre 60min)
      const activityDuration = Math.max(baseActivityDuration, actMinDuration);

      let actResult = scheduler.addItem({
        id: activity.id,
        title: activity.name,
        type: 'activity',
        duration: activityDuration,
        travelTime,
        minStartTime: activityMinStartTime,
        maxEndTime: activityMaxEndTime,
        minDuration: actMinDuration,
        data: activity,
      });

      // MUST-SEE RETRY: If a must-see was rejected, retry with shorter duration.
      // Keep the same maxEndTime — we don't relax closing hours (a museum that closes at 17:00
      // still closes at 17:00). Uses type-based minimum (e.g., 60min for cathedral, not 30).
      // For large museums (duration >= 120), use 0.7 factor instead of 0.5 to preserve more visit time.
      if (!actResult && activity.mustSee) {
        const reductionFactor = activityDuration >= 120 ? 0.7 : 0.5;
        const shortDuration = Math.max(actMinDuration, Math.floor(activityDuration * reductionFactor));
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Must-see "${activity.name}" rejected at ${activityDuration}min, retrying with ${shortDuration}min (min=${actMinDuration}min, factor=${reductionFactor})`);
        actResult = scheduler.addItem({
          id: activity.id,
          title: activity.name,
          type: 'activity',
          duration: shortDuration,
          travelTime: Math.min(travelTime, 10), // Reduce travel estimate too
          minStartTime: activityMinStartTime,
          maxEndTime: activityMaxEndTime, // Same closing time — no cheating
          minDuration: actMinDuration,
          data: activity,
        });
      }

      // MUST-SEE EVICTION: If must-see still rejected, evict lowest-value non-must-see
      // activity from this day to make room, then retry.
      // Strategy: evict the item that frees the most time, starting from lowest-scored.
      if (!actResult && activity.mustSee) {
        const scheduledItems = scheduler.getItems();
        // Find non-must-see activities currently scheduled (not meals, transport, checkin, checkout)
        const evictCandidates = scheduledItems
          .filter(item => item.type === 'activity' && !(item.data as any)?.mustSee)
          .sort((a, b) => {
            // Evict the one with lowest score first
            const scoreA = (a.data as any)?.score || 0;
            const scoreB = (b.data as any)?.score || 0;
            return scoreA - scoreB;
          });

        for (const candidate of evictCandidates) {
          const removed = scheduler.removeItemById(candidate.id);
          if (!removed) continue;

          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Evicted "${candidate.title}" (score=${(candidate.data as any)?.score || '?'}, slot=${formatTimeHHMM(removed.slot.start)}-${formatTimeHHMM(removed.slot.end)}) to make room for must-see "${activity.name}"`);

          // Retry the must-see — cursor is now at the evicted item's start time
          actResult = scheduler.addItem({
            id: activity.id,
            title: activity.name,
            type: 'activity',
            duration: activityDuration,
            travelTime: Math.min(travelTime, 10),
            minStartTime: activityMinStartTime,
            maxEndTime: activityMaxEndTime,
            minDuration: actMinDuration,
            data: activity,
          });

          // Also try with reduced duration if full doesn't fit
          if (!actResult) {
            const reductionFactor = activityDuration >= 120 ? 0.7 : 0.5;
            const shortDuration = Math.max(actMinDuration, Math.floor(activityDuration * reductionFactor));
            actResult = scheduler.addItem({
              id: activity.id,
              title: activity.name,
              type: 'activity',
              duration: shortDuration,
              travelTime: Math.min(travelTime, 5),
              minStartTime: activityMinStartTime,
              maxEndTime: activityMaxEndTime,
              minDuration: actMinDuration,
              data: activity,
            });
          }

          if (actResult) break; // Success!
          // If still doesn't fit, keep the eviction and try next candidate
        }
      }

      // MUST-SEE RETRY 3: If still rejected after eviction, extend day end by up to 1.5 hours
      if (!actResult && activity.mustSee) {
        const extendedDayEndHour = Math.min(23, dayEndHour + 2);
        const extendedDayEnd = parseTime(dayDate, `${String(extendedDayEndHour).padStart(2, '0')}:00`);

        // Temporarily extend the scheduler's day end
        const originalDayEnd = scheduler['dayEnd']; // Access private field
        (scheduler as any).dayEnd = extendedDayEnd;

        const reductionFactor = activityDuration >= 120 ? 0.7 : 0.5;
        const shortDuration = Math.max(actMinDuration, Math.floor(activityDuration * reductionFactor));

        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Must-see "${activity.name}" RETRY 3 — extending day end to ${extendedDayEndHour}:00 (was ${dayEndHour}:00)`);

        actResult = scheduler.addItem({
          id: activity.id,
          title: activity.name,
          type: 'activity',
          duration: shortDuration,
          travelTime: Math.min(travelTime, 5),
          minStartTime: activityMinStartTime,
          maxEndTime: activityMaxEndTime,
          minDuration: actMinDuration,
          data: activity,
        });

        if (actResult) {
          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ✅ Must-see "${activity.name}" scheduled after day extension to ${extendedDayEndHour}:00`);
          // Keep the extended day end for subsequent activities
          dayEndHour = extendedDayEndHour;
        } else {
          // Restore original day end if retry failed
          (scheduler as any).dayEnd = originalDayEnd;
        }
      }

      if (!actResult) {
        console.warn(`[Pipeline V2] Day ${balancedDay.dayNumber}: REJECTED activity "${activity.name}" (duration=${activityDuration}min, travel=${travelTime}min, cursor=${formatTimeHHMM(scheduler.getCurrentTime())}, dayEnd=${dayEndHour}:00)${activity.mustSee ? ' ⚠️ MUST-SEE LOST' : ''}`);
      }

      // After day-trip activity, add explicit return travel to hotel
      // This prevents dinner from showing 7h travel time from the day-trip location
      if (balancedDay.isDayTrip && hotel && i === orderedActivities.length - 1) {
        const distKm = calculateDistance(
          activity.latitude, activity.longitude,
          hotel.latitude, hotel.longitude
        );
        const returnTravelMin = Math.round((distKm / 50) * 60);
        if (returnTravelMin > 15) {
          scheduler.addItem({
            id: `daytrip-return-${balancedDay.dayNumber}`,
            title: `Retour vers ${preferences.destination}`,
            type: 'transport',
            duration: returnTravelMin,
            travelTime: 0, // Travel IS the item
            data: {
              description: `Retour depuis ${activity.name}`,
              locationName: hotel.name,
              latitude: hotel.latitude,
              longitude: hotel.longitude,
            },
          });
        }
      }
    }

    // 7b. Insert free time slot if the day is busy (restBreak=true or 4+ activities scheduled)
    const scheduledActivityCount = scheduler.getItems().filter(i => i.type === 'activity').length;
    if ((balancedDay.restBreak || scheduledActivityCount >= 4) && !isLastDay) {
      const currentHour = scheduler.getCurrentTime().getHours();
      // Only insert if cursor is in the 13h-17h window (afternoon)
      if (currentHour >= 13 && currentHour < 17) {
        const freeTimeAnchor = getLatestScheduledGeoPoint(scheduler);
        const freeTimeResult = scheduler.addItem({
          id: `free-time-${balancedDay.dayNumber}`,
          title: 'Temps libre',
          type: 'free_time',
          duration: 60,
          minStartTime: parseTime(dayDate, '13:00'),
          maxEndTime: parseTime(dayDate, '17:00'),
          data: {
            name: 'Temps libre',
            description: 'Pause détente — explorez à votre rythme',
            isFreeTime: true,
            estimatedCost: 0,
            latitude: freeTimeAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
            longitude: freeTimeAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
          },
        });
        if (freeTimeResult) {
          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Inserted free time slot (${scheduledActivityCount} activities, restBreak=${balancedDay.restBreak})`);
        }
      }
    }

    // 8. Insert any remaining meals after all activities
    // Uses insertFixedItem to bypass the cursor (which is now past the lunch window).
    // findBestMealSlot() scans gaps between existing items to find the best time.
    if (!lunchInserted && !skipLunch && !skipLunchForMealActivity) {
      const lunchDuration = lunch?.restaurant ? 60 : 45;
      const lunchFallbackAnchor = getLatestScheduledGeoPoint(scheduler);
      const lunchData = lunch?.restaurant
        ? { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] }
        : {
            name: 'Restaurant à proximité',
            description: 'Déjeuner',
            latitude: lunchFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
            longitude: lunchFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
            estimatedCost: 15,
          };
      const lunchTitle = lunch?.restaurant
        ? `Déjeuner — ${lunch.restaurant.name}`
        : 'Déjeuner — Restaurant à proximité';
      const lunchId = lunch?.restaurant
        ? `meal-${balancedDay.dayNumber}-lunch`
        : `self-lunch-${balancedDay.dayNumber}`;

      const slot = findBestMealSlot(scheduler, dayDate, '12:00', '15:00', lunchDuration, '13:00');
      if (slot) {
        const result = scheduler.insertFixedItem({
          id: lunchId,
          title: lunchTitle,
          type: 'restaurant',
          startTime: slot.start,
          endTime: slot.end,
          data: lunchData,
        });
        if (result) {
          lunchInserted = true;
          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Lunch inserted via findBestMealSlot at ${formatTimeHHMM(slot.start)}-${formatTimeHHMM(slot.end)}`);
        }
      }
    }

    if (!dinnerInserted && !skipDinner && !skipDinnerForMealActivity) {
      const dinnerDuration = dinner?.restaurant ? 75 : 60;
      const dinnerFallbackAnchor = getLatestScheduledGeoPoint(scheduler);
      const dinnerData = dinner?.restaurant
        ? { ...dinner.restaurant, _alternatives: dinner.restaurantAlternatives || [] }
        : {
            name: 'Restaurant à proximité',
            description: 'Dîner',
            latitude: dinnerFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
            longitude: dinnerFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
            estimatedCost: 20,
          };
      const dinnerTitle = dinner?.restaurant
        ? `Dîner — ${dinner.restaurant.name}`
        : 'Dîner — Restaurant à proximité';
      const dinnerId = dinner?.restaurant
        ? `meal-${balancedDay.dayNumber}-dinner`
        : `self-dinner-${balancedDay.dayNumber}`;

      const slot = findBestMealSlot(scheduler, dayDate, '19:00', '22:00', dinnerDuration, '20:00');
      if (slot) {
        const result = scheduler.insertFixedItem({
          id: dinnerId,
          title: dinnerTitle,
          type: 'restaurant',
          startTime: slot.start,
          endTime: slot.end,
          data: dinnerData,
        });
        if (result) dinnerInserted = true;
      }
    }

    // 9. Insert return transport LAST (after activities and meals)
    // This prevents the cursor from advancing past dayEnd before activities are placed.
    if (returnTransportData) {
      scheduler.insertFixedItem(returnTransportData);
    }

    // 10. Remove scheduling conflicts (keep higher-priority items)
    scheduler.removeConflicts();

    // 11. Convert to TripItems
    const scheduleItems = scheduler.getItems();
    let tripItems: TripItem[] = scheduleItems.map((item, idx) => {
      const itemData = item.data || {};
      const resolvedTransportMode = item.type === 'transport'
        ? (getTransportModeFromItemData(itemData) || 'transit')
        : undefined;
      const normalizedCoords = normalizeItemCoordinates(item.title, itemData, item.type, preferences.destination);
      // Generate Google Maps "search by name" URL (more reliable than GPS coordinates)
      const placeName = itemData.name || item.title;
      const placeCity = preferences.destination || '';
      const googleMapsPlaceUrl = placeName
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName + ', ' + placeCity)}`
        : undefined;

      const restaurantImageUrl = item.type === 'restaurant'
        ? getRestaurantPrimaryGooglePhoto(itemData)
        : undefined;

      return {
        id: item.id || uuidv4(),
        dayNumber: balancedDay.dayNumber,
        startTime: formatTimeHHMM(item.slot.start),
        endTime: formatTimeHHMM(item.slot.end),
        type: item.type as TripItem['type'],
        title: item.title,
        description: buildDescription(itemData, item.type, wikiDescriptions),
        locationName: itemData.locationName || itemData.address || itemData.name || '',
        latitude: normalizedCoords.latitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lat)
          || 0,
        longitude: normalizedCoords.longitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lng)
          || 0,
        orderIndex: idx,
        estimatedCost: itemData.estimatedCost
          || (item.type === 'flight' ? (itemData.pricePerPerson || itemData.price || 0) : 0)
          || (itemData.priceLevel ? (itemData.priceLevel || 1) * 15 : 0),
        duration: item.duration,
        rating: itemData.rating,
        bookingUrl: itemData.bookingUrl || itemData.googleMapsUrl
          || (item.type === 'restaurant' && (itemData.name || item.title)
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((itemData.name || item.title) + ', ' + preferences.destination)}`
            : undefined),
        viatorUrl: itemData.viatorUrl,
        googleMapsPlaceUrl,
        restaurant: item.type === 'restaurant' ? itemData : undefined,
        restaurantAlternatives: item.type === 'restaurant' && itemData._alternatives?.length > 0
          ? itemData._alternatives
          : undefined,
        accommodation: (item.type === 'checkin' || item.type === 'checkout') ? itemData : undefined,
        flight: item.type === 'flight' ? itemData : undefined,
        // Transport-specific fields (train/bus legs, price range)
        transitLegs: itemData.transitLegs,
        transitDataSource: itemData.transitDataSource,
        priceRange: itemData.priceRange,
        transportMode: resolvedTransportMode,
        transportRole: itemData.transportRole || (item.type === 'transport' ? 'inter_item' : undefined),
        dataReliability: itemData.dataReliability || 'verified',
        imageUrl: restaurantImageUrl
          || (item.type !== 'restaurant' ? (itemData.photos?.[0] || itemData.imageUrl || itemData.photoUrl) : undefined)
          || (item.type === 'flight' ? TRANSPORT_IMAGES.flight : undefined)
          || (item.type === 'transport' ? getTransportImage({ ...itemData, transportMode: resolvedTransportMode }) : undefined),
        // Viator flags (activities only)
        freeCancellation: item.type === 'activity' ? itemData.freeCancellation : undefined,
        instantConfirmation: item.type === 'activity' ? itemData.instantConfirmation : undefined,
      };
    });

    // Intra-day activity dedup (safety net) after scheduler transformations/swaps
    tripItems = dedupeScheduledActivityItems(tripItems, balancedDay.dayNumber);

    // Add explicit morning departure from hotel + evening return to hotel
    // so the daily route is visually complete for users.
    tripItems = addHotelBoundaryTransportItems({
      items: tripItems,
      dayNumber: balancedDay.dayNumber,
      hotel,
      destination: preferences.destination,
      directionsCache,
    });

    // Match weather forecast to this day's date
    const dayDateStr = dayDate.toISOString().split('T')[0];
    const dayWeather = data.weatherForecasts?.find(w => w.date === dayDateStr);

    // Compute daily budget breakdown (€ per person)
    const dailyBudget = computeDailyBudget(tripItems);

    days.push({
      dayNumber: balancedDay.dayNumber,
      date: dayDate,
      items: tripItems,
      theme: balancedDay.theme,
      dayNarrative: balancedDay.dayNarrative,
      isDayTrip: balancedDay.isDayTrip,
      dayTripDestination: balancedDay.dayTripDestination,
      weatherForecast: dayWeather ? {
        condition: dayWeather.condition,
        tempMin: dayWeather.tempMin,
        tempMax: dayWeather.tempMax,
        icon: dayWeather.icon,
      } : undefined,
      dailyBudget,
    });
  }

  // 12. Enrich items missing images (Google Places photo lookup + Wikipedia fallback)
  // Non-critical: wrapped in try/catch so pipeline never fails because of images
  onEvent?.({ type: 'api_call', step: 7, label: 'Google Places Photos', timestamp: Date.now() });
  const tImg = Date.now();
  try {
    await enrichWithPlaceImages(days, preferences.destination);
  } catch (e) {
    console.warn('[Pipeline V2] Image enrichment failed (non-critical):', e);
  }
  onEvent?.({ type: 'api_done', step: 7, label: 'Google Places Photos', durationMs: Date.now() - tImg, timestamp: Date.now() });

  // 12b. Enrich restaurant photos using Google Places Details API (real photos from place_id)
  onEvent?.({ type: 'api_call', step: 7, label: 'Restaurant Photos', timestamp: Date.now() });
  const tResto = Date.now();
  try {
    await enrichRestaurantsWithPhotos(days, preferences.destination);
  } catch (e) {
    console.warn('[Pipeline V2] Restaurant photo enrichment failed (non-critical):', e);
  }
  onEvent?.({ type: 'api_done', step: 7, label: 'Restaurant Photos', durationMs: Date.now() - tResto, timestamp: Date.now() });

  // 13. Batch fetch directions (non-blocking enrichment, 20s max)
  onEvent?.({ type: 'api_call', step: 7, label: 'Google Directions', timestamp: Date.now() });
  const tDir = Date.now();
  try {
    const directionsTimeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[Pipeline V2] ⚠️ Directions enrichment timeout (20s) — continuing');
        resolve();
      }, 20_000);
    });
    await Promise.race([
      enrichWithDirections(days, directionsCache),
      directionsTimeout,
    ]);
  } catch (e) {
    console.warn('[Pipeline V2] Directions enrichment failed:', e);
  }
  onEvent?.({ type: 'api_done', step: 7, label: 'Google Directions', durationMs: Date.now() - tDir, timestamp: Date.now() });

  // 13a. Post-schedule restaurant distance re-check
  // After scheduling + directions enrichment, some restaurants may be far from their
  // actual schedule neighbors (because the re-opt was computed before activities were
  // rejected/reordered by the scheduler). Swap them from the pool if possible.
  // Strategy: consider BOTH prev and next neighbors, use midpoint for transition meals,
  // widen search radius, and fallback to SerpAPI if pool has nothing.
  {
    const fullPool = restaurantGeoPool || [];
    // Track used restaurant names across all days to avoid cross-day duplicates
    const usedNames = new Set<string>();
    const usedIds = new Set<string>();
    for (const d of days) {
      for (const item of d.items) {
        if (item.type === 'restaurant') {
          usedIds.add(item.id);
          if (item.restaurant?.name) usedNames.add(item.restaurant.name);
          else if (item.locationName) usedNames.add(item.locationName);
        }
      }
    }

    // Collect problematic restaurants first (before async operations)
    const swapCandidates: { day: typeof days[0]; itemIdx: number; refLat: number; refLng: number; currentDist: number; mealType: 'breakfast' | 'lunch' | 'dinner' }[] = [];

    for (const day of days) {
      for (let i = 0; i < day.items.length; i++) {
        const item = day.items[i];
        if (item.type !== 'restaurant') continue;
        if (!item.latitude || !item.longitude || item.latitude === 0) continue;

        // Find nearest activity neighbors (scan across transport/checkin/checkouts).
        // If none exist on one side, fallback to nearest checkin/checkout on that side.
        const findPrev = (predicate: (candidate: TripItem) => boolean): TripItem | null => {
          for (let idx = i - 1; idx >= 0; idx--) {
            const candidate = day.items[idx];
            if (!candidate.latitude || !candidate.longitude || candidate.latitude === 0 || candidate.longitude === 0) continue;
            if (predicate(candidate)) return candidate;
          }
          return null;
        };
        const findNext = (predicate: (candidate: TripItem) => boolean): TripItem | null => {
          for (let idx = i + 1; idx < day.items.length; idx++) {
            const candidate = day.items[idx];
            if (!candidate.latitude || !candidate.longitude || candidate.latitude === 0 || candidate.longitude === 0) continue;
            if (predicate(candidate)) return candidate;
          }
          return null;
        };

        const prevActivity = findPrev((candidate) => candidate.type === 'activity');
        const nextActivity = findNext((candidate) => candidate.type === 'activity');
        const prevLogistic = findPrev((candidate) => candidate.type === 'checkin' || candidate.type === 'checkout');
        const nextLogistic = findNext((candidate) => candidate.type === 'checkin' || candidate.type === 'checkout');

        const validPrev = prevActivity || (!nextActivity ? prevLogistic : null);
        const validNext = nextActivity || (!prevActivity ? nextLogistic : null);

        if (!validPrev && !validNext) continue;

        // Compute distance to the closest neighbor
        const distPrev = validPrev ? calculateDistance(validPrev.latitude, validPrev.longitude, item.latitude, item.longitude) : Infinity;
        const distNext = validNext ? calculateDistance(validNext.latitude, validNext.longitude, item.latitude, item.longitude) : Infinity;
        const minDist = Math.min(distPrev, distNext);

        if (minDist <= 1.5) continue; // Within 1.5km — acceptable

        // Determine the reference point for searching:
        // - If both neighbors exist and are far apart (>3km), use midpoint (lunch between clusters)
        // - Otherwise use the closer neighbor
        let refLat: number, refLng: number;
        if (validPrev && validNext) {
          const interNeighborDist = calculateDistance(validPrev.latitude, validPrev.longitude, validNext.latitude, validNext.longitude);
          if (interNeighborDist > 3) {
            // Transition meal between distant clusters — search near midpoint
            refLat = (validPrev.latitude + validNext.latitude) / 2;
            refLng = (validPrev.longitude + validNext.longitude) / 2;
          } else {
            // Both nearby — use the closer neighbor
            const closer = distPrev <= distNext ? validPrev : validNext;
            refLat = closer.latitude;
            refLng = closer.longitude;
          }
        } else {
          const only = validPrev || validNext!;
          refLat = only.latitude;
          refLng = only.longitude;
        }

        const mealType = item.title.includes('Petit-déjeuner') ? 'breakfast' as const : item.title.includes('Déjeuner') ? 'lunch' as const : 'dinner' as const;

        // Phase 1: Search pool with wider radius (1.5km instead of 1.0km)
        let bestR: Restaurant | null = null;
        let bestDist = minDist;
        for (const r of fullPool) {
          if (!r.latitude || !r.longitude) continue;
          if (usedIds.has(r.id) || usedNames.has(r.name)) continue;
          if (!isAppropriateForMeal(r, mealType)) continue;
          if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
          const rDist = calculateDistance(refLat, refLng, r.latitude, r.longitude);
          if (rDist < bestDist && rDist < 1.5) {
            bestDist = rDist;
            bestR = r;
          }
        }

        if (bestR) {
          console.log(`[Pipeline V2] Post-schedule re-opt: Day ${day.dayNumber} "${item.title}" (${minDist.toFixed(1)}km from neighbor) → "${bestR.name}" (${bestDist.toFixed(1)}km from ref)`);
          const oldName = item.restaurant?.name || item.locationName;
          if (oldName) usedNames.delete(oldName);
          usedNames.add(bestR.name);
          usedIds.add(bestR.id);
          item.title = item.title.replace(/—\s+.+$/, `— ${bestR.name}`);
          item.latitude = bestR.latitude!;
          item.longitude = bestR.longitude!;
          item.locationName = bestR.name;
          item.rating = bestR.rating;
          item.estimatedCost = bestR.priceLevel ? (bestR.priceLevel || 1) * 15 : item.estimatedCost;
          item.bookingUrl = bestR.googleMapsUrl || bestR.website;
          item.restaurant = bestR;
          item.restaurantAlternatives = []; // Clear stale alts — section 13b will refill
          // Restaurant changed: clear previous image so we don't keep a stale photo.
          item.imageUrl = undefined;
          item.distanceFromPrevious = bestDist;
          item.timeFromPrevious = Math.max(5, Math.round(bestDist * 12));
          item.transportToPrevious = inferInterItemTransportMode(item.distanceFromPrevious, item.timeFromPrevious);
        } else {
          // Phase 2: No pool match — queue for SerpAPI fallback
          swapCandidates.push({ day, itemIdx: i, refLat, refLng, currentDist: minDist, mealType });
        }
      }
    }

    // Phase 2: SerpAPI fallback for restaurants that couldn't be swapped from pool
    if (swapCandidates.length > 0) {
      console.log(`[Pipeline V2] Post-schedule: ${swapCandidates.length} restaurant(s) still far — trying SerpAPI nearby search`);
      const apiResults = await Promise.allSettled(
        swapCandidates.map(c =>
          searchRestaurantsNearby(
            { lat: c.refLat, lng: c.refLng },
            preferences.destination,
            { mealType: c.mealType, maxDistance: 1500, limit: 5 }
          ).catch(() => [] as Restaurant[])
        )
      );

      for (let ci = 0; ci < swapCandidates.length; ci++) {
        const c = swapCandidates[ci];
        const result = apiResults[ci];
        const candidates = result.status === 'fulfilled' ? result.value : [];
        if (!candidates || candidates.length === 0) continue;

        // Pick the closest candidate that's not already used
        let bestR: Restaurant | null = null;
        let bestDist = c.currentDist;
        for (const r of candidates) {
          if (!r.latitude || !r.longitude) continue;
          if (usedIds.has(r.id) || usedNames.has(r.name)) continue;
          if (!isAppropriateForMeal(r, c.mealType)) continue; // Prevent pizza/heavy meals for breakfast
          if (c.mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
          const rDist = calculateDistance(c.refLat, c.refLng, r.latitude, r.longitude);
          if (rDist < bestDist && rDist < 2.0) {
            bestDist = rDist;
            bestR = r;
          }
        }

        if (bestR) {
          const item = c.day.items[c.itemIdx];
          console.log(`[Pipeline V2] Post-schedule SerpAPI re-opt: Day ${c.day.dayNumber} "${item.title}" (${c.currentDist.toFixed(1)}km) → "${bestR.name}" (${bestDist.toFixed(1)}km from ref)`);
          const oldName = item.restaurant?.name || item.locationName;
          if (oldName) usedNames.delete(oldName);
          usedNames.add(bestR.name);
          usedIds.add(bestR.id);
          item.title = item.title.replace(/—\s+.+$/, `— ${bestR.name}`);
          item.latitude = bestR.latitude!;
          item.longitude = bestR.longitude!;
          item.locationName = bestR.name;
          item.rating = bestR.rating;
          item.estimatedCost = bestR.priceLevel ? (bestR.priceLevel || 1) * 15 : item.estimatedCost;
          item.bookingUrl = bestR.googleMapsUrl || bestR.website;
          item.restaurant = bestR;
          item.restaurantAlternatives = []; // Clear stale alts — section 13b will refill
          // Restaurant changed: clear previous image so we don't keep a stale photo.
          item.imageUrl = undefined;
          item.distanceFromPrevious = bestDist;
          item.timeFromPrevious = Math.max(5, Math.round(bestDist * 12));
          item.transportToPrevious = inferInterItemTransportMode(item.distanceFromPrevious, item.timeFromPrevious);
          // Also add to pool for future reference
          fullPool.push(bestR);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 13c. Restaurant alternatives refill pass
  // After all swaps (section 13a), ensure every restaurant TripItem has 2
  // cuisine-diverse alternatives. In European cities this is mandatory;
  // in isolated destinations (< 2 pool candidates within 3km), skip.
  // -------------------------------------------------------------------------
  {
    const altPool = restaurantGeoPool || [];
    const ALT_SEARCH_RADIUS_KM = 1.5;
    const ISOLATED_THRESHOLD_KM = 3.0;
    const TARGET_ALTS = 2;

    // Build global used set from ALL restaurant items across ALL days
    const globalUsedIds = new Set<string>();
    const globalUsedNames = new Set<string>();
    for (const day of days) {
      for (const item of day.items) {
        if (item.type === 'restaurant' && item.restaurant) {
          globalUsedIds.add(item.restaurant.id || item.id);
          if (item.restaurant.name) globalUsedNames.add(item.restaurant.name);
        }
      }
    }

    let refillCount = 0;
    let apiCallCount = 0;

    for (const day of days) {
      for (const item of day.items) {
        if (item.type !== 'restaurant') continue;
        if (!item.restaurant) continue;
        if (!item.latitude || !item.longitude || item.latitude === 0) continue;

        const currentAlts = item.restaurantAlternatives || [];
        if (currentAlts.length >= TARGET_ALTS) continue; // Already has enough

        const mealType: 'breakfast' | 'lunch' | 'dinner' =
          item.title.includes('Petit-déjeuner') ? 'breakfast' :
          item.title.includes('Déjeuner') ? 'lunch' : 'dinner';

        const refLat = item.latitude;
        const refLng = item.longitude;

        // Check if isolated location (< 2 pool candidates within 3km)
        let nearbyPoolCount = 0;
        for (const r of altPool) {
          if (!r.latitude || !r.longitude) continue;
          if (calculateDistance(refLat, refLng, r.latitude, r.longitude) <= ISOLATED_THRESHOLD_KM) {
            nearbyPoolCount++;
            if (nearbyPoolCount >= 2) break; // No need to count further
          }
        }
        if (nearbyPoolCount < 2) continue; // Isolated — don't force alternatives

        // Collect candidates from pool
        const primaryFamily = getCuisineFamily(item.restaurant);
        const currentAltIds = new Set(currentAlts.map((a: Restaurant) => a.id));
        const currentAltFamilies = new Set(currentAlts.map((a: Restaurant) => getCuisineFamily(a)));
        currentAltFamilies.add(primaryFamily);

        const candidates: { r: Restaurant; dist: number; family: string }[] = [];
        for (const r of altPool) {
          if (r.id === (item.restaurant.id || item.id)) continue;
          if (currentAltIds.has(r.id)) continue;
          if (globalUsedIds.has(r.id) || globalUsedNames.has(r.name)) continue;
          if (!r.latitude || !r.longitude) continue;
          if (!isAppropriateForMeal(r, mealType)) continue;
          if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
          const dist = calculateDistance(refLat, refLng, r.latitude, r.longitude);
          if (dist <= ALT_SEARCH_RADIUS_KM) {
            candidates.push({ r, dist, family: getCuisineFamily(r) });
          }
        }
        candidates.sort((a, b) => a.dist - b.dist);

        const newAlts: Restaurant[] = [...currentAlts];
        const usedFamilies = new Set(currentAltFamilies);

        // Pass 1: pick diverse cuisines first
        for (const c of candidates) {
          if (newAlts.length >= TARGET_ALTS) break;
          if (!usedFamilies.has(c.family)) {
            newAlts.push(c.r);
            usedFamilies.add(c.family);
          }
        }
        // Pass 2: fill remaining with closest
        for (const c of candidates) {
          if (newAlts.length >= TARGET_ALTS) break;
          if (!newAlts.some((a: Restaurant) => a.id === c.r.id)) {
            newAlts.push(c.r);
          }
        }

        // If pool didn't have enough, try SerpAPI (max 2 API calls total)
        if (newAlts.length < TARGET_ALTS && apiCallCount < 2) {
          try {
            apiCallCount++;
            const apiResults = await searchRestaurantsNearby(
              { lat: refLat, lng: refLng },
              preferences.destination,
              { mealType, maxDistance: 1500, limit: 5 }
            );
            if (apiResults.length > 0) altPool.push(...apiResults);

            for (const r of apiResults) {
              if (newAlts.length >= TARGET_ALTS) break;
              if (r.id === (item.restaurant.id || item.id)) continue;
              if (newAlts.some((a: Restaurant) => a.id === r.id)) continue;
              if (globalUsedNames.has(r.name)) continue;
              if (!r.latitude || !r.longitude) continue;
              if (!isAppropriateForMeal(r, mealType)) continue;
              if (mealType === 'breakfast' && !isBreakfastSpecialized(r)) continue;
              const dist = calculateDistance(refLat, refLng, r.latitude, r.longitude);
              if (dist <= ALT_SEARCH_RADIUS_KM) {
                const family = getCuisineFamily(r);
                if (!usedFamilies.has(family)) {
                  newAlts.push(r);
                  usedFamilies.add(family);
                } else if (newAlts.length < TARGET_ALTS) {
                  newAlts.push(r);
                }
              }
            }
          } catch (err) {
            console.warn(`[Pipeline V2] Alternatives refill API failed:`, err);
          }
        }

        if (newAlts.length > currentAlts.length) {
          item.restaurantAlternatives = newAlts.slice(0, TARGET_ALTS);
          refillCount++;
        }
      }
    }

    if (refillCount > 0) {
      console.log(`[Pipeline V2] Section 13c: Refilled alternatives for ${refillCount} restaurant(s) (${apiCallCount} API calls)`);
    }
  }

  // 13c-bis. Some restaurants are replaced after the first photo enrichment pass.
  // Re-run restaurant image enrichment to avoid stale or non-Google photos.
  onEvent?.({ type: 'api_call', step: 7, label: 'Restaurant Photos (post-swap)', timestamp: Date.now() });
  const tRestoPostSwap = Date.now();
  try {
    await enrichRestaurantsWithPhotos(days, preferences.destination);
  } catch (e) {
    console.warn('[Pipeline V2] Post-swap restaurant photo enrichment failed (non-critical):', e);
  }
  onEvent?.({
    type: 'api_done',
    step: 7,
    label: 'Restaurant Photos (post-swap)',
    durationMs: Date.now() - tRestoPostSwap,
    timestamp: Date.now(),
  });

  // ---------------------------------------------------------------------------
  // 13d. Opening hours validation — check activities are open at scheduled time
  // ---------------------------------------------------------------------------
  // Build a lookup from activity ID to ScoredActivity (for opening hours data)
  {
    const activityLookup = new Map<string, ScoredActivity>();
    for (const cluster of clusters) {
      for (const act of cluster.activities) {
        activityLookup.set(act.id, act);
      }
    }

    let validatedCount = 0;
    let conflictCount = 0;
    let swapCount = 0;
    let warnCount = 0;

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
      const day = days[dayIdx];
      const dayDate = day.date instanceof Date ? day.date : new Date(day.date);

      for (let itemIdx = 0; itemIdx < day.items.length; itemIdx++) {
        const item = day.items[itemIdx];
        if (item.type !== 'activity') continue;

        const activity = activityLookup.get(item.id);
        if (!activity) continue;

        // Skip if no opening hours data at all (nothing to validate)
        if (!activity.openingHoursByDay && !activity.openingHours) continue;

        validatedCount++;

        if (isOpenAtTime(activity, dayDate, item.startTime, item.endTime)) continue;

        // This activity has a conflict — it's closed or outside hours
        conflictCount++;
        const dayName = DAY_NAMES_EN[dayDate.getDay()];
        const closedOnDay = !isActivityOpenOnDay(activity, dayDate);
        const reason = closedOnDay
          ? `closed on ${dayName}`
          : `outside hours (scheduled ${item.startTime}-${item.endTime})`;

        console.warn(`[Pipeline V2] Opening hours conflict: "${item.title}" on day ${day.dayNumber} (${dayName}) — ${reason}`);

        // Only attempt swap if the venue is CLOSED that day (not just outside hours —
        // time-of-day mismatches are harder to fix without rescheduling the full day)
        if (!closedOnDay) {
          warnCount++;
          continue;
        }

        // Try to SWAP with a same-type activity from another day where this one IS open
        let swapped = false;
        for (let otherDayIdx = 0; otherDayIdx < days.length; otherDayIdx++) {
          if (otherDayIdx === dayIdx) continue;
          const otherDay = days[otherDayIdx];
          const otherDayDate = otherDay.date instanceof Date ? otherDay.date : new Date(otherDay.date);

          // Check if the conflicting activity would be open on the other day
          if (!isActivityOpenOnDay(activity, otherDayDate)) continue;

          // Find a swap candidate in the other day: an activity that is open on the current day
          for (let otherItemIdx = 0; otherItemIdx < otherDay.items.length; otherItemIdx++) {
            const otherItem = otherDay.items[otherItemIdx];
            if (otherItem.type !== 'activity') continue;

            const otherActivity = activityLookup.get(otherItem.id);
            if (!otherActivity) continue;

            // The other activity must be open on the current day (where we'd move it)
            if (!isActivityOpenOnDay(otherActivity, dayDate)) continue;

            // Also check time-slot compatibility (the other activity at the current slot)
            if (!isOpenAtTime(otherActivity, dayDate, item.startTime, item.endTime)) continue;
            // And the conflicting activity at the other slot
            if (!isOpenAtTime(activity, otherDayDate, otherItem.startTime, otherItem.endTime)) continue;

            // Swap the two items: exchange their positions in the days arrays
            // Preserve time slots (startTime, endTime, orderIndex) but swap content
            const savedStartTime = item.startTime;
            const savedEndTime = item.endTime;
            const savedOrderIndex = item.orderIndex;
            const savedDayNumber = item.dayNumber;

            // Move item properties (keep schedule position, swap content)
            const itemKeys: (keyof TripItem)[] = [
              'id', 'title', 'description', 'locationName',
              'latitude', 'longitude', 'estimatedCost', 'duration',
              'imageUrl', 'bookingUrl', 'viatorUrl', 'rating',
              'googleMapsPlaceUrl', 'freeCancellation', 'instantConfirmation',
              'dataReliability',
            ];

            const tempValues: Partial<TripItem> = {};
            for (const key of itemKeys) {
              (tempValues as any)[key] = item[key];
            }

            for (const key of itemKeys) {
              (item as any)[key] = otherItem[key];
            }
            item.startTime = savedStartTime;
            item.endTime = savedEndTime;
            item.orderIndex = savedOrderIndex;
            item.dayNumber = savedDayNumber;

            const otherSavedStartTime = otherItem.startTime;
            const otherSavedEndTime = otherItem.endTime;
            const otherSavedOrderIndex = otherItem.orderIndex;
            const otherSavedDayNumber = otherItem.dayNumber;

            for (const key of itemKeys) {
              (otherItem as any)[key] = (tempValues as any)[key];
            }
            otherItem.startTime = otherSavedStartTime;
            otherItem.endTime = otherSavedEndTime;
            otherItem.orderIndex = otherSavedOrderIndex;
            otherItem.dayNumber = otherSavedDayNumber;

            swapped = true;
            swapCount++;
            console.log(`[Pipeline V2] Opening hours swap: "${tempValues.title}" (day ${day.dayNumber}) <-> "${item.title}" (day ${otherDay.dayNumber})`);
            break;
          }
          if (swapped) break;
        }

        if (!swapped) {
          warnCount++;
          console.warn(`[Pipeline V2] Could not reschedule "${item.title}" (day ${day.dayNumber}, ${dayName}) — no valid swap found`);
        }
      }
    }

    if (validatedCount > 0) {
      console.log(`[Pipeline V2] Section 13d: Opening hours validated ${validatedCount} activities — ${conflictCount} conflicts, ${swapCount} swaps, ${warnCount} unresolved`);
    }
  }

  // 13e. Activity outlier correction (cross-day swap, adjacent days only)
  // Reduces large intra-day jumps without breaking existing time slots.
  try {
    const swapCount = rebalanceActivityOutliersAcrossAdjacentDays(days);
    if (swapCount > 0) {
      refreshRouteMetadataAfterMutations(days, directionsCache);
      console.log(`[Pipeline V2] Section 13e: ${swapCount} activity outlier swap(s) applied`);
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13e failed (non-critical):', error);
  }

  // 13f. Final route metadata coherence pass after all swaps/re-orders.
  refreshRouteMetadataAfterMutations(days, directionsCache);

  // 13. Build cost breakdown
  const costBreakdown = computeCostBreakdown(days, flights, hotel, preferences, transport);

  // 13b. Enrich hotel booking URLs with actual dates and guest count
  const checkinDate = startDate.toISOString().split('T')[0];
  const checkoutDate = new Date(startDate);
  checkoutDate.setDate(checkoutDate.getDate() + preferences.durationDays - 1);
  const checkoutDateStr = checkoutDate.toISOString().split('T')[0];
  const guests = preferences.groupSize || 2;

  const enrichBookingUrl = (url: string | undefined, hotelName: string): string => normalizeHotelBookingUrl({
    url,
    hotelName,
    destinationHint: preferences.destination,
    checkIn: checkinDate,
    checkOut: checkoutDateStr,
    adults: guests,
  });

  if (hotel) {
    hotel.bookingUrl = enrichBookingUrl(hotel.bookingUrl, hotel.name);
  }
  // Also enrich alternative hotel options
  if (data.bookingHotels) {
    for (const hotelOption of data.bookingHotels) {
      hotelOption.bookingUrl = enrichBookingUrl(hotelOption.bookingUrl, hotelOption.name || '');
    }
  }

  // 14. Assemble final Trip
  const trip: Trip = {
    id: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days,
    transportOptions: data.transportOptions,
    selectedTransport: transport || undefined,
    outboundFlight: flights.outbound || undefined,
    returnFlight: flights.return || undefined,
    accommodation: hotel || undefined,
    accommodationOptions: data.bookingHotels?.slice(0, 5),
    totalEstimatedCost: costBreakdown.total,
    costBreakdown: costBreakdown.breakdown,
    travelTips: data.travelTips,
    budgetStrategy: data.budgetStrategy,
    attractionPool: [], // populated below (trimmed to reduce payload)
  };

  // 15. Compute alternative activities (scored but not scheduled, top 20 by score)
  // Also build a trimmed attractionPool (top 40 by score) to keep the JSON payload small.
  const scheduledIds = new Set(
    days.flatMap(d => d.items.filter(i => i.type === 'activity').map(i => i.id))
  );
  const allPoolActivities = clusters.flatMap(c => c.activities);
  const sortedPool = allPoolActivities.sort((a, b) => (b.score || 0) - (a.score || 0));

  // attractionPool: top 40 pour le swap/insert (au lieu de tout le pool qui peut être 100+)
  trip.attractionPool = sortedPool.slice(0, 40);

  trip.alternativeActivities = sortedPool
    .filter(a => !scheduledIds.has(a.id))
    .slice(0, 20);

  sanitizeTripMediaAndSecrets(trip);

  console.log(`[Pipeline V2] Step 7: ${trip.alternativeActivities.length} alternatives, pool trimmed to ${trip.attractionPool.length}/${allPoolActivities.length}`);

  return trip;
}

/**
 * Reorder activities according to Claude's specified order.
 */
function reorderByPlan(
  cluster: ActivityCluster | undefined,
  activityOrder: string[]
): ScoredActivity[] {
  if (!cluster) return [];
  if (!activityOrder || activityOrder.length === 0) return cluster.activities;

  const activityMap = new Map(cluster.activities.map(a => [a.id, a]));
  const ordered: ScoredActivity[] = [];

  // First: add in Claude's specified order
  for (const id of activityOrder) {
    const activity = activityMap.get(id);
    if (activity) {
      ordered.push(activity);
      activityMap.delete(id);
    }
  }

  // Then: add any remaining (Claude may not list all IDs)
  for (const remaining of activityMap.values()) {
    ordered.push(remaining);
  }

  return ordered;
}

/**
 * Compute start/end times for ground transport (train, bus, car).
 * Uses real HAFAS departure/arrival if available, otherwise estimates.
 */
function getGroundTransportTimes(
  transport: TransportOptionSummary,
  dayDate: Date,
  direction: 'outbound' | 'return'
): { start: Date; end: Date } {
  if (direction === 'outbound' && transport.transitLegs?.length) {
    // Outbound: use real HAFAS departure/arrival times
    const firstLeg = transport.transitLegs[0];
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
    const realDep = new Date(firstLeg.departure);
    const realArr = new Date(lastLeg.arrival);
    // Start 30min before first departure (time to get to station)
    return {
      start: new Date(realDep.getTime() - 30 * 60 * 1000),
      end: realArr,
    };
  }

  // Return direction OR no real legs — estimate based on total duration
  if (direction === 'outbound') {
    const estStart = parseTime(dayDate, '08:00');
    return {
      start: estStart,
      end: new Date(estStart.getTime() + transport.totalDuration * 60 * 1000),
    };
  } else {
    // Return: always estimate based on the return day date
    // Transit legs have outbound dates and are unreliable for return
    const durationHours = (transport.totalDuration || 120) / 60;
    const depHour = durationHours > 4 ? 14 : 15;
    const estStart = parseTime(dayDate, `${String(depHour).padStart(2, '0')}:00`);
    return {
      start: estStart,
      end: new Date(estStart.getTime() + transport.totalDuration * 60 * 1000),
    };
  }
}

// ---------------------------------------------------------------------------
// Prefetch real Google Directions for all consecutive activity pairs
// ---------------------------------------------------------------------------

/**
 * Collect all consecutive coordinate pairs for a set of days.
 * For each day: hotel→act[0], act[0]→act[1], ..., act[n]→hotel (return leg).
 */
function collectDirectionPairs(
  dayActivities: Map<number, ScoredActivity[]>,
  hotelLat: number,
  hotelLng: number
): Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number }> {
  const pairs: Array<{ fromLat: number; fromLng: number; toLat: number; toLng: number }> = [];
  const seen = new Set<string>();

  const addPair = (fLat: number, fLng: number, tLat: number, tLng: number) => {
    if (!fLat || !fLng || !tLat || !tLng) return;
    const key = directionsCacheKey(fLat, fLng, tLat, tLng);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ fromLat: fLat, fromLng: fLng, toLat: tLat, toLng: tLng });
  };

  for (const [, activities] of dayActivities) {
    if (activities.length === 0) continue;

    // hotel → first activity
    addPair(hotelLat, hotelLng, activities[0].latitude, activities[0].longitude);

    // consecutive activity pairs
    for (let i = 0; i < activities.length - 1; i++) {
      addPair(
        activities[i].latitude, activities[i].longitude,
        activities[i + 1].latitude, activities[i + 1].longitude
      );
    }

    // last activity → hotel (for 2-opt return cost)
    const last = activities[activities.length - 1];
    addPair(last.latitude, last.longitude, hotelLat, hotelLng);
  }

  return pairs;
}

/**
 * Batch-fetch Google Directions for all collected pairs.
 * Concurrency: 5 parallel requests.
 * Global timeout: 15s for the whole batch.
 */
async function prefetchDirectionsForDays(
  dayActivities: Map<number, ScoredActivity[]>,
  hotelLat: number,
  hotelLng: number
): Promise<DirectionsCache> {
  const cache: DirectionsCache = new Map();
  const pairs = collectDirectionPairs(dayActivities, hotelLat, hotelLng);

  if (pairs.length === 0) return cache;

  console.log(`[Pipeline V2] Prefetching directions for ${pairs.length} pairs...`);

  const fetchWork = async () => {
    // Process in batches of 5 (concurrency limit)
    for (let batch = 0; batch < pairs.length; batch += 5) {
      const batchPairs = pairs.slice(batch, batch + 5);
      const results = await Promise.allSettled(
        batchPairs.map(({ fromLat, fromLng, toLat, toLng }) =>
          getDirections({
            from: { lat: fromLat, lng: fromLng },
            to: { lat: toLat, lng: toLng },
            mode: 'transit',
          })
        )
      );

      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          const dir = (results[i] as PromiseFulfilledResult<any>).value;
          if (dir && typeof dir.duration === 'number') {
            const p = batchPairs[i];
            const key = directionsCacheKey(p.fromLat, p.fromLng, p.toLat, p.toLng);
            cache.set(key, { duration: dir.duration, distance: dir.distance });
          }
        }
      }
    }
  };

  try {
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[Pipeline V2] Directions prefetch timeout (15s) — using partial cache');
        resolve();
      }, 15_000);
    });
    await Promise.race([fetchWork(), timeout]);
  } catch (e) {
    console.warn('[Pipeline V2] Directions prefetch failed (non-critical):', e);
  }

  console.log(`[Pipeline V2] Directions cache: ${cache.size}/${pairs.length} pairs fetched`);
  return cache;
}

// ---------------------------------------------------------------------------
// 2-opt re-optimization with real travel times from cache
// ---------------------------------------------------------------------------

/**
 * Re-run 2-opt on already-ordered activities using cached real travel times.
 * Falls back to Haversine for pairs not in the cache.
 * Does NOT re-run the full multi-start greedy — only the 2-opt improvement.
 */
function reoptimizeWithRealTimes(
  activities: ScoredActivity[],
  startLat: number,
  startLng: number,
  cache: DirectionsCache
): ScoredActivity[] {
  if (activities.length <= 2 || cache.size === 0) return activities;

  // Cost function using cached real times, falling back to Haversine distance
  const realCost = (route: ScoredActivity[]): number => {
    if (route.length === 0) return 0;

    let total = 0;
    let maxLeg = 0;
    let longLegPenalty = 0;

    // Helper: get travel time in minutes for a pair, using cache or Haversine fallback
    const travelMinutes = (fLat: number, fLng: number, tLat: number, tLng: number): number => {
      const key = directionsCacheKey(fLat, fLng, tLat, tLng);
      const cached = cache.get(key);
      if (cached) return cached.duration;
      // Fallback to Haversine-based estimate (same logic as estimateTravel)
      const distKm = calculateDistance(fLat, fLng, tLat, tLng);
      const ROAD_CORRECTION = 1.4;
      if (distKm < 1) return Math.max(5, Math.round(distKm * ROAD_CORRECTION * 12));
      if (distKm < 3) return Math.round(distKm * ROAD_CORRECTION * 8);
      if (distKm < 15) return Math.round(distKm * ROAD_CORRECTION * 4);
      return Math.round((distKm * ROAD_CORRECTION / 50) * 60);
    };

    // hotel → first
    const firstLeg = travelMinutes(startLat, startLng, route[0].latitude, route[0].longitude);
    total += firstLeg;
    maxLeg = Math.max(maxLeg, firstLeg);
    if (firstLeg > 20) longLegPenalty += (firstLeg - 20) * 1.4;

    // inter-activity legs
    for (let i = 1; i < route.length; i++) {
      const leg = travelMinutes(
        route[i - 1].latitude, route[i - 1].longitude,
        route[i].latitude, route[i].longitude
      );
      total += leg;
      maxLeg = Math.max(maxLeg, leg);
      if (leg > 20) longLegPenalty += (leg - 20) * 1.4;
    }

    // last activity → hotel (return leg, weighted 0.5)
    const lastAct = route[route.length - 1];
    const returnLeg = travelMinutes(lastAct.latitude, lastAct.longitude, startLat, startLng);
    total += returnLeg * 0.5;

    const maxLegPenalty = Math.max(0, maxLeg - 25) * 2.5;
    return total + longLegPenalty + maxLegPenalty;
  };

  // 2-opt improvement loop
  let route = [...activities];
  let bestCost = realCost(route);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 2; i++) {
      for (let k = i + 1; k < route.length - 1; k++) {
        const nextRoute = [
          ...route.slice(0, i + 1),
          ...route.slice(i + 1, k + 1).reverse(),
          ...route.slice(k + 1),
        ];
        const nextCost = realCost(nextRoute);
        if (nextCost + 0.5 < bestCost) { // 0.5min threshold to avoid noise swaps
          route = nextRoute;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
  }

  return route;
}

/**
 * Estimate travel time between two locations using Haversine.
 * For long distances (>15km, e.g. day-trip return), uses car/bus speed.
 * If a directions cache is provided, uses cached real times when available.
 */
function estimateTravel(from: any, to: any, directionsCache?: DirectionsCache): number {
  const fromLat = from?.latitude || from?.lat;
  const fromLng = from?.longitude || from?.lng;
  const toLat = to?.latitude || to?.lat;
  const toLng = to?.longitude || to?.lng;

  if (!fromLat || !fromLng || !toLat || !toLng) return 10;

  // Check directions cache first
  if (directionsCache) {
    const key = directionsCacheKey(fromLat, fromLng, toLat, toLng);
    const cached = directionsCache.get(key);
    if (cached) return cached.duration;
  }

  const distKm = calculateDistance(fromLat, fromLng, toLat, toLng);

  // Road correction: real road distances are ~40% longer than Haversine (straight line)
  const ROAD_CORRECTION = 1.4;

  // Walking: ~5km/h → 12min/km
  // Mixed walking+transit: ~8min/km
  // Urban transit: ~15km/h → 4min/km
  // Car/intercity: ~50km/h → 1.2min/km
  if (distKm < 1) return Math.max(5, Math.round(distKm * ROAD_CORRECTION * 12));
  if (distKm < 3) return Math.round(distKm * ROAD_CORRECTION * 8);
  if (distKm < 15) return Math.round(distKm * ROAD_CORRECTION * 4);
  // Long distance: car/bus speed (day-trip returns, inter-city)
  return Math.round((distKm * ROAD_CORRECTION / 50) * 60);
}

/**
 * Check if an activity is a day-trip (far from city center).
 */
// Import shared keyword lists (single source of truth)
import { OUTDOOR_ACTIVITY_KEYWORDS, INDOOR_ACTIVITY_KEYWORDS, getMinDuration } from './utils/constants';

/**
 * Get maximum end time for an activity based on its type.
 * Outdoor activities (parks, gardens) get a 19:30 cap.
 * Indoor activities have no special cap.
 */
const DAY_NAMES_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Get the opening hours for an activity on a specific day.
 * Priority: per-day hours (openingHoursByDay) > default hours (openingHours).
 * Returns null if the activity is CLOSED that day.
 */
function getActivityHoursForDay(activity: ScoredActivity, dayDate: Date): { open: string; close: string } | null {
  const dayName = DAY_NAMES_EN[dayDate.getDay()];

  // PRIORITY 1: Per-day hours from Google Places Details
  if (activity.openingHoursByDay && dayName in activity.openingHoursByDay) {
    const dayHours = activity.openingHoursByDay[dayName];
    return dayHours; // null means closed that day
  }

  // PRIORITY 2: Default hours
  if (activity.openingHours?.open && activity.openingHours?.close) {
    return activity.openingHours;
  }

  return null; // Unknown — no constraint
}

function getActivityMaxEndTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
  // PRIORITY 1: Per-day real opening hours (Google Places Details API)
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (dayHours?.close && dayHours.close !== '23:59') {
    return parseTime(dayDate, dayHours.close);
  }

  // PRIORITY 2: Simple opening hours (if set and not default)
  if (!dayHours && activity.openingHours?.close && activity.openingHours.close !== '23:59' && activity.openingHours.close !== '18:00') {
    return parseTime(dayDate, activity.openingHours.close);
  }

  const name = (activity.name || '').toLowerCase();
  const type = (activity.type || '').toLowerCase();
  const allText = `${name} ${type}`;

  // Check if indoor first (takes priority)
  const isIndoor = INDOOR_ACTIVITY_KEYWORDS.some(k => allText.includes(k));
  if (isIndoor) return undefined; // No cap for indoor (hours unknown)

  // Check if outdoor
  const isOutdoor = OUTDOOR_ACTIVITY_KEYWORDS.some(k => allText.includes(k));
  if (isOutdoor) {
    // Cap at 19:30 (generous — most parks close earlier in winter)
    return parseTime(dayDate, '19:30');
  }

  // Unknown type — no cap (err on the side of flexibility)
  return undefined;
}

/**
 * Check if an activity is open on a specific day.
 * Returns false only if we have per-day data and the day is explicitly null (closed).
 * Returns true for unknown hours (default — err on side of scheduling).
 */
function isActivityOpenOnDay(activity: ScoredActivity, dayDate: Date): boolean {
  if (!activity.openingHoursByDay) return true; // No per-day data — assume open
  const dayName = DAY_NAMES_EN[dayDate.getDay()];
  if (!(dayName in activity.openingHoursByDay)) return true; // Day not in data — assume open
  return activity.openingHoursByDay[dayName] !== null; // null = closed
}

/**
 * Check if an activity is open during a specific scheduled time slot.
 * Returns true if no opening hours data is available (don't block scheduling).
 * Returns false if the venue is explicitly closed that day (null) or if the
 * scheduled time slot falls outside the venue's opening hours.
 *
 * @param activity - The scored activity with potential openingHours / openingHoursByDay data
 * @param dayDate - The calendar date of the scheduled day
 * @param startTime - Scheduled start time in "HH:MM" format
 * @param endTime - Scheduled end time in "HH:MM" format
 */
function isOpenAtTime(
  activity: ScoredActivity,
  dayDate: Date,
  startTime: string,
  endTime: string
): boolean {
  // Step 1: Get the hours for this specific day
  const dayHours = getActivityHoursForDay(activity, dayDate);

  // If getActivityHoursForDay returns null, it could mean:
  // (a) venue is CLOSED that day (openingHoursByDay[day] === null), or
  // (b) no hours data at all — assume open
  if (dayHours === null) {
    // Distinguish (a) vs (b) using isActivityOpenOnDay
    return isActivityOpenOnDay(activity, dayDate);
  }

  // Step 2: We have hours — check if the scheduled slot overlaps
  // Parse venue open/close times and scheduled start/end times
  const venueOpen = parseTime(dayDate, dayHours.open);
  const venueClose = parseTime(dayDate, dayHours.close);
  const slotStart = parseTime(dayDate, startTime);
  const slotEnd = parseTime(dayDate, endTime);

  // Handle venues open 24h (00:00-23:59)
  if (dayHours.open === '00:00' && (dayHours.close === '23:59' || dayHours.close === '00:00')) {
    return true;
  }

  // The activity must start at or after venue opens, and end at or before venue closes
  // Allow 15 min tolerance: venue might let you in slightly before opening
  const TOLERANCE_MS = 15 * 60 * 1000;
  const opensEarlyEnough = slotStart.getTime() >= venueOpen.getTime() - TOLERANCE_MS;
  const closesLateEnough = slotEnd.getTime() <= venueClose.getTime() + TOLERANCE_MS;

  return opensEarlyEnough && closesLateEnough;
}

/**
 * Get minimum start time for an activity based on its opening hours.
 * Prevents scheduling a museum visit at 07:00 when it opens at 10:00.
 */
function getActivityMinStartTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
  // PRIORITY 1: Per-day hours
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (dayHours?.open && dayHours.open !== '00:00') {
    return parseTime(dayDate, dayHours.open);
  }

  // PRIORITY 2: Simple opening hours
  if (activity.openingHours?.open && activity.openingHours.open !== '00:00') {
    return parseTime(dayDate, activity.openingHours.open);
  }
  return undefined;
}

/**
 * Enrich trip items that have no image using Google Places + Wikipedia fallback.
 * Uses GPS coordinates for location-biased search (more accurate results).
 * Has a hard 15s timeout — images are non-critical enrichment.
 */
async function enrichWithPlaceImages(days: TripDay[], destinationHint?: string): Promise<void> {
  try {
    const itemsNeedingImages: TripItem[] = [];
    // Restaurants exclus: enrichis séparément via Google Places (photos Google Maps only).
    const imageTypes = ['activity', 'hotel', 'checkin', 'checkout'];

    for (const day of days) {
      for (const item of day.items) {
        if (!item.imageUrl && imageTypes.includes(item.type)) {
          itemsNeedingImages.push(item);
        }
      }
    }

    if (itemsNeedingImages.length === 0) return;

    console.log(`[Pipeline V2] Fetching images for ${itemsNeedingImages.length} items without photos...`);

    // Hard timeout: 10s max for the entire image enrichment phase
    const enrichmentWork = async () => {
      await Promise.allSettled(
        itemsNeedingImages.map(async (item) => {
          try {
            const imageUrl = await fetchPlaceImage(
              item.title,
              item.latitude !== 0 ? item.latitude : undefined,
              item.longitude !== 0 ? item.longitude : undefined,
              destinationHint
            );
            if (imageUrl) {
              item.imageUrl = imageUrl;
            }
          } catch {
            // Individual item failure — skip silently
          }
        }),
      );
    };

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[Pipeline V2] ⚠️ Image enrichment timeout (10s) — continuing');
        resolve();
      }, 10_000);
    });

    await Promise.race([enrichmentWork(), timeout]);

    const enriched = itemsNeedingImages.filter(i => i.imageUrl).length;
    console.log(`[Pipeline V2] ✅ Place images: ${enriched}/${itemsNeedingImages.length} enriched (restaurants handled in dedicated Google photo pass)`);
  } catch (e) {
    console.warn('[Pipeline V2] Image enrichment error:', e);
  }
}

/**
 * Determine if a restaurant needs a better photo (no photo, or only a low-quality SerpAPI thumbnail).
 */
function needsBetterPhoto(restaurant: Restaurant): boolean {
  return extractGoogleRestaurantPhotos(restaurant).length === 0;
}

/**
 * Enrich restaurant photos using Google Places Details API.
 * Uses the googlePlaceId from SerpAPI to fetch the real first photo from Google Maps.
 * Much more reliable than searching by name (avoids homonym issues).
 * Cost: $0.005 per call (Place Details Basic).
 * Hard timeout: 10s max.
 */
async function enrichRestaurantsWithPhotos(days: TripDay[], destinationHint?: string): Promise<void> {
  try {
    // Collect all restaurants (main + alternatives) that need better photos.
    // Keep only Google photo sources; drop all non-Google thumbnails/heroes.
    const restaurantsToEnrich: Restaurant[] = [];

    for (const day of days) {
      for (const item of day.items) {
        if (item.type === 'restaurant' && item.restaurant) {
          enforceGoogleRestaurantPhotoPolicy(item.restaurant);
          if (needsBetterPhoto(item.restaurant)) {
            restaurantsToEnrich.push(item.restaurant);
          }
          // Also check alternatives
          if (item.restaurantAlternatives) {
            for (const alt of item.restaurantAlternatives) {
              enforceGoogleRestaurantPhotoPolicy(alt);
              if (needsBetterPhoto(alt)) {
                restaurantsToEnrich.push(alt);
              }
            }
          }
        }
      }
    }

    if (restaurantsToEnrich.length === 0) {
      console.log('[Pipeline V2] All restaurants already have good photos — skipping');
      return;
    }

    console.log(`[Pipeline V2] 📸 Enriching ${restaurantsToEnrich.length} restaurants with Google Places photos...`);

    const enrichmentWork = async () => {
      // Process in batches of 5 for concurrency control
      const BATCH_SIZE = 5;
      for (let i = 0; i < restaurantsToEnrich.length; i += BATCH_SIZE) {
        const batch = restaurantsToEnrich.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (restaurant) => {
            try {
              let photoUrl: string | null = null;

              // Path A: Use googlePlaceId (reliable, $0.005)
              if (restaurant.googlePlaceId) {
                photoUrl = await fetchRestaurantPhotoByPlaceId(restaurant.googlePlaceId);
              }

              // Path B: Fallback to name-based search (less reliable, $0.017)
              if (!photoUrl && restaurant.name) {
                const fallback = await fetchPlaceImage(
                  restaurant.name,
                  restaurant.latitude,
                  restaurant.longitude,
                  destinationHint
                );
                photoUrl = normalizeRestaurantGooglePhotoUrl(fallback || undefined) || null;
              }

              const normalizedPhoto = normalizeRestaurantGooglePhotoUrl(photoUrl || undefined);
              if (normalizedPhoto) {
                restaurant.photos = [normalizedPhoto];
              }
              enforceGoogleRestaurantPhotoPolicy(restaurant);
            } catch {
              // Individual restaurant failure — skip silently
            }
          })
        );
      }
    };

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[Pipeline V2] ⚠️ Restaurant photo enrichment timeout (10s) — continuing');
        resolve();
      }, 10_000);
    });

    await Promise.race([enrichmentWork(), timeout]);

    // Sync imageUrl on restaurant TripItems (so the card displays the new photo)
    for (const day of days) {
      for (const item of day.items) {
        if (item.type !== 'restaurant') continue;
        if (item.restaurant) {
          enforceGoogleRestaurantPhotoPolicy(item.restaurant);
        }
        if (item.restaurantAlternatives) {
          for (const alt of item.restaurantAlternatives) {
            enforceGoogleRestaurantPhotoPolicy(alt);
          }
        }
        item.imageUrl = item.restaurant?.photos?.[0];
      }
    }

    const enriched = restaurantsToEnrich.filter(r => r.photos && r.photos.length > 0 && !needsBetterPhoto(r)).length;
    console.log(`[Pipeline V2] ✅ Restaurant photos: ${enriched}/${restaurantsToEnrich.length} enriched with Google Places photos`);
  } catch (e) {
    console.warn('[Pipeline V2] Restaurant photo enrichment error:', e);
  }
}

/**
 * Batch enrich items with directions between consecutive items.
 */
async function enrichWithDirections(days: TripDay[], cache?: DirectionsCache): Promise<void> {
  for (const day of days) {
    // Compute hotel→first activity/restaurant distance (not covered by the i=1 loop)
    const hotelItem = day.items.find(i => i.type === 'checkin' || i.type === 'checkout');
    const firstMovableItem = day.items.find(i => ['activity', 'restaurant', 'free_time'].includes(i.type));
    if (hotelItem && firstMovableItem && hotelItem.latitude && hotelItem.longitude
        && firstMovableItem.latitude && firstMovableItem.longitude
        && hotelItem.latitude !== 0 && firstMovableItem.latitude !== 0
        && !firstMovableItem.distanceFromPrevious) {
      const dist = calculateDistance(hotelItem.latitude, hotelItem.longitude, firstMovableItem.latitude, firstMovableItem.longitude);
      firstMovableItem.distanceFromPrevious = Math.round(dist * 100) / 100;
      const travelTime = estimateTravel(hotelItem, firstMovableItem, cache);
      firstMovableItem.timeFromPrevious = travelTime;
      firstMovableItem.transportToPrevious = inferInterItemTransportMode(dist, travelTime);
    }

    for (let i = 1; i < day.items.length; i++) {
      const prev = day.items[i - 1];
      const curr = day.items[i];

      if (!prev.latitude || !prev.longitude || !curr.latitude || !curr.longitude) continue;
      if (prev.latitude === 0 || curr.latitude === 0) continue;
      if (
        curr.type === 'transport'
        && (curr.transportRole === 'hotel_depart' || curr.transportRole === 'hotel_return')
      ) {
        continue;
      }

      // Only fetch directions for activity/restaurant transitions
      if (!['activity', 'restaurant'].includes(prev.type) && !['activity', 'restaurant'].includes(curr.type)) continue;

      const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      curr.distanceFromPrevious = Math.round(dist * 100) / 100;
      let travelTime = estimateTravel(prev, curr, cache);

      // Fix fakeGPS restaurants: when restaurant GPS is a city-center fallback,
      // distance to activities is meaningless (often 0km → 0min travel).
      // Enforce a minimum travel time for any restaurant transition.
      const isRestaurantTransition = prev.type === 'restaurant' || curr.type === 'restaurant';
      if (isRestaurantTransition && travelTime < 10) {
        travelTime = 10; // Minimum 10min to/from a restaurant
      }

      curr.timeFromPrevious = travelTime;
      curr.transportToPrevious = inferInterItemTransportMode(dist, travelTime);
    }
  }

  // Batch Google Directions for longer distances (>1km) — skip pairs already in cache
  const longDistancePairs: { day: TripDay; idx: number; from: TripItem; to: TripItem }[] = [];

  for (const day of days) {
    for (let i = 1; i < day.items.length; i++) {
      const from = day.items[i - 1];
      const to = day.items[i];
      if (
        to.type === 'transport'
        && (to.transportRole === 'hotel_depart' || to.transportRole === 'hotel_return')
      ) {
        continue;
      }
      if ((to.distanceFromPrevious || 0) > 1 && from.latitude && to.latitude) {
        // Skip if already resolved from the prefetch cache
        if (cache) {
          const key = directionsCacheKey(from.latitude, from.longitude, to.latitude, to.longitude);
          if (cache.has(key)) continue;
        }
        longDistancePairs.push({ day, idx: i, from, to });
      }
    }
  }

  // Fetch directions in batches of 5
  for (let batch = 0; batch < longDistancePairs.length; batch += 5) {
    const batchItems = longDistancePairs.slice(batch, batch + 5);
    const results = await Promise.allSettled(
      batchItems.map(({ from, to }) =>
        getDirections({
          from: { lat: from.latitude, lng: from.longitude },
          to: { lat: to.latitude, lng: to.longitude },
          mode: 'transit',
        })
      )
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const dir = (results[i] as PromiseFulfilledResult<any>).value;
        const item = batchItems[i].day.items[batchItems[i].idx];
        if (dir) {
          item.timeFromPrevious = dir.duration || item.timeFromPrevious;
          item.distanceFromPrevious = dir.distance || item.distanceFromPrevious;
          if (item.distanceFromPrevious != null && item.timeFromPrevious != null) {
            item.transportToPrevious = inferInterItemTransportMode(item.distanceFromPrevious, item.timeFromPrevious);
          }
          if (dir.transitInfo) item.transitInfo = dir.transitInfo;
          if (dir.googleMapsUrl) item.googleMapsUrl = dir.googleMapsUrl;
        }
      }
    }
  }
}

/**
 * Find the best gap in the schedule to insert a meal.
 * Scans all items in the given time window, finds gaps between them,
 * and returns the gap closest to the ideal meal time.
 *
 * Uses insertFixedItem semantics (ignores cursor), so this works
 * even when the cursor has advanced past the meal window.
 */
/**
 * Detect if a string looks like a postal address rather than a description.
 * Filters out "00120 Vatican City, État de la Cité du Vatican" etc.
 */
function looksLikeAddress(text: any): boolean {
  if (!text || typeof text !== 'string' || text.length < 5) return false;
  // Postal codes (4-5 digits) combined with commas → likely an address
  if (/\b\d{4,5}\b/.test(text) && /,/.test(text)) return true;
  // Typical address words (international)
  const addressWords = [
    'street', 'avenue', 'road', 'blvd', 'boulevard',
    'via ', 'viale ', 'corso ',  // Italian
    'rue ', 'place ', 'allée ',  // French
    'piazza', 'plaza', 'platz',  // Italian/Spanish/German
    'calle ', 'carrer ',         // Spanish/Catalan
    'straat', 'weg ',            // Dutch/German
  ];
  const lower = text.toLowerCase();
  return addressWords.some(w => lower.includes(w));
}

const LANDMARK_COORD_FIXES: Array<{
  keywords: string[];
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
}> = [
  { keywords: ['tour eiffel', 'eiffel tower', 'trocadero'], latitude: 48.85837, longitude: 2.294481, maxDistanceKm: 4 },
  { keywords: ['louvre'], latitude: 48.860611, longitude: 2.337644, maxDistanceKm: 4 },
  { keywords: ['sacre-coeur', 'sacre coeur', 'montmartre'], latitude: 48.886705, longitude: 2.343104, maxDistanceKm: 4 },
  { keywords: ['notre-dame'], latitude: 48.852968, longitude: 2.349902, maxDistanceKm: 4 },
  { keywords: ['arc de triomphe'], latitude: 48.873792, longitude: 2.295028, maxDistanceKm: 4 },
  { keywords: ['versailles'], latitude: 48.804865, longitude: 2.120355, maxDistanceKm: 10 },
];

function normalizeItemCoordinates(
  title: string,
  itemData: any,
  itemType: string,
  destination: string
): { latitude: number; longitude: number } {
  const currentLat = itemData?.latitude || 0;
  const currentLng = itemData?.longitude || 0;
  if (itemType !== 'activity') {
    return { latitude: currentLat, longitude: currentLng };
  }

  const haystack = `${(title || '').toLowerCase()} ${(itemData?.name || '').toLowerCase()}`;
  const destinationLower = (destination || '').toLowerCase();
  const match = LANDMARK_COORD_FIXES.find((candidate) =>
    candidate.keywords.some((keyword) => haystack.includes(keyword))
  );

  if (!match) {
    return { latitude: currentLat, longitude: currentLng };
  }

  // Keep this conservative outside Paris to avoid false positives in other cities.
  if (!destinationLower.includes('paris') && !match.keywords.includes('versailles')) {
    return { latitude: currentLat, longitude: currentLng };
  }

  if (!currentLat || !currentLng) {
    return { latitude: match.latitude, longitude: match.longitude };
  }

  const distanceKm = calculateDistance(currentLat, currentLng, match.latitude, match.longitude);
  if (distanceKm > match.maxDistanceKm) {
    return { latitude: match.latitude, longitude: match.longitude };
  }

  return { latitude: currentLat, longitude: currentLng };
}

function sanitizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Build a meaningful description for a TripItem, filtering out addresses.
 * Priority: real description > cuisineTypes/specialties > tips > empty.
 */
function buildDescription(itemData: any, itemType: string, wikiDescriptions?: Map<string, string>): string {
  const MAX_DESCRIPTION_LENGTH = 250;
  const cut = (value: string): string => {
    const compact = sanitizeDescription(value);
    if (compact.length <= MAX_DESCRIPTION_LENGTH) return compact;
    return `${compact.slice(0, MAX_DESCRIPTION_LENGTH - 3).trim()}...`;
  };

  if (!itemData) return '';

  // 1. Wikipedia extract (most informative, available for well-known attractions)
  if (wikiDescriptions && itemData.name && wikiDescriptions.has(itemData.name)) {
    const wiki = wikiDescriptions.get(itemData.name)!;
    if (wiki.length >= 30 && !looksLikeAddress(wiki)) {
      return cut(wiki);
    }
  }

  // 2. If a real description exists and is NOT an address → use it
  if (itemData.description && typeof itemData.description === 'string' && !looksLikeAddress(itemData.description)) {
    return cut(itemData.description);
  }

  // 3. For restaurants: build from cuisineTypes / specialties
  if (itemType === 'restaurant' && itemData.cuisineTypes?.length > 0) {
    const cuisine = itemData.cuisineTypes.slice(0, 3).join(', ');
    if (itemData.specialties?.length > 0) {
      return cut(`${cuisine} · ${itemData.specialties[0]}`);
    }
    return cut(cuisine);
  }

  // 4. Fallback to tips (often populated by Viator, attractions.ts curated data)
  if (itemData.tips && typeof itemData.tips === 'string' && !looksLikeAddress(itemData.tips)) {
    return cut(itemData.tips);
  }

  // 5. Empty is better than an address
  return '';
}

function findBestMealSlot(
  scheduler: DayScheduler,
  dayDate: Date,
  windowStartStr: string,
  windowEndStr: string,
  duration: number,
  idealTimeStr: string
): { start: Date; end: Date } | null {
  const windowStart = parseTime(dayDate, windowStartStr);
  const windowEnd = parseTime(dayDate, windowEndStr);

  // Get all items that overlap with the meal window
  const items = scheduler.getItems()
    .filter(i => i.slot.end > windowStart && i.slot.start < windowEnd)
    .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());

  // Find gaps between items within the window
  const gaps: { start: Date; end: Date; size: number }[] = [];
  let gapStart = windowStart;

  for (const item of items) {
    if (item.slot.start > gapStart) {
      const gapSize = (item.slot.start.getTime() - gapStart.getTime()) / 60000;
      if (gapSize >= duration) {
        gaps.push({ start: new Date(gapStart), end: new Date(item.slot.start), size: gapSize });
      }
    }
    gapStart = new Date(Math.max(gapStart.getTime(), item.slot.end.getTime()));
  }

  // Check gap after the last item in the window
  if (gapStart < windowEnd) {
    const gapSize = (windowEnd.getTime() - gapStart.getTime()) / 60000;
    if (gapSize >= duration) {
      gaps.push({ start: new Date(gapStart), end: new Date(windowEnd), size: gapSize });
    }
  }

  if (gaps.length === 0) return null;

  // Pick the gap closest to the ideal meal time
  const idealTime = parseTime(dayDate, idealTimeStr);
  gaps.sort((a, b) => {
    const distA = Math.abs(a.start.getTime() - idealTime.getTime());
    const distB = Math.abs(b.start.getTime() - idealTime.getTime());
    return distA - distB;
  });

  const bestGap = gaps[0];
  const mealStart = bestGap.start;
  const mealEnd = new Date(mealStart.getTime() + duration * 60000);

  return { start: mealStart, end: mealEnd };
}

function formatTimeHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseHHMMToMinutes(time: string): number {
  const [h, m] = time.split(':').map((v) => Number(v));
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  return hour * 60 + minute;
}

function formatMinutesToHHMM(totalMinutes: number): string {
  const minutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function roundToNearestFive(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

function isOutsideHotel(item: TripItem, hotel: Accommodation): boolean {
  if (!item.latitude || !item.longitude || item.latitude === 0 || item.longitude === 0) return false;
  if (!hotel.latitude || !hotel.longitude) return false;
  const dist = calculateDistance(item.latitude, item.longitude, hotel.latitude, hotel.longitude);
  return dist > 0.15;
}

function sortItemsByTime(items: TripItem[]): TripItem[] {
  return [...items].sort((a, b) => {
    const startDiff = parseHHMMToMinutes(a.startTime) - parseHHMMToMinutes(b.startTime);
    if (startDiff !== 0) return startDiff;
    const endDiff = parseHHMMToMinutes(a.endTime) - parseHHMMToMinutes(b.endTime);
    if (endDiff !== 0) return endDiff;
    return (a.orderIndex || 0) - (b.orderIndex || 0);
  });
}

function dedupeScheduledActivityItems(items: TripItem[], dayNumber: number): TripItem[] {
  const result: TripItem[] = [];
  const seenActivities: TripItem[] = [];
  let dropped = 0;

  for (const item of sortItemsByTime(items)) {
    if (item.type !== 'activity') {
      result.push(item);
      continue;
    }

    const isDup = seenActivities.some((existing) =>
      isDuplicateActivityCandidate(
        { id: item.id, name: item.title, latitude: item.latitude, longitude: item.longitude },
        { id: existing.id, name: existing.title, latitude: existing.latitude, longitude: existing.longitude },
        { nearDistanceKm: 0.35, canonicalDistanceKm: 2.5 }
      )
    );

    if (isDup) {
      dropped++;
      continue;
    }

    seenActivities.push(item);
    result.push(item);
  }

  if (dropped > 0) {
    console.log(`[Pipeline V2] Day ${dayNumber}: removed ${dropped} duplicated activity item(s) after scheduling`);
  }

  return result.map((item, idx) => ({ ...item, orderIndex: idx }));
}

export function addHotelBoundaryTransportItems(params: {
  items: TripItem[];
  dayNumber: number;
  hotel: Accommodation | null;
  destination: string;
  directionsCache?: DirectionsCache;
}): TripItem[] {
  const { items, dayNumber, hotel, destination, directionsCache } = params;
  if (!hotel || !hotel.latitude || !hotel.longitude) return items;

  let result = sortItemsByTime(items);
  const hasManualDayTripReturn = result.some(
    (item) => item.id.startsWith(`daytrip-return-${dayNumber}`) || item.title === `Retour vers ${destination}`
  );
  const hasHotelDeparture = result.some((item) => item.id.startsWith(`hotel-depart-${dayNumber}`));
  const hasHotelReturn = result.some((item) => item.id.startsWith(`hotel-return-${dayNumber}`));

  const candidateTypes: TripItem['type'][] = ['activity', 'restaurant', 'free_time'];
  const outside = result.filter(
    (item) =>
      candidateTypes.includes(item.type) &&
      !item.id.startsWith('hotel-depart-') &&
      !item.id.startsWith('hotel-return-') &&
      isOutsideHotel(item, hotel)
  );
  if (outside.length === 0) return result;

  const firstOutside = outside[0];
  const lastOutside = outside[outside.length - 1];

  if (firstOutside && !hasHotelDeparture) {
    const directDistanceKm = calculateDistance(
      hotel.latitude,
      hotel.longitude,
      firstOutside.latitude || hotel.latitude,
      firstOutside.longitude || hotel.longitude
    );
    const estimatedDuration = roundToNearestFive(
      estimateTravel(
        { latitude: hotel.latitude, longitude: hotel.longitude },
        { latitude: firstOutside.latitude, longitude: firstOutside.longitude },
        directionsCache
      )
    );
    const inferredMode = inferInterItemTransportMode(directDistanceKm, estimatedDuration);
    const inferredTransportMode: TripItem['transportMode'] =
      inferredMode === 'walk' ? 'walking' : inferredMode === 'car' ? 'car' : 'transit';
    const endMinutes = parseHHMMToMinutes(firstOutside.startTime);
    const baseStartMinutes = Math.max(6 * 60, endMinutes - estimatedDuration);
    const overlapEndMinutes = result.reduce((latest, item) => {
      if (item.id === firstOutside.id) return latest;
      const itemStart = parseHHMMToMinutes(item.startTime);
      const itemEnd = parseHHMMToMinutes(item.endTime);
      if (itemStart < endMinutes && itemEnd > baseStartMinutes) {
        return Math.max(latest, itemEnd);
      }
      return latest;
    }, baseStartMinutes);
    const startMinutes = Math.max(baseStartMinutes, overlapEndMinutes);
    const duration = Math.max(0, endMinutes - startMinutes);

    if (duration < 5) {
      console.log(
        `[Pipeline V2] Day ${dayNumber}: skipping hotel_depart boundary due to schedule overlap before "${firstOutside.title}"`
      );
    } else {
      result.push({
        id: `hotel-depart-${dayNumber}-${firstOutside.id}`,
        dayNumber,
        startTime: formatMinutesToHHMM(startMinutes),
        endTime: formatMinutesToHHMM(endMinutes),
        type: 'transport',
        title: "Départ de l'hôtel",
        description: `Trajet vers ${firstOutside.locationName || firstOutside.title}`,
        locationName: firstOutside.locationName || firstOutside.title,
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        orderIndex: -1,
        estimatedCost: 0,
        duration,
        distanceFromPrevious: Math.round(directDistanceKm * 100) / 100,
        timeFromPrevious: estimatedDuration,
        transportToPrevious: inferredMode,
        transportMode: inferredTransportMode,
        transportRole: 'hotel_depart',
        dataReliability: 'estimated',
      });
    }
  }

  const lastOutsideEndMinutes = parseHHMMToMinutes(lastOutside?.endTime || '00:00');
  const hasUpcomingReturnLonghaul = result.some((item) => {
    const itemStart = parseHHMMToMinutes(item.startTime);
    const isReturnLeg =
      item.id.startsWith(`transport-ret-${dayNumber}`) ||
      item.id.startsWith(`flight-ret-${dayNumber}`) ||
      ((item.type === 'transport' || item.type === 'flight') && item.transportRole === 'longhaul');
    return isReturnLeg && itemStart >= lastOutsideEndMinutes;
  });

  if (lastOutside && !hasHotelReturn && !hasManualDayTripReturn && !hasUpcomingReturnLonghaul) {
    const directDistanceKm = calculateDistance(
      lastOutside.latitude || hotel.latitude,
      lastOutside.longitude || hotel.longitude,
      hotel.latitude,
      hotel.longitude
    );
    const estimatedDuration = roundToNearestFive(
      estimateTravel(
        { latitude: lastOutside.latitude, longitude: lastOutside.longitude },
        { latitude: hotel.latitude, longitude: hotel.longitude },
        directionsCache
      )
    );
    const inferredMode = inferInterItemTransportMode(directDistanceKm, estimatedDuration);
    const inferredTransportMode: TripItem['transportMode'] =
      inferredMode === 'walk' ? 'walking' : inferredMode === 'car' ? 'car' : 'transit';
    const startMinutes = parseHHMMToMinutes(lastOutside.endTime);
    const baseEndMinutes = Math.min(23 * 60 + 59, startMinutes + estimatedDuration);
    const overlapStartMinutes = result.reduce((earliest, item) => {
      if (item.id === lastOutside.id) return earliest;
      const itemStart = parseHHMMToMinutes(item.startTime);
      const itemEnd = parseHHMMToMinutes(item.endTime);
      if (itemStart < baseEndMinutes && itemEnd > startMinutes) {
        return Math.min(earliest, itemStart);
      }
      return earliest;
    }, baseEndMinutes);
    const endMinutes = Math.min(baseEndMinutes, overlapStartMinutes);
    const duration = Math.max(0, endMinutes - startMinutes);

    if (duration < 5) {
      console.log(
        `[Pipeline V2] Day ${dayNumber}: skipping hotel_return boundary due to schedule overlap after "${lastOutside.title}"`
      );
    } else {
      result.push({
        id: `hotel-return-${dayNumber}-${lastOutside.id}`,
        dayNumber,
        startTime: formatMinutesToHHMM(startMinutes),
        endTime: formatMinutesToHHMM(endMinutes),
        type: 'transport',
        title: "Retour à l'hôtel",
        description: `Retour vers ${hotel.name}`,
        locationName: hotel.name,
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        orderIndex: -1,
        estimatedCost: 0,
        duration,
        distanceFromPrevious: Math.round(directDistanceKm * 100) / 100,
        timeFromPrevious: estimatedDuration,
        transportToPrevious: inferredMode,
        transportMode: inferredTransportMode,
        transportRole: 'hotel_return',
        dataReliability: 'estimated',
      });
    }
  }

  result = sortItemsByTime(result).map((item, idx) => ({ ...item, orderIndex: idx }));
  return result;
}

function swapTripItemPayload(source: TripItem, target: TripItem): void {
  const sourceSchedule = {
    dayNumber: source.dayNumber,
    startTime: source.startTime,
    endTime: source.endTime,
    orderIndex: source.orderIndex,
  };
  const targetSchedule = {
    dayNumber: target.dayNumber,
    startTime: target.startTime,
    endTime: target.endTime,
    orderIndex: target.orderIndex,
  };

  const mutableKeys: (keyof TripItem)[] = [
    'id', 'type', 'title', 'description', 'locationName',
    'latitude', 'longitude', 'estimatedCost', 'duration', 'rating',
    'bookingUrl', 'viatorUrl', 'viatorTitle', 'viatorImageUrl', 'viatorRating',
    'viatorReviewCount', 'viatorDuration', 'viatorPrice', 'aviasalesUrl',
    'omioFlightUrl', 'googleMapsUrl', 'googleMapsPlaceUrl', 'restaurant',
    'restaurantAlternatives', 'accommodation', 'flight', 'flightAlternatives',
    'transitInfo', 'transitLegs', 'transitDataSource', 'priceRange',
    'transportMode', 'transportRole', 'dataReliability', 'imageUrl',
    'freeCancellation', 'instantConfirmation', 'distanceFromPrevious',
    'timeFromPrevious', 'transportToPrevious',
  ];

  const sourceSnapshot: Partial<TripItem> = {};
  for (const key of mutableKeys) {
    (sourceSnapshot as any)[key] = source[key];
    (source as any)[key] = target[key];
  }

  for (const key of mutableKeys) {
    (target as any)[key] = (sourceSnapshot as any)[key];
  }

  source.dayNumber = sourceSchedule.dayNumber;
  source.startTime = sourceSchedule.startTime;
  source.endTime = sourceSchedule.endTime;
  source.orderIndex = sourceSchedule.orderIndex;

  target.dayNumber = targetSchedule.dayNumber;
  target.startTime = targetSchedule.startTime;
  target.endTime = targetSchedule.endTime;
  target.orderIndex = targetSchedule.orderIndex;
}

function computeDayActivityCentroid(day: TripDay): { lat: number; lng: number } | null {
  const activities = day.items.filter((item) =>
    item.type === 'activity'
    && !!item.latitude
    && !!item.longitude
    && item.latitude !== 0
    && item.longitude !== 0
  );
  if (activities.length === 0) return null;
  return {
    lat: activities.reduce((sum, item) => sum + item.latitude, 0) / activities.length,
    lng: activities.reduce((sum, item) => sum + item.longitude, 0) / activities.length,
  };
}

function rebalanceActivityOutliersAcrossAdjacentDays(days: TripDay[]): number {
  let swaps = 0;

  for (let di = 0; di < days.length; di++) {
    const sourceDay = days[di];
    if (sourceDay.isDayTrip) continue;

    const sourceCentroid = computeDayActivityCentroid(sourceDay);
    if (!sourceCentroid) continue;

    const sourceActivities = sourceDay.items.filter((item) =>
      item.type === 'activity'
      && !!item.latitude
      && !!item.longitude
      && item.latitude !== 0
      && item.longitude !== 0
      && !(item.bookingUrl || '').includes('viator.com')
    );

    for (const sourceItem of sourceActivities) {
      const sourceOutlierDistance = calculateDistance(
        sourceItem.latitude,
        sourceItem.longitude,
        sourceCentroid.lat,
        sourceCentroid.lng
      );
      if (sourceOutlierDistance < 4) continue;

      const adjacentIndices = [di - 1, di + 1].filter((idx) => idx >= 0 && idx < days.length);
      let bestSwap: { target: TripItem; improvement: number; targetDay: TripDay } | null = null;

      for (const targetDayIndex of adjacentIndices) {
        const targetDay = days[targetDayIndex];
        if (targetDay.isDayTrip) continue;
        const targetCentroid = computeDayActivityCentroid(targetDay);
        if (!targetCentroid) continue;

        const sourceToTargetCentroid = calculateDistance(
          sourceItem.latitude,
          sourceItem.longitude,
          targetCentroid.lat,
          targetCentroid.lng
        );
        if (sourceToTargetCentroid >= sourceOutlierDistance - 0.6) continue;

        const targetActivities = targetDay.items.filter((item) =>
          item.type === 'activity'
          && !!item.latitude
          && !!item.longitude
          && item.latitude !== 0
          && item.longitude !== 0
          && !(item.bookingUrl || '').includes('viator.com')
        );

        for (const targetItem of targetActivities) {
          const targetOutlierDistance = calculateDistance(
            targetItem.latitude,
            targetItem.longitude,
            targetCentroid.lat,
            targetCentroid.lng
          );
          const targetToSourceCentroid = calculateDistance(
            targetItem.latitude,
            targetItem.longitude,
            sourceCentroid.lat,
            sourceCentroid.lng
          );

          const improvement =
            (sourceOutlierDistance - sourceToTargetCentroid)
            + (targetOutlierDistance - targetToSourceCentroid);

          if (improvement <= 1.5) continue;
          if (!bestSwap || improvement > bestSwap.improvement) {
            bestSwap = { target: targetItem, improvement, targetDay };
          }
        }
      }

      if (bestSwap) {
        const sourceLabel = sourceItem.title;
        const targetLabel = bestSwap.target.title;
        swapTripItemPayload(sourceItem, bestSwap.target);
        swaps++;
        console.log(
          `[Pipeline V2] Activity outlier swap: "${sourceLabel}" (day ${sourceDay.dayNumber}) `
          + `<-> "${targetLabel}" (day ${bestSwap.targetDay.dayNumber}), gain=${bestSwap.improvement.toFixed(1)}km`
        );
      }
    }
  }

  return swaps;
}

function refreshRouteMetadataAfterMutations(days: TripDay[], cache?: DirectionsCache): void {
  for (const day of days) {
    const sorted = sortItemsByTime(day.items);

    for (let i = 1; i < sorted.length; i++) {
      const from = sorted[i - 1];
      const to = sorted[i];

      if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) continue;
      if (from.latitude === 0 || from.longitude === 0 || to.latitude === 0 || to.longitude === 0) continue;
      if (
        (to.type === 'transport' && (to.transportRole === 'longhaul' || to.transportRole === 'hotel_depart' || to.transportRole === 'hotel_return'))
        || (from.type === 'transport' && from.transportRole === 'longhaul')
      ) {
        continue;
      }

      const distance = Math.round(calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude) * 100) / 100;
      let duration = estimateTravel(from, to, cache);

      const restaurantTransition = from.type === 'restaurant' || to.type === 'restaurant';
      if (restaurantTransition && duration < 10) duration = 10;

      to.distanceFromPrevious = distance;
      to.timeFromPrevious = duration;
      to.transportToPrevious = inferInterItemTransportMode(distance, duration);
    }

    day.items = sorted.map((item, index) => ({ ...item, orderIndex: index }));
  }
}

/**
 * Compute daily budget breakdown from trip items (€ per person).
 */
function computeDailyBudget(items: TripItem[]): { activities: number; food: number; transport: number; total: number } {
  let activities = 0;
  let food = 0;
  let transport = 0;

  for (const item of items) {
    const cost = item.estimatedCost || 0;
    if (cost <= 0) continue;

    switch (item.type) {
      case 'activity':
        activities += cost;
        break;
      case 'restaurant':
        food += cost;
        break;
      case 'transport':
        transport += cost;
        break;
      // flights, hotel: not counted in daily budget (they're trip-level costs)
    }
  }

  return {
    activities: Math.round(activities),
    food: Math.round(food),
    transport: Math.round(transport),
    total: Math.round(activities + food + transport),
  };
}

function computeCostBreakdown(
  days: TripDay[],
  flights: { outbound: Flight | null; return: Flight | null },
  hotel: Accommodation | null,
  preferences: TripPreferences,
  groundTransport?: TransportOptionSummary | null
) {
  let flightCost = 0;
  if (flights.outbound?.price) flightCost += flights.outbound.price;
  if (flights.return?.price) flightCost += flights.return.price;

  // Ground transport cost (train, bus, car) — round trip = 2× one-way price
  let transportCost = 0;
  if (groundTransport && groundTransport.mode !== 'plane') {
    transportCost = (groundTransport.totalPrice || 0) * 2;
  }

  // Use totalPrice from API if available (exact for the stay), otherwise compute nights = days - 1
  const nights = Math.max(1, preferences.durationDays - 1);
  const accommodationCost = hotel?.totalPrice || (hotel?.pricePerNight || 0) * nights;

  let foodCost = 0;
  let activitiesCost = 0;
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant') foodCost += (item.estimatedCost || 0);
      if (item.type === 'activity') activitiesCost += (item.estimatedCost || 0);
    }
  }

  const total = flightCost + accommodationCost + foodCost + activitiesCost + transportCost;

  return {
    total: Math.round(total),
    breakdown: {
      flights: Math.round(flightCost),
      accommodation: Math.round(accommodationCost),
      food: Math.round(foodCost),
      activities: Math.round(activitiesCost),
      transport: Math.round(transportCost),
      parking: 0,
      other: 0,
    },
  };
}
