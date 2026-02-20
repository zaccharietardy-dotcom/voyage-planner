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
import { selectTieredHotels } from './step5-hotel';
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
    // Reverse the outbound legs for return journey
    const reversedLegs = transport.transitLegs.slice().reverse().map(leg => ({
      ...leg,
      from: leg.to,
      to: leg.from,
      // Keep duration but departure/arrival times will be estimated
    }));

    // Update dates to last day
    const lastDayDate = lastDay.date;
    if (lastDayDate) {
      const dateStr = lastDayDate instanceof Date
        ? lastDayDate.toISOString().split('T')[0]
        : String(lastDayDate).split('T')[0];

      for (const leg of reversedLegs) {
        if (leg.departure) {
          const timepart = leg.departure.split('T')[1] || '17:00:00';
          leg.departure = `${dateStr}T${timepart}`;
        }
        if (leg.arrival) {
          const timepart = leg.arrival.split('T')[1] || '19:00:00';
          leg.arrival = `${dateStr}T${timepart}`;
        }
      }
    }

    const returnFirstLeg = reversedLegs[0];
    const returnLastLeg = reversedLegs[reversedLegs.length - 1];

    // Estimate return departure: afternoon (17:00 default)
    // Use a reasonable return time since we don't have actual return schedule
    const returnDepartMin = 17 * 60; // 17:00
    const returnArrivalMin = returnDepartMin + (transport.totalDuration || 120);

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(returnDepartMin),
      endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 59)),
      type: 'transport',
      title: `${returnFirstLeg.from} → ${returnLastLeg.to}`,
      description: `Train retour ${reversedLegs.map(l => l.operator || 'Train').join(', ')}`,
      locationName: returnFirstLeg.from,
      latitude: 0,
      longitude: 0,
      orderIndex: lastDay.items.length,
      duration: transport.totalDuration,
      transitLegs: reversedLegs,
      transitDataSource: 'api',
      transportMode: 'train',
      transportRole: 'longhaul',
      imageUrl: '/images/transport/train-sncf-duplex.jpg',
      estimatedCost: transport.totalPrice,
      bookingUrl: transport.bookingUrl,
    };

    lastDay.items.push(trainItem);
  } else if (transport && transport.mode !== 'plane' && !transport.transitLegs) {
    // Generic ground transport return (bus/car/combined) — estimate times
    const returnDepartMin = 17 * 60;
    const returnArrivalMin = returnDepartMin + (transport.totalDuration || 120);

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(returnDepartMin),
      endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 59)),
      type: 'transport',
      title: `${preferences.destination} → ${preferences.origin}`,
      description: `Transport retour`,
      locationName: preferences.destination,
      latitude: 0,
      longitude: 0,
      orderIndex: lastDay.items.length,
      duration: transport.totalDuration,
      transportMode: transport.mode as any,
      transportRole: 'longhaul',
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
// Filter items too far from destination center
// ============================================

function filterDistantItems(
  days: TripDay[],
  destCoords: { lat: number; lng: number },
  maxDistanceKm: number = 10
): void {
  for (const day of days) {
    if (day.isDayTrip) continue; // Day trips can be far

    const beforeCount = day.items.length;
    day.items = day.items.filter(item => {
      // Keep transport, checkin, checkout, flights
      if (['transport', 'flight', 'checkin', 'checkout'].includes(item.type)) return true;

      // Keep items without coords
      if (!item.latitude || !item.longitude) return true;

      const dist = calculateDistance(
        destCoords.lat, destCoords.lng,
        item.latitude, item.longitude
      );

      if (dist > maxDistanceKm) {
        console.log(`[Pipeline V2 LLM] REJECTED distant item "${item.title}" (${dist.toFixed(1)}km from center) on day ${day.dayNumber}`);
        return false;
      }
      return true;
    });

    if (day.items.length !== beforeCount) {
      // Re-index
      day.items.forEach((item, idx) => { item.orderIndex = idx; });
    }
  }
}

// ============================================
// Remove cross-day duplicate activities and restaurants
// ============================================

function removeCrossDayDuplicates(days: TripDay[]): void {
  const seenActivities = new Set<string>();
  const seenRestaurants = new Set<string>();

  for (const day of days) {
    day.items = day.items.filter(item => {
      if (item.type === 'activity') {
        // Deduplicate by title (normalized)
        const key = item.title.toLowerCase().trim();
        if (seenActivities.has(key)) {
          console.log(`[Pipeline V2 LLM] REMOVED duplicate activity "${item.title}" on day ${day.dayNumber}`);
          return false;
        }
        seenActivities.add(key);
      }
      if (item.type === 'restaurant') {
        // Deduplicate by restaurant name (not meal type — same restaurant shouldn't appear twice across days)
        const restaurantName = item.restaurant?.name?.toLowerCase().trim();
        if (restaurantName && seenRestaurants.has(restaurantName)) {
          console.log(`[Pipeline V2 LLM] REMOVED duplicate restaurant "${item.title}" on day ${day.dayNumber}`);
          return false;
        }
        if (restaurantName) seenRestaurants.add(restaurantName);
      }
      return true;
    });

    // Re-index
    day.items.forEach((it, idx) => { it.orderIndex = idx; });
  }
}

