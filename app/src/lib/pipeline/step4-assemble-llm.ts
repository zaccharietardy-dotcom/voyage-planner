/**
 * Pipeline V2 LLM — Step 4: Assemble LLM Plan
 *
 * Converts Claude's LLM planner output into the final Trip object that the frontend expects.
 * This is the assembly step for the LLM-powered pipeline branch.
 */

import type {
  Trip,
  TripDay,
  TripItem,
  TripPreferences,
  Flight,
  Accommodation,
  TransportOptionSummary,
  Restaurant,
} from '../types';
import type {
  FetchedData,
  ScoredActivity,
  LLMPlannerOutput,
  LLMPlannerInput,
  LLMDayPlan,
  LLMDayItem,
  OnPipelineEvent,
} from './types';
import { calculateDistance } from '../services/geocoding';
import { fetchPlaceImage, fetchRestaurantPhotoByPlaceId } from './services/wikimediaImages';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { normalizeHotelBookingUrl } from '../services/bookingLinks';
import { getMinDuration, getMaxDuration, estimateActivityCost } from './utils/constants';
import { generateFlightLink, generateFlightOmioLink, formatDateForUrl } from '../services/linkGenerator';
import { sanitizeApiKeyLeaksInString, sanitizeGoogleMapsUrl } from '../services/googlePlacePhoto';
import { resolveOfficialTicketing } from '../services/officialTicketing';
import { selectTopHotelsByBarycenter } from './step5-hotel';
import { getAirportPreDepartureLeadMinutes } from './step7-assemble';

