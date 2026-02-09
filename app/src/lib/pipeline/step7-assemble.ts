/**
 * Pipeline V2 — Step 7: Schedule Assembly
 *
 * Converts balanced clusters + restaurants + transport into a fully-slotted Trip.
 * Uses the existing DayScheduler for time slot management.
 */

import type { Trip, TripDay, TripItem, TripPreferences, Flight, Accommodation, TransportOptionSummary } from '../types';
import type { FetchedData, ActivityCluster, MealAssignment, BalancedPlan, ScoredActivity } from './types';
import { DayScheduler, parseTime, formatTime } from '../services/scheduler';
import { calculateDistance, estimateTravelTime } from '../services/geocoding';
import { getDirections } from '../services/directions';
// Simple UUID generator (avoids external dependency)
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  data: FetchedData
): Promise<Trip> {
  const startDate = new Date(preferences.startDate);
  const days: TripDay[] = [];

  for (const balancedDay of plan.days) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + balancedDay.dayNumber - 1);

    const isFirstDay = balancedDay.dayNumber === 1;
    const isLastDay = balancedDay.dayNumber === preferences.durationDays;

    // Compute day bounds
    let dayStartHour = parseInt(balancedDay.suggestedStartTime?.split(':')[0] || '9', 10);
    let dayEndHour = 22;

    if (isFirstDay && flights.outbound) {
      // Use display time (local airport time) if available, otherwise parse ISO
      const arrivalHour = flights.outbound.arrivalTimeDisplay
        ? parseInt(flights.outbound.arrivalTimeDisplay.split(':')[0], 10)
        : new Date(flights.outbound.arrivalTime).getHours();
      dayStartHour = Math.max(dayStartHour, arrivalHour + 1); // +1h for transfer
    }
    if (isLastDay && flights.return) {
      const departureHour = flights.return.departureTimeDisplay
        ? parseInt(flights.return.departureTimeDisplay.split(':')[0], 10)
        : new Date(flights.return.departureTime).getHours();
      // Need to be at airport 2h before departure, plus 1h transfer = 3h before
      // But ensure at least a 3h window for the last day (activities + checkout)
      dayEndHour = Math.max(dayStartHour + 3, departureHour - 3);
      // If flight is very early (before noon), start earlier
      if (departureHour <= 12) {
        dayStartHour = Math.min(dayStartHour, 7);
      }
    }

    const dayStart = parseTime(dayDate, `${String(dayStartHour).padStart(2, '0')}:00`);
    const dayEnd = parseTime(dayDate, `${String(Math.min(dayEndHour, 23)).padStart(2, '0')}:00`);

    const scheduler = new DayScheduler(dayDate, dayStart, dayEnd);

    // 1. Fixed items: flights
    if (isFirstDay && flights.outbound) {
      const depTime = new Date(flights.outbound.departureTime);
      const arrTime = new Date(flights.outbound.arrivalTime);
      scheduler.insertFixedItem({
        id: `flight-out-${balancedDay.dayNumber}`,
        title: `Vol ${flights.outbound.airline} ${flights.outbound.flightNumber}`,
        type: 'flight',
        startTime: depTime,
        endTime: arrTime,
        data: flights.outbound,
      });
    }
    if (isLastDay && flights.return) {
      const depTime = new Date(flights.return.departureTime);
      const arrTime = new Date(flights.return.arrivalTime);
      scheduler.insertFixedItem({
        id: `flight-ret-${balancedDay.dayNumber}`,
        title: `Vol ${flights.return.airline} ${flights.return.flightNumber}`,
        type: 'flight',
        startTime: depTime,
        endTime: arrTime,
        data: flights.return,
      });
    }

    // 2. Hotel check-in (first day) / check-out (last day)
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
      }
      scheduler.insertFixedItem({
        id: `checkin-${balancedDay.dayNumber}`,
        title: `Check-in ${hotel.name}`,
        type: 'checkin',
        startTime: checkinTime,
        endTime: new Date(checkinTime.getTime() + 30 * 60 * 1000),
        data: hotel,
      });
    }
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

    // 3. Get activities in Claude-specified order
    const cluster = clusters.find(c => c.dayNumber === balancedDay.dayNumber);
    const orderedActivities = reorderByPlan(cluster, balancedDay.activityOrder);

    // 4. Prepare meal data
    const dayMeals = meals.filter(m => m.dayNumber === balancedDay.dayNumber);
    const breakfast = dayMeals.find(m => m.mealType === 'breakfast');
    const lunch = dayMeals.find(m => m.mealType === 'lunch');
    const dinner = dayMeals.find(m => m.mealType === 'dinner');

    // Determine which meals to skip based on time constraints
    const skipBreakfast = isFirstDay && dayStartHour >= 10;
    const skipLunch = isLastDay && flights.return && dayEndHour < 12;
    const skipDinner = isLastDay && flights.return && dayEndHour < 19;

    // 5. Insert breakfast (only if day starts early enough)
    if (breakfast?.restaurant && !skipBreakfast && dayStartHour < 10) {
      scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-breakfast`,
        title: `Petit-déjeuner — ${breakfast.restaurant.name}`,
        type: 'restaurant',
        duration: 45,
        minStartTime: parseTime(dayDate, '07:30'),
        maxEndTime: parseTime(dayDate, '10:00'),
        data: breakfast.restaurant,
      });
    }

    // 6. Interleave activities with lunch and dinner at appropriate positions
    // Strategy: insert activities one by one, inserting meals when the time is right
    let lunchInserted = false;
    let dinnerInserted = false;

    for (let i = 0; i < orderedActivities.length; i++) {
      const activity = orderedActivities[i];
      const prev = i === 0 ? hotel : orderedActivities[i - 1];
      let travelTime = prev ? estimateTravel(prev, activity) : 10;

      // Day-trip activities: long travel from hotel (by car/bus, not transit)
      if (balancedDay.isDayTrip && i === 0 && hotel) {
        const distKm = calculateDistance(
          hotel.latitude, hotel.longitude,
          activity.latitude, activity.longitude
        );
        // Day trips use car/bus speed (~50km/h average), NOT transit
        travelTime = Math.round((distKm / 50) * 60);
      }

      // Check if it's time for lunch (cursor between 12:00 and 14:30)
      const cursorTime = scheduler.getCurrentTime();
      const cursorHour = cursorTime.getHours() + cursorTime.getMinutes() / 60;

      if (!lunchInserted && !skipLunch && lunch?.restaurant && cursorHour >= 11.5 && cursorHour < 14.5) {
        scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-lunch`,
          title: `Déjeuner — ${lunch.restaurant.name}`,
          type: 'restaurant',
          duration: 60,
          minStartTime: parseTime(dayDate, '12:00'),
          maxEndTime: parseTime(dayDate, '14:30'),
          data: lunch.restaurant,
        });
        lunchInserted = true;
      }

      // Check if it's time for dinner (cursor between 19:00 and 21:00)
      const cursorTime2 = scheduler.getCurrentTime();
      const cursorHour2 = cursorTime2.getHours() + cursorTime2.getMinutes() / 60;

      if (!dinnerInserted && !skipDinner && dinner?.restaurant && cursorHour2 >= 18.5 && cursorHour2 < 21) {
        scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-dinner`,
          title: `Dîner — ${dinner.restaurant.name}`,
          type: 'restaurant',
          duration: 75,
          minStartTime: parseTime(dayDate, '19:00'),
          maxEndTime: parseTime(dayDate, '22:00'),
          data: dinner.restaurant,
        });
        dinnerInserted = true;
      }

      // Day-trip activities get extended duration (whole-day excursion)
      const activityDuration = balancedDay.isDayTrip
        ? Math.max(activity.duration || 120, 180) // At least 3h for day-trip activities
        : (activity.duration || 60);

      scheduler.addItem({
        id: activity.id,
        title: activity.name,
        type: 'activity',
        duration: activityDuration,
        travelTime,
        data: activity,
      });
    }

    // 7. Insert any remaining meals after all activities
    if (!lunchInserted && !skipLunch && lunch?.restaurant) {
      const cursorHour = scheduler.getCurrentTime().getHours();
      if (cursorHour < 15) {
        scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-lunch`,
          title: `Déjeuner — ${lunch.restaurant.name}`,
          type: 'restaurant',
          duration: 60,
          minStartTime: parseTime(dayDate, '12:00'),
          maxEndTime: parseTime(dayDate, '15:00'),
          data: lunch.restaurant,
        });
      }
    }

    if (!dinnerInserted && !skipDinner && dinner?.restaurant) {
      scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-dinner`,
        title: `Dîner — ${dinner.restaurant.name}`,
        type: 'restaurant',
        duration: 75,
        minStartTime: parseTime(dayDate, '19:00'),
        maxEndTime: parseTime(dayDate, '22:00'),
        data: dinner.restaurant,
      });
    }

    // 9. Remove scheduling conflicts (keep higher-priority items)
    scheduler.removeConflicts();

    // 10. Convert to TripItems
    const scheduleItems = scheduler.getItems();
    const tripItems: TripItem[] = scheduleItems.map((item, idx) => {
      const itemData = item.data || {};
      return {
        id: item.id || uuidv4(),
        dayNumber: balancedDay.dayNumber,
        startTime: formatTimeHHMM(item.slot.start),
        endTime: formatTimeHHMM(item.slot.end),
        type: item.type as TripItem['type'],
        title: item.title,
        description: itemData.description || '',
        locationName: itemData.address || itemData.name || item.title,
        latitude: itemData.latitude || 0,
        longitude: itemData.longitude || 0,
        orderIndex: idx,
        estimatedCost: itemData.estimatedCost || itemData.priceLevel ? (itemData.priceLevel || 1) * 15 : 0,
        duration: item.duration,
        rating: itemData.rating,
        bookingUrl: itemData.bookingUrl || itemData.reservationUrl,
        viatorUrl: itemData.viatorUrl,
        restaurant: item.type === 'restaurant' ? itemData : undefined,
        accommodation: (item.type === 'checkin' || item.type === 'checkout') ? itemData : undefined,
        flight: item.type === 'flight' ? itemData : undefined,
        dataReliability: itemData.dataReliability || 'verified',
        imageUrl: itemData.photos?.[0] || itemData.imageUrl,
      };
    });

    days.push({
      dayNumber: balancedDay.dayNumber,
      date: dayDate,
      items: tripItems,
      theme: balancedDay.theme,
      dayNarrative: balancedDay.dayNarrative,
      isDayTrip: balancedDay.isDayTrip,
      dayTripDestination: balancedDay.dayTripDestination,
    });
  }

  // 11. Batch fetch directions (non-blocking enrichment)
  await enrichWithDirections(days).catch(e =>
    console.warn('[Pipeline V2] Directions enrichment failed:', e)
  );

  // 12. Build cost breakdown
  const costBreakdown = computeCostBreakdown(days, flights, hotel, preferences);

  // 13. Assemble final Trip
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
    attractionPool: clusters.flatMap(c => c.activities),
  };

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
 * Estimate travel time between two locations using Haversine.
 */
function estimateTravel(from: any, to: any): number {
  const fromLat = from?.latitude || from?.lat;
  const fromLng = from?.longitude || from?.lng;
  const toLat = to?.latitude || to?.lat;
  const toLng = to?.longitude || to?.lng;

  if (!fromLat || !fromLng || !toLat || !toLng) return 10;

  const distKm = calculateDistance(fromLat, fromLng, toLat, toLng);

  // Walking: ~5km/h → 12min/km
  // Mixed walking+transit: ~8min/km
  // Urban transit: ~15km/h → 4min/km
  // Car/intercity: ~50km/h → 1.2min/km
  if (distKm < 1) return Math.max(5, Math.round(distKm * 12));
  if (distKm < 3) return Math.round(distKm * 8);
  if (distKm < 15) return Math.round(distKm * 4);
  // Long distance: car/bus speed
  return Math.round((distKm / 50) * 60);
}

/**
 * Batch enrich items with directions between consecutive items.
 */
async function enrichWithDirections(days: TripDay[]): Promise<void> {
  const directionPromises: Promise<void>[] = [];

  for (const day of days) {
    for (let i = 1; i < day.items.length; i++) {
      const prev = day.items[i - 1];
      const curr = day.items[i];

      if (!prev.latitude || !prev.longitude || !curr.latitude || !curr.longitude) continue;
      if (prev.latitude === 0 || curr.latitude === 0) continue;

      // Only fetch directions for activity/restaurant transitions
      if (!['activity', 'restaurant'].includes(prev.type) && !['activity', 'restaurant'].includes(curr.type)) continue;

      const dist = calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      curr.distanceFromPrevious = Math.round(dist * 100) / 100;
      curr.timeFromPrevious = estimateTravel(prev, curr);
      curr.transportToPrevious = dist < 1 ? 'walk' : 'public';
    }
  }

  // Batch Google Directions for longer distances (>1km)
  const longDistancePairs: { day: TripDay; idx: number; from: TripItem; to: TripItem }[] = [];

  for (const day of days) {
    for (let i = 1; i < day.items.length; i++) {
      const from = day.items[i - 1];
      const to = day.items[i];
      if ((to.distanceFromPrevious || 0) > 1 && from.latitude && to.latitude) {
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
          if (dir.transitInfo) item.transitInfo = dir.transitInfo;
          if (dir.googleMapsUrl) item.googleMapsUrl = dir.googleMapsUrl;
        }
      }
    }
  }
}

function formatTimeHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function computeCostBreakdown(
  days: TripDay[],
  flights: { outbound: Flight | null; return: Flight | null },
  hotel: Accommodation | null,
  preferences: TripPreferences
) {
  let flightCost = 0;
  if (flights.outbound?.price) flightCost += flights.outbound.price;
  if (flights.return?.price) flightCost += flights.return.price;

  const accommodationCost = (hotel?.pricePerNight || 0) * preferences.durationDays;

  let foodCost = 0;
  let activitiesCost = 0;
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant') foodCost += (item.estimatedCost || 0);
      if (item.type === 'activity') activitiesCost += (item.estimatedCost || 0);
    }
  }

  const total = flightCost + accommodationCost + foodCost + activitiesCost;

  return {
    total: Math.round(total),
    breakdown: {
      flights: Math.round(flightCost),
      accommodation: Math.round(accommodationCost),
      food: Math.round(foodCost),
      activities: Math.round(activitiesCost),
      transport: 0,
      parking: 0,
      other: 0,
    },
  };
}