// ============================================
// Ensure breakfast exists on every day
// ============================================

function ensureBreakfastExists(
  day: TripDay,
  hotel: Accommodation | null,
  isFirstDay: boolean,
  isLastDay: boolean,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  destCoords: { lat: number; lng: number }
): void {
  // Skip breakfast on day 1 if arriving after 10:00
  if (isFirstDay && transport && transport.mode !== 'plane' && transport.transitLegs?.length) {
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
    const arrivalTime = lastLeg.arrival?.split('T')[1]?.substring(0, 5);
    if (arrivalTime && parseHHMM(arrivalTime) >= 10 * 60) {
      return; // Arriving too late for breakfast
    }
  }

  // Check if breakfast already exists
  const hasBreakfast = day.items.some(item => {
    if (item.type !== 'restaurant') return false;
    const startMin = parseHHMM(item.startTime);
    return startMin < 10 * 60 && (
      item.title.toLowerCase().includes('petit-déjeuner') ||
      item.title.toLowerCase().includes('breakfast') ||
      item.id.includes('breakfast')
    );
  });

  if (hasBreakfast) return;

  // Determine breakfast time
  const bkfStartMin = 8 * 60; // 08:00
  const bkfEndMin = bkfStartMin + 30; // 08:30

  const breakfastItem: TripItem = {
    id: `breakfast-${day.dayNumber}`,
    dayNumber: day.dayNumber,
    startTime: minutesToHHMM(bkfStartMin),
    endTime: minutesToHHMM(bkfEndMin),
    type: 'restaurant',
    title: hotel ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner — Café/Boulangerie',
    description: hotel?.breakfastIncluded ? 'Petit-déjeuner inclus' : 'Petit-déjeuner',
    locationName: hotel?.name || 'Café/Boulangerie',
    latitude: hotel?.latitude || destCoords.lat,
    longitude: hotel?.longitude || destCoords.lng,
    orderIndex: 0,
    duration: 30,
    estimatedCost: hotel?.breakfastIncluded ? 0 : 8,
    restaurant: {
      name: hotel?.name || 'Café/Boulangerie',
      latitude: hotel?.latitude || destCoords.lat,
      longitude: hotel?.longitude || destCoords.lng,
    } as any,
  };

  day.items.push(breakfastItem);
  console.log(`[Pipeline V2 LLM] Day ${day.dayNumber}: fallback breakfast inserted`);
}

// ============================================
// Resolve schedule conflicts
// ============================================