// ============================================
// Local helper functions
// ============================================

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseHHMM(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function ceilToNearest15(time: string): string {
  const mins = parseHHMM(time);
  const rounded = Math.ceil(mins / 15) * 15;
  return minutesToHHMM(rounded);
}

function buildGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildGoogleMapsPlaceUrl(name: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=&center=${lat},${lng}`;
}

// ============================================
// Activity and Restaurant lookup maps
// ============================================

function buildActivityMap(
  data: FetchedData,
  inputActivities: LLMPlannerInput['activities']
): Map<string, ScoredActivity> {
  const activityMap = new Map<string, ScoredActivity>();

  // Collect all activity sources (including day-trip activities)
  const allActivities: ScoredActivity[] = [
    ...(data.googlePlacesAttractions || []).map((a) => ({ ...a, score: 0, source: 'google_places' as const, reviewCount: a.reviewCount || 0 })),
    ...(data.serpApiAttractions || []).map((a) => ({ ...a, score: 0, source: 'serpapi' as const, reviewCount: a.reviewCount || 0 })),
    ...(data.overpassAttractions || []).map((a) => ({ ...a, score: 0, source: 'overpass' as const, reviewCount: a.reviewCount || 0 })),
    ...(data.viatorActivities || []).map((a) => ({ ...a, score: 0, source: 'viator' as const, reviewCount: a.reviewCount || 0 })),
    ...(data.mustSeeAttractions || []).map((a) => ({ ...a, score: 0, source: 'mustsee' as const, reviewCount: a.reviewCount || 0 })),
    // Day-trip activities from all destinations
    ...Object.values(data.dayTripActivities || {}).flat().map((a) => ({ ...a, score: 0, source: 'google_places' as const, reviewCount: a.reviewCount || 0 })),
  ];

  // Map each input activity ID to full data
  for (const inputActivity of inputActivities) {
    const found = allActivities.find((a) => a.id === inputActivity.id);
    if (found) {
      activityMap.set(inputActivity.id, found);
    }
  }

  return activityMap;
}

function buildRestaurantMap(
  data: FetchedData,
  inputRestaurants: LLMPlannerInput['restaurants']
): Map<string, Restaurant> {
  const restaurantMap = new Map<string, Restaurant>();

  // Collect all restaurant sources (including day-trip restaurants)
  const allRestaurants: Restaurant[] = [
    ...(data.tripAdvisorRestaurants || []),
    ...(data.serpApiRestaurants || []),
    ...Object.values(data.dayTripRestaurants || {}).flat(),
  ];

  // Map each input restaurant ID to full data
  for (const inputRestaurant of inputRestaurants) {
    const found = allRestaurants.find((r) => r.id === inputRestaurant.id);
    if (found) {
      restaurantMap.set(inputRestaurant.id, found);
    }
  }

  return restaurantMap;
}

// ============================================
// Build Trip Items from LLM Day Plan
// ============================================

function buildTripItemsFromDayPlan(
  dayPlan: LLMDayPlan,
  activityMap: Map<string, ScoredActivity>,
  restaurantMap: Map<string, Restaurant>,
  startDate: Date
): TripItem[] {
  const items: TripItem[] = [];
  let orderIdx = 0;

  for (const item of dayPlan.items) {
    if (item.type === 'activity' && item.activityId) {
      const activity = activityMap.get(item.activityId);
      if (!activity) {
        console.warn(`[Pipeline V2 LLM] Activity not found: ${item.activityId}`);
        continue;
      }

      // Safety net: enforce min/max duration and fallback cost
      const actName = activity.name || '';
      const actType = activity.type || '';
      const minDur = getMinDuration(actName, actType);
      const maxDur = getMaxDuration(actName, actType);
      let safeDuration = Math.max(item.duration, minDur);
      if (maxDur !== null) safeDuration = Math.min(safeDuration, maxDur);

      // Recompute endTime if duration was adjusted
      const safeStartTime = ceilToNearest15(item.startTime);
      let safeEndTime = ceilToNearest15(item.endTime);
      if (safeDuration !== item.duration) {
        const [sh, sm] = safeStartTime.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = startMin + safeDuration;
        const eh = Math.floor(endMin / 60);
        const em = endMin % 60;
        safeEndTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      }

      const tripItem: TripItem = {
        id: uuidv4(),
        dayNumber: dayPlan.dayNumber,
        startTime: safeStartTime,
        endTime: safeEndTime,
        type: 'activity',
        title: activity.name,
        description: activity.description || '',
        locationName: activity.name,
        latitude: activity.latitude,
        longitude: activity.longitude,
        orderIndex: orderIdx++,
        estimatedCost: activity.estimatedCost || estimateActivityCost(actName, actType),
        duration: safeDuration,
        rating: activity.rating,
        bookingUrl: activity.bookingUrl,
        officialBookingUrl: activity.officialBookingUrl,
        viatorUrl: activity.viatorUrl,
        googleMapsUrl: sanitizeGoogleMapsUrl(buildGoogleMapsUrl(activity.latitude, activity.longitude)),
        googleMapsPlaceUrl: buildGoogleMapsPlaceUrl(activity.name, activity.latitude, activity.longitude),
        mustSee: activity.mustSee,
        imageUrl: activity.imageUrl,
        dataReliability: activity.dataReliability || 'verified',
        geoSource: activity.geoSource,
        geoConfidence: activity.geoConfidence || 'high',
        viatorTitle: activity.providerName === 'Viator' ? activity.name : undefined,
        viatorImageUrl: activity.providerName === 'Viator' ? activity.imageUrl : undefined,
        viatorRating: activity.providerName === 'Viator' ? activity.rating : undefined,
        viatorReviewCount: activity.providerName === 'Viator' ? (activity.reviewCount || 0) : undefined,
        viatorPrice: activity.providerName === 'Viator' ? activity.estimatedCost : undefined,
        viatorDuration: activity.providerName === 'Viator' ? activity.duration : undefined,
        freeCancellation: activity.freeCancellation,
        instantConfirmation: activity.instantConfirmation,
      };

      items.push(tripItem);
    } else if (item.type === 'restaurant' && item.restaurantId) {
      const restaurant = restaurantMap.get(item.restaurantId);
      if (!restaurant) {
        console.warn(`[Pipeline V2 LLM] Restaurant not found: ${item.restaurantId}`);
        continue;
      }

      const mealTypeLabel =
        item.mealType === 'breakfast'
          ? 'Petit-déjeuner'
          : item.mealType === 'lunch'
          ? 'Déjeuner'
          : 'Dîner';

      const cuisineDescription = (restaurant.cuisineTypes || []).length > 0
        ? (restaurant.cuisineTypes || []).join(', ')
        : '';

      const tripItem: TripItem = {
        id: uuidv4(),
        dayNumber: dayPlan.dayNumber,
        startTime: ceilToNearest15(item.startTime),
        endTime: ceilToNearest15(item.endTime),
        type: 'restaurant',
        title: `${mealTypeLabel} — ${restaurant.name}`,
        description: restaurant.description || `${mealTypeLabel} — ${cuisineDescription}`,
        locationName: restaurant.address || restaurant.name,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        orderIndex: orderIdx++,
        estimatedCost: restaurant.priceLevel ? restaurant.priceLevel * 12 : 15,
        duration: item.duration,
        rating: restaurant.rating,
        googleMapsUrl: sanitizeGoogleMapsUrl(buildGoogleMapsUrl(restaurant.latitude, restaurant.longitude)),
        restaurant: restaurant,
        restaurantAlternatives: [],
        dataReliability: restaurant.dataReliability || 'verified',
      };

      items.push(tripItem);
    }
  }

  return items;
}

// ============================================
// Add transport items (flights/trains)
// ============================================

function addOutboundTransportItem(
  day1: TripDay,
  flight: Flight | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences
): void {
  if (!flight && !transport) return;

  if (flight) {
    const flightItem: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: flight.departureTimeDisplay || '08:00',
      endTime: flight.arrivalTimeDisplay || '12:00',
      type: 'flight',
      title: `${flight.departureCity} → ${flight.arrivalCity}`,
      description: `Vol ${flight.airline} ${flight.flightNumber || ''}`.trim(),
      locationName: flight.departureAirport,
      latitude: 0,
      longitude: 0,
      orderIndex: 0,
      duration: flight.duration,
      flight: flight,
      flightAlternatives: [],
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: flight.price,
    };

    day1.items.unshift(flightItem);
  } else if (transport && transport.mode === 'train' && transport.transitLegs) {
    // Add train transport item
    const firstLeg = transport.transitLegs[0];
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: minutesToHHMM(parseHHMM(firstLeg.departure.split('T')[1]?.substring(0, 5) || '08:00')),
      endTime: minutesToHHMM(parseHHMM(lastLeg.arrival.split('T')[1]?.substring(0, 5) || '12:00')),
      type: 'transport',
      title: `${firstLeg.from} → ${lastLeg.to}`,
      description: `Train ${transport.transitLegs.map(l => l.operator || 'Train').join(', ')}`,
      locationName: firstLeg.from,
      latitude: 0,
      longitude: 0,
      orderIndex: 0,
      duration: transport.totalDuration,
      transitLegs: transport.transitLegs,
      transitDataSource: 'api',
      transportMode: 'train',
      transportRole: 'longhaul',
      imageUrl: '/images/transport/train-sncf-duplex.jpg',
      estimatedCost: transport.totalPrice,
      bookingUrl: transport.bookingUrl,
    };

    day1.items.unshift(trainItem);
  }

  // Re-index order
  day1.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

function addReturnTransportItem(
  lastDay: TripDay,
  returnFlight: Flight | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences
): void {
  if (!returnFlight && !transport) return;

  if (returnFlight) {
    const flightItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: returnFlight.departureTimeDisplay || '18:00',
      endTime: returnFlight.arrivalTimeDisplay || '22:00',
      type: 'flight',
      title: `${returnFlight.departureCity} → ${returnFlight.arrivalCity}`,
      description: `Vol ${returnFlight.airline} ${returnFlight.flightNumber || ''}`.trim(),
      locationName: returnFlight.departureAirport,
      latitude: 0,
      longitude: 0,
      orderIndex: lastDay.items.length,
      duration: returnFlight.duration,
      flight: returnFlight,
      flightAlternatives: [],
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: returnFlight.price,
    };

    lastDay.items.push(flightItem);
  } else if (transport && transport.mode === 'train' && transport.transitLegs) {
    // Add return train transport item
    const firstLeg = transport.transitLegs[0];
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(parseHHMM(firstLeg.departure.split('T')[1]?.substring(0, 5) || '18:00')),
      endTime: minutesToHHMM(parseHHMM(lastLeg.arrival.split('T')[1]?.substring(0, 5) || '22:00')),
      type: 'transport',
      title: `${firstLeg.from} → ${lastLeg.to}`,
      description: `Train ${transport.transitLegs.map(l => l.operator || 'Train').join(', ')}`,
      locationName: firstLeg.from,
      latitude: 0,
      longitude: 0,
      orderIndex: lastDay.items.length,
      duration: transport.totalDuration,
      transitLegs: transport.transitLegs,
      transitDataSource: 'api',
      transportMode: 'train',
      transportRole: 'longhaul',
      imageUrl: '/images/transport/train-sncf-duplex.jpg',
      estimatedCost: transport.totalPrice,
      bookingUrl: transport.bookingUrl,
    };

    lastDay.items.push(trainItem);
  }

  // Re-index order
  lastDay.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

// ============================================
// Add hotel check-in/check-out
// ============================================

function addHotelCheckInItem(day1: TripDay, hotel: Accommodation | null, preferences: TripPreferences): void {
  if (!hotel) return;

  const checkInTime = hotel.checkInTime || '15:00';
  const checkInItem: TripItem = {
    id: uuidv4(),
    dayNumber: 1,
    startTime: checkInTime,
    endTime: minutesToHHMM(parseHHMM(checkInTime) + 15),
    type: 'checkin',
    title: `Check-in ${hotel.name}`,
    description: `Arrivée et installation à l'hôtel`,
    locationName: hotel.name,
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex: day1.items.length,
    accommodation: hotel,
    bookingUrl: hotel.bookingUrl
      ? normalizeHotelBookingUrl({
          url: hotel.bookingUrl,
          hotelName: hotel.name,
          destinationHint: preferences.destination,
          checkIn: preferences.startDate.toISOString().split('T')[0],
          checkOut: new Date(preferences.startDate.getTime() + preferences.durationDays * 86400000).toISOString().split('T')[0],
          adults: preferences.groupSize,
        })
      : undefined,
  };

  day1.items.push(checkInItem);

  // Re-sort and re-index
  day1.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
  day1.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

function addHotelCheckOutItem(lastDay: TripDay, hotel: Accommodation | null): void {
  if (!hotel) return;

  const checkOutTime = hotel.checkOutTime || '11:00';
  const checkOutItem: TripItem = {
    id: uuidv4(),
    dayNumber: lastDay.dayNumber,
    startTime: checkOutTime,
    endTime: minutesToHHMM(parseHHMM(checkOutTime) + 15),
    type: 'checkout',
    title: `Check-out ${hotel.name}`,
    description: `Départ de l'hôtel`,
    locationName: hotel.name,
    latitude: hotel.latitude || 0,
    longitude: hotel.longitude || 0,
    orderIndex: 0,
    accommodation: hotel,
  };

  lastDay.items.unshift(checkOutItem);

  // Re-sort and re-index
  lastDay.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
  lastDay.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

// ============================================
// Compute distances between consecutive items
// ============================================

function computeDistancesForDay(day: TripDay): void {
  for (let i = 1; i < day.items.length; i++) {
    const prev = day.items[i - 1];
    const curr = day.items[i];

    if (
      prev.latitude &&
      prev.longitude &&
      curr.latitude &&
      curr.longitude &&
      prev.latitude !== 0 &&
      prev.longitude !== 0 &&
      curr.latitude !== 0 &&
      curr.longitude !== 0
    ) {
      const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      curr.distanceFromPrevious = Math.round(dist * 100) / 100;
      curr.timeFromPrevious = Math.ceil(dist * 1000 / 80); // 80m/min walking speed
      curr.transportToPrevious = dist > 3 ? 'public' : 'walk';
    }
  }
}

// ============================================
// Compute geo diagnostics per day
// ============================================

function computeGeoDiagnostics(items: TripItem[]): TripDay['geoDiagnostics'] {
  const legs: number[] = [];
  let totalTravelMin = 0;

  for (let i = 1; i < items.length; i++) {
    const dist = items[i].distanceFromPrevious || 0;
    legs.push(dist);
    totalTravelMin += items[i].timeFromPrevious || 0;
  }

  legs.sort((a, b) => a - b);
  const maxLegKm = legs.length > 0 ? legs[legs.length - 1] : 0;
  const p95Idx = Math.floor(legs.length * 0.95);
  const p95LegKm = legs.length > 0 ? legs[Math.min(p95Idx, legs.length - 1)] : 0;
  const totalLegKm = legs.reduce((s, l) => s + l, 0);

  return { maxLegKm, p95LegKm, totalTravelMin, totalLegKm };
}

// ============================================
// Compute schedule diagnostics
// ============================================

function computeScheduleDiagnostics(items: TripItem[]): TripDay['scheduleDiagnostics'] {
  let largestGapMin = 0;

  for (let i = 1; i < items.length; i++) {
    const prevEnd = parseHHMM(items[i - 1].endTime);
    const currStart = parseHHMM(items[i].startTime);
    const gap = currStart - prevEnd;
    if (gap > largestGapMin) largestGapMin = gap;
  }

  return { largestGapMin };
}

// ============================================
// Cost breakdown
// ============================================

function computeCostBreakdown(
  days: TripDay[],
  hotel: Accommodation | null,
  flight: Flight | null,
  returnFlight: Flight | null,
  preferences: TripPreferences
): Trip['costBreakdown'] {
  let activities = 0;
  let food = 0;
  let transport = 0;

  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        activities += item.estimatedCost || 0;
      }
      if (item.type === 'restaurant') {
        food += item.estimatedCost || 0;
      }
      if (item.type === 'transport') {
        transport += item.estimatedCost || 0;
      }
    }
  }

  const accommodation = hotel ? (hotel.pricePerNight || 0) * preferences.durationDays : 0;
  const flights = (flight?.price || 0) + (returnFlight?.price || 0);

  return {
    flights,
    accommodation,
    food: food * preferences.groupSize,
    activities: activities * preferences.groupSize,
    transport,
    parking: 0,
    other: 0,
  };
}