function resolveScheduleConflicts(
  days: TripDay[],
  transport: TransportOptionSummary | null,
  hotel: Accommodation | null
): void {
  for (const day of days) {
    // Find the longhaul transport arrival time on this day
    const longhaulTransport = day.items.find(i => i.type === 'transport' && i.transportRole === 'longhaul');
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === days.length;

    if (isFirstDay && longhaulTransport) {
      const arrivalMin = parseHHMM(longhaulTransport.endTime);
      let cursor = arrivalMin + 60; // 60min buffer after arrival

      // Sort items that need pushing by their original startTime
      const pushableItems = day.items
        .filter(item => {
          if (item.type === 'transport' || item.type === 'flight') return false;
          if (item.type === 'checkin') return false;
          if (item.id === longhaulTransport.id) return false;
          return parseHHMM(item.startTime) < cursor;
        })
        .sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));

      for (const item of pushableItems) {
        const duration = parseHHMM(item.endTime) - parseHHMM(item.startTime);
        item.startTime = minutesToHHMM(cursor);
        item.endTime = minutesToHHMM(cursor + Math.max(duration, 15));
        cursor = cursor + Math.max(duration, 15) + 15; // 15min gap between items
      }
    }

    if (isLastDay && longhaulTransport) {
      const departureMin = parseHHMM(longhaulTransport.startTime);

      // Ensure checkout is BEFORE return transport departure
      const checkout = day.items.find(i => i.type === 'checkout');
      if (checkout) {
        const checkoutStart = parseHHMM(checkout.startTime);
        if (checkoutStart >= departureMin) {
          // Move checkout to 2h before departure
          const newCheckoutStart = Math.max(8 * 60, departureMin - 120);
          checkout.startTime = minutesToHHMM(newCheckoutStart);
          checkout.endTime = minutesToHHMM(newCheckoutStart + 15);
        }
      }

      // Push activities to end before return transport
      for (const item of day.items) {
        if (item.type === 'transport' || item.type === 'flight' || item.type === 'checkout') continue;
        const endMin = parseHHMM(item.endTime);
        if (endMin > departureMin - 30) {
          // Shrink or remove items that conflict with departure
          const startMin = parseHHMM(item.startTime);
          if (startMin >= departureMin - 30) {
            // Completely overlaps departure window — move earlier or remove
            const duration = endMin - startMin;
            const newStart = departureMin - 30 - duration;
            if (newStart >= 7 * 60) { // earliest 7:00
              item.startTime = minutesToHHMM(newStart);
              item.endTime = minutesToHHMM(newStart + duration);
            }
          } else {
            // Partially overlaps — truncate
            item.endTime = minutesToHHMM(departureMin - 30);
          }
        }
      }
    }

    // Handle day-trip days: ensure breakfast ends before day-trip transport starts
    if (day.isDayTrip) {
      const dtOutbound = day.items.find(i => i.type === 'transport' && i.transportRole === 'daytrip_outbound');
      if (dtOutbound) {
        const dtDepartMin = parseHHMM(dtOutbound.startTime);
        for (const item of day.items) {
          if (item.type === 'transport') continue;
          const itemEnd = parseHHMM(item.endTime);
          const itemStart = parseHHMM(item.startTime);
          if (itemEnd > dtDepartMin && itemStart < dtDepartMin) {
            // Truncate item to end before transport
            item.endTime = minutesToHHMM(dtDepartMin - 5);
            if (parseHHMM(item.endTime) <= itemStart) {
              // Item is too short — move it earlier
              const duration = itemEnd - itemStart;
              item.startTime = minutesToHHMM(dtDepartMin - 5 - duration);
              item.endTime = minutesToHHMM(dtDepartMin - 5);
            }
          }
        }
      }
    }

    // General overlap resolution: if check-in overlaps with activities, adjust check-in
    const checkin = day.items.find(i => i.type === 'checkin');
    if (checkin) {
      const checkinStart = parseHHMM(checkin.startTime);
      const checkinEnd = parseHHMM(checkin.endTime);
      for (const item of day.items) {
        if (item === checkin) continue;
        if (item.type === 'transport' && item.transportRole === 'longhaul') continue;
        const itemStart = parseHHMM(item.startTime);
        const itemEnd = parseHHMM(item.endTime);
        // If check-in overlaps with an activity, move check-in after it
        if (checkinStart < itemEnd && checkinEnd > itemStart) {
          checkin.startTime = minutesToHHMM(itemEnd + 5);
          checkin.endTime = minutesToHHMM(itemEnd + 20);
          break; // Only fix first overlap
        }
      }
    }

    // Ensure breakfast comes before all non-infrastructure items
    const breakfast = day.items.find(item =>
      item.type === 'restaurant' &&
      (item.title.toLowerCase().includes('petit-déjeuner') ||
       item.title.toLowerCase().includes('breakfast') ||
       item.id.startsWith('breakfast-'))
    );

    if (breakfast) {
      const bkfEndMin = parseHHMM(breakfast.endTime);
      const pushableBeforeBreakfast = day.items
        .filter(item => {
          if (item === breakfast) return false;
          if (['transport', 'flight', 'checkin', 'checkout'].includes(item.type)) return false;
          return parseHHMM(item.startTime) < bkfEndMin;
        })
        .sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));

      if (pushableBeforeBreakfast.length > 0) {
        let cursor = bkfEndMin + 15; // 15min after breakfast
        for (const item of pushableBeforeBreakfast) {
          const duration = parseHHMM(item.endTime) - parseHHMM(item.startTime);
          item.startTime = minutesToHHMM(cursor);
          item.endTime = minutesToHHMM(cursor + Math.max(duration, 15));
          cursor = cursor + Math.max(duration, 15) + 15;
          console.log(`[Breakfast Fix] Pushed "${item.title}" after breakfast to ${item.startTime}`);
        }
      }
    }

    // Re-sort after adjustments
    day.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }
}

// ============================================
// Check if item has valid GPS coordinates
// ============================================

function hasValidCoords(item: TripItem): boolean {
  return (
    item.latitude !== undefined &&
    item.longitude !== undefined &&
    item.latitude !== 0 &&
    item.longitude !== 0 &&
    !isNaN(item.latitude) &&
    !isNaN(item.longitude)
  );
}

// ============================================
// Enforce minimum travel gaps between consecutive items
// ============================================