// ============================================
// Image enrichment
// ============================================

async function enrichImagesWithWikipedia(
  days: TripDay[],
  preferences: TripPreferences,
  onEvent?: OnPipelineEvent
): Promise<void> {
  const activityNames: string[] = [];
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        activityNames.push(item.title);
      }
    }
  }

  if (activityNames.length === 0) return;

  onEvent?.({
    type: 'info',
    label: 'Enrichissement Wikipedia',
    detail: `Récupération de ${activityNames.length} résumés Wikipedia`,
    timestamp: Date.now(),
  });

  const lang = getWikiLanguageForDestination(preferences.destination);
  const wikiSummaries = await batchFetchWikipediaSummaries(activityNames, lang);

  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'activity') {
        const wiki = wikiSummaries.get(item.title);
        if (wiki) {
          if (!item.description || item.description.length < 50) {
            item.description = wiki.extract?.substring(0, 200) || item.description;
          }
          if (!item.imageUrl && wiki.thumbnailUrl) {
            item.imageUrl = wiki.thumbnailUrl;
          }
        }
      }
    }
  }
}

async function enrichImagesWithGooglePlaces(
  days: TripDay[],
  onEvent?: OnPipelineEvent
): Promise<void> {
  const itemsWithoutImages = days
    .flatMap((d) => d.items)
    .filter((item) => item.type === 'activity' && !item.imageUrl && item.latitude && item.longitude);

  if (itemsWithoutImages.length === 0) return;

  onEvent?.({
    type: 'info',
    label: 'Enrichissement Google Places',
    detail: `Récupération de ${itemsWithoutImages.length} images`,
    timestamp: Date.now(),
  });

  for (const item of itemsWithoutImages) {
    try {
      const img = await fetchPlaceImage(item.title, item.latitude!, item.longitude!);
      if (img) {
        item.imageUrl = img;
      }
    } catch (err) {
      // Ignore errors
    }
  }
}