function enforceMinTravelGaps(days: TripDay[]): void {
  for (const day of days) {
    // Sort items by startTime first
    day.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));

    for (let i = 1; i < day.items.length; i++) {
      const prev = day.items[i - 1];
      const curr = day.items[i];

      // Skip if curr is immovable (transport, flight)
      if (curr.type === 'transport' || curr.type === 'flight') continue;

      const prevEndMin = parseHHMM(prev.endTime);
      const currStartMin = parseHHMM(curr.startTime);

      // If either item has no valid coords, just enforce no overlap
      if (!hasValidCoords(prev) || !hasValidCoords(curr)) {
        if (currStartMin < prevEndMin) {
          const duration = parseHHMM(curr.endTime) - currStartMin;
          curr.startTime = minutesToHHMM(prevEndMin);
          curr.endTime = minutesToHHMM(prevEndMin + Math.max(duration, 15));
        }
        continue;
      }

      // Compute distance
      const dist = calculateDistance(prev.latitude!, prev.longitude!, curr.latitude!, curr.longitude!);

      // Compute required travel gap
      let requiredGapMin: number;
      if (dist < 0.3) {
        requiredGapMin = 0; // Same location
      } else if (dist <= 3.0) {
        requiredGapMin = Math.ceil(dist * 1000 / 80) + 5; // Walking 80m/min + 5min buffer
      } else {
        requiredGapMin = Math.ceil((dist / 15) * 60) + 10; // Public transport 15km/h + 10min buffer
        requiredGapMin = Math.max(requiredGapMin, 20); // Minimum 20min for any PT trip
      }

      const availableGap = currStartMin - prevEndMin;

      if (availableGap < requiredGapMin) {
        const oldStart = curr.startTime;
        const duration = parseHHMM(curr.endTime) - currStartMin;
        const newStart = prevEndMin + requiredGapMin;
        curr.startTime = minutesToHHMM(newStart);
        curr.endTime = minutesToHHMM(newStart + Math.max(duration, 15));
        console.log(`[Travel Gap] Pushed "${curr.title}" from ${oldStart} to ${curr.startTime} (${dist.toFixed(1)}km, need ${requiredGapMin}min gap, had ${availableGap}min)`);
      }
    }

    // Remove items pushed past 23:30 (except transport/flight)
    day.items = day.items.filter(item => {
      if (item.type === 'transport' || item.type === 'flight') return true;
      if (parseHHMM(item.startTime) >= 23 * 60 + 30) {
        console.log(`[Travel Gap] REMOVED "${item.title}" — pushed past 23:30`);
        return false;
      }
      return true;
    });

    // Truncate items ending after 23:45
    for (const item of day.items) {
      if (parseHHMM(item.endTime) > 23 * 60 + 45) {
        item.endTime = '23:45';
      }
    }

    // Re-sort and re-index
    day.items.sort((a, b) => parseHHMM(a.startTime) - parseHHMM(b.startTime));
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }
}

// ============================================
// Compute distances between consecutive items
// ============================================

export function computeDistancesForDay(day: TripDay): void {
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

      if (dist > 3) {
        curr.timeFromPrevious = Math.ceil((dist / 15) * 60); // Public transport ~15km/h
        curr.transportToPrevious = 'public';
      } else {
        curr.timeFromPrevious = Math.ceil(dist * 1000 / 80); // Walking 80m/min
        curr.transportToPrevious = 'walk';
      }
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

  // 4a. Remove cross-day duplicate activities and restaurants
  removeCrossDayDuplicates(tripDays);

  // 4b. Ensure breakfast exists on every day
  for (let i = 0; i < tripDays.length; i++) {
    const day = tripDays[i];
    if (day.isDayTrip) continue; // Day trips handle their own meals
    ensureBreakfastExists(
      day,
      hotel,
      i === 0,
      i === tripDays.length - 1,
      transport,
      preferences,
      data.destCoords
    );
  }

  // 4b2. Filter items too far from destination center on non-day-trip days
  filterDistantItems(tripDays, data.destCoords);

  // 4c. Resolve schedule conflicts (arrival buffer, checkout ordering, overlaps)
  resolveScheduleConflicts(tripDays, transport, hotel);

  // 4d. Enforce minimum travel gaps between consecutive items
  enforceMinTravelGaps(tripDays);

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

  // 8. Build accommodation options (3 tiered hotels: central, comfortable, value)
  const accommodationOptions: Accommodation[] = [];
  if (data.bookingHotels && data.bookingHotels.length > 0) {
    try {
      const tieredHotels = selectTieredHotels(
        [], // clusters not available in LLM flow — uses destCoords fallback
        data.bookingHotels,
        preferences.budgetLevel,
        undefined,
        preferences.durationDays,
        { destCoords: data.destCoords }
      );
      if (tieredHotels.length > 0) {
        accommodationOptions.push(...tieredHotels);
        console.log(`[Pipeline V2 LLM] Tiered hotel options: ${tieredHotels.map(h => `${h.distanceTier}="${h.name}" (${h.distanceToCenter}km)`).join(', ')}`);
      }
    } catch (err) {
      console.warn('[Pipeline V2 LLM] Failed to select tiered hotels:', err);
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