// ============================================
// Sanitize all URLs
// ============================================

function sanitizeTrip(trip: Trip): void {
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.googleMapsUrl) {
        item.googleMapsUrl = sanitizeGoogleMapsUrl(item.googleMapsUrl);
      }
      if (item.bookingUrl) {
        item.bookingUrl = sanitizeApiKeyLeaksInString(item.bookingUrl);
      }
      if (item.officialBookingUrl) {
        item.officialBookingUrl = sanitizeApiKeyLeaksInString(item.officialBookingUrl);
      }
      if (item.viatorUrl) {
        item.viatorUrl = sanitizeApiKeyLeaksInString(item.viatorUrl);
      }
    }
  }
}

// ============================================
// Main assembly function
// ============================================

export async function assembleFromLLMPlan(
  plan: LLMPlannerOutput,
  input: LLMPlannerInput,
  data: FetchedData,
  preferences: TripPreferences,
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  onEvent?: OnPipelineEvent
): Promise<Trip> {
  console.log('[Pipeline V2 LLM] Step 4: Assembling Trip from LLM plan...');

  onEvent?.({
    type: 'step_start',
    step: 4,
    stepName: 'LLM Assembly',
    label: 'Construction du Trip depuis le plan LLM',
    timestamp: Date.now(),
  });

  const startTime = Date.now();

  // 1. Build lookup maps
  const activityMap = buildActivityMap(data, input.activities);
  const restaurantMap = buildRestaurantMap(data, input.restaurants);

  console.log(`[Pipeline V2 LLM] Built maps: ${activityMap.size} activities, ${restaurantMap.size} restaurants`);

  // 2. Create TripDay[] from plan
  const tripDays: TripDay[] = [];
  const startDate = preferences.startDate;

  for (const dayPlan of plan.days) {
    const tripDay: TripDay = {
      dayNumber: dayPlan.dayNumber,
      date: new Date(startDate.getTime() + (dayPlan.dayNumber - 1) * 86400000),
      items: buildTripItemsFromDayPlan(dayPlan, activityMap, restaurantMap, startDate),
      theme: dayPlan.theme,
      dayNarrative: dayPlan.narrative,
      isDayTrip: dayPlan.isDayTrip || false,
      dayTripDestination: dayPlan.dayTripDestination,
    };

    // Inject day-trip transport items (outbound + return)
    if (tripDay.isDayTrip && tripDay.dayTripDestination && input.trip.dayTrips) {
      const dtInfo = input.trip.dayTrips.find(
        (dt) => dt.destination === tripDay.dayTripDestination
      );
      if (dtInfo) {
        const departureTime = '08:00';
        const arrivalTime = minutesToHHMM(parseHHMM(departureTime) + dtInfo.transportDurationMin);

        // Outbound transport
        const outboundItem: TripItem = {
          id: uuidv4(),
          dayNumber: tripDay.dayNumber,
          startTime: departureTime,
          endTime: arrivalTime,
          type: 'transport',
          title: `${preferences.destination} → ${dtInfo.destination}`,
          description: `${dtInfo.transportMode} (${dtInfo.transportDurationMin}min, ~${dtInfo.transportCostPerPerson}€/pers)`,
          locationName: preferences.destination,
          latitude: 0,
          longitude: 0,
          orderIndex: 0,
          duration: dtInfo.transportDurationMin,
          transportMode: dtInfo.transportMode as TripItem['transportMode'],
          transportRole: 'daytrip_outbound',
          estimatedCost: dtInfo.transportCostPerPerson * preferences.groupSize,
        };
        tripDay.items.unshift(outboundItem);

        // Return transport — estimate return time from last item
        const lastItem = tripDay.items[tripDay.items.length - 1];
        const returnDepartureMin = lastItem
          ? parseHHMM(lastItem.endTime) + 15
          : 17 * 60; // 17:00 default
        const returnArrivalMin = returnDepartureMin + dtInfo.transportDurationMin;

        const returnItem: TripItem = {
          id: uuidv4(),
          dayNumber: tripDay.dayNumber,
          startTime: minutesToHHMM(returnDepartureMin),
          endTime: minutesToHHMM(returnArrivalMin),
          type: 'transport',
          title: `${dtInfo.destination} → ${preferences.destination}`,
          description: `${dtInfo.transportMode} retour (${dtInfo.transportDurationMin}min)`,
          locationName: dtInfo.destination,
          latitude: dtInfo.coordinates.lat,
          longitude: dtInfo.coordinates.lng,
          orderIndex: tripDay.items.length,
          duration: dtInfo.transportDurationMin,
          transportMode: dtInfo.transportMode as TripItem['transportMode'],
          transportRole: 'daytrip_return',
          estimatedCost: dtInfo.transportCostPerPerson * preferences.groupSize,
        };
        tripDay.items.push(returnItem);
      }
    }

    tripDays.push(tripDay);
  }

  console.log(`[Pipeline V2 LLM] Built ${tripDays.length} days with ${tripDays.reduce((s, d) => s + d.items.length, 0)} items`);

  // 3. Add transport items (flights/trains)
  if (tripDays.length > 0) {
    const day1 = tripDays[0];
    const lastDay = tripDays[tripDays.length - 1];

    addOutboundTransportItem(day1, data.outboundFlight || null, transport, preferences);
    addReturnTransportItem(lastDay, data.returnFlight || null, transport, preferences);

    // 4. Add hotel check-in/check-out (skip on day-trip days)
    if (!day1.isDayTrip) addHotelCheckInItem(day1, hotel, preferences);
    if (!lastDay.isDayTrip) addHotelCheckOutItem(lastDay, hotel);
  }

  // 5. Sort items by time within each day and compute distances
  for (const day of tripDays) {
    day.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
    day.items.forEach((item, idx) => {
      item.orderIndex = idx;
    });

    computeDistancesForDay(day);

    // 6. Compute diagnostics
    day.geoDiagnostics = computeGeoDiagnostics(day.items);
    day.scheduleDiagnostics = computeScheduleDiagnostics(day.items);
  }

  console.log('[Pipeline V2 LLM] Computed distances and diagnostics');

  // 7. Compute cost breakdown
  const costBreakdown = computeCostBreakdown(
    tripDays,
    hotel,
    data.outboundFlight || null,
    data.returnFlight || null,
    preferences
  );

  // 8. Build accommodation options
  const accommodationOptions: Accommodation[] = [];
  if (data.bookingHotels && data.bookingHotels.length > 0) {
    try {
      const topHotels = selectTopHotelsByBarycenter(
        [], // clusters not available in LLM flow
        data.bookingHotels,
        preferences.budgetLevel,
        undefined,
        preferences.durationDays
      );
      if (topHotels) {
        accommodationOptions.push(...topHotels.slice(0, 5));
      }
    } catch (err) {
      console.warn('[Pipeline V2 LLM] Failed to select top hotels:', err);
    }
  }

  // 9. Build final Trip object
  const trip: Trip = {
    id: uuidv4(),
    createdAt: new Date(),
    updatedAt: new Date(),
    preferences,
    days: tripDays,
    transportOptions: data.transportOptions || [],
    selectedTransport: transport || undefined,
    outboundFlight: data.outboundFlight || undefined,
    returnFlight: data.returnFlight || undefined,
    accommodation: hotel || undefined,
    accommodationOptions,
    totalEstimatedCost:
      (costBreakdown?.flights || 0) +
      (costBreakdown?.accommodation || 0) +
      (costBreakdown?.food || 0) +
      (costBreakdown?.activities || 0) +
      (costBreakdown?.transport || 0),
    costBreakdown,
    travelTips: data.travelTips,
    budgetStrategy: data.budgetStrategy,
    attractionPool: [],
    alternativeActivities: [],
  };

  console.log('[Pipeline V2 LLM] Built Trip object');

  // 10. Image enrichment (async)
  try {
    await enrichImagesWithWikipedia(tripDays, preferences, onEvent);
  } catch (err) {
    console.warn('[Pipeline V2 LLM] Wikipedia enrichment failed:', err);
  }

  try {
    await enrichImagesWithGooglePlaces(tripDays, onEvent);
  } catch (err) {
    console.warn('[Pipeline V2 LLM] Google Places enrichment failed:', err);
  }

  console.log('[Pipeline V2 LLM] Image enrichment complete');

  // 11. Sanitize all URLs
  sanitizeTrip(trip);

  console.log('[Pipeline V2 LLM] Sanitized URLs');

  const duration = Date.now() - startTime;
  onEvent?.({
    type: 'step_done',
    step: 4,
    stepName: 'LLM Assembly',
    durationMs: duration,
    timestamp: Date.now(),
  });

  console.log(`[Pipeline V2 LLM] Step 4 complete in ${duration}ms`);

  return trip;
}
