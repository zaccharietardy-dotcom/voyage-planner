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
import { fetchPlaceImage } from './services/wikimediaImages';
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
  train: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=600&h=400&fit=crop',
  bus: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=600&h=400&fit=crop',
  ferry: 'https://images.unsplash.com/photo-1534008897995-27a23e859048?w=600&h=400&fit=crop',
  car: 'https://images.unsplash.com/photo-1449965408869-ebd13bc9e5a8?w=600&h=400&fit=crop',
  combined: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=600&h=400&fit=crop',
};

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
      // Need to be at airport 2h before departure, plus 1h transfer = 3h before
      // But ensure at least a 3h window for the last day (activities + checkout)
      dayEndHour = Math.max(dayStartHour + 3, departureHour - 3);
      // If flight is very early (before noon), start earlier
      if (departureHour <= 12) {
        dayStartHour = Math.min(dayStartHour, 7);
      }
    } else if (hasReturnTransport && groundDepartureHour !== null) {
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
        returnTransitLegs = transport.transitLegs.slice().reverse().map((leg) => {
          const returnDep = new Date(dayDate);
          returnDep.setHours(tStart.getHours(), tStart.getMinutes(), 0, 0);
          const returnArr = new Date(dayDate);
          returnArr.setHours(tEnd.getHours(), tEnd.getMinutes(), 0, 0);
          return {
            mode: leg.mode,
            from: leg.to,
            to: leg.from,
            departure: returnDep.toISOString(),
            arrival: returnArr.toISOString(),
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
          bookingUrl: transport.bookingUrl,
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
    // IMPORTANT: On the first day, DEFER check-in insertion until after activities.
    // This prevents the check-in block from creating a gap before it (e.g. 10:00-15:00 empty).
    let deferredCheckinData: { id: string; title: string; type: string; startTime: Date; endTime: Date; data: any } | null = null;
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
      // Store check-in data — will be inserted AFTER activities to avoid blocking pre-check-in slots
      deferredCheckinData = {
        id: `checkin-${balancedDay.dayNumber}`,
        title: `Check-in ${hotel.name}`,
        type: 'checkin',
        startTime: checkinTime,
        endTime: new Date(checkinTime.getTime() + 30 * 60 * 1000),
        data: hotel,
      };
    }

    // Last day: insert breakfast BEFORE checkout so cursor is still early
    // Use maxEndTime of 10:30 to give a bit more room
    if (isLastDay && breakfast?.restaurant && !skipBreakfast && dayStartHour <= 10) {
      scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-breakfast`,
        title: `Petit-déjeuner — ${breakfast.restaurant.name}`,
        type: 'restaurant',
        duration: 45,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:30'),
        data: { ...breakfast.restaurant, _alternatives: breakfast.restaurantAlternatives || [] },
      });
    } else if (isLastDay && !breakfast?.restaurant && !skipBreakfast && hotel?.breakfastIncluded && dayStartHour <= 10) {
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
    } else if (isLastDay && !breakfast?.restaurant && !skipBreakfast && !hotel?.breakfastIncluded && dayStartHour <= 10) {
      // Self-catered breakfast placeholder
      scheduler.addItem({
        id: `self-breakfast-${balancedDay.dayNumber}`,
        title: 'Petit-déjeuner',
        type: 'restaurant',
        duration: 30,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:00'),
        data: { name: '', description: '', estimatedCost: 0 },
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

    // 4. Get activities in Claude-specified order, but ensure must-sees come first
    const cluster = clusters.find(c => c.dayNumber === balancedDay.dayNumber);
    let orderedActivities = reorderByPlan(cluster, balancedDay.activityOrder);

    // Prioritize must-sees: move them to the front of the list so they're scheduled first.
    // This prevents the scenario where a must-see at position 5 gets dropped because
    // Optimize geographic order for ALL activities together using nearest-neighbor heuristic.
    // This reduces intra-day travel time (e.g. Vatican → Basilique St Pierre vs Vatican → far restaurant → back).
    // Unified approach: must-sees and non-must-sees are interleaved for optimal routing.
    const geoOptimize = (activities: ScoredActivity[], startLat: number, startLng: number) => {
      if (activities.length <= 2) return activities;
      const ordered: ScoredActivity[] = [];
      const remaining = [...activities];
      let curLat = startLat, curLng = startLng;
      while (remaining.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = calculateDistance(curLat, curLng, remaining[i].latitude, remaining[i].longitude);
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        }
        const next = remaining.splice(nearestIdx, 1)[0];
        ordered.push(next);
        curLat = next.latitude;
        curLng = next.longitude;
      }
      return ordered;
    };

    const startLat = hotel?.latitude || data.destCoords.lat;
    const startLng = hotel?.longitude || data.destCoords.lng;
    orderedActivities = geoOptimize(orderedActivities, startLat, startLng);

    const mustSeeCount = orderedActivities.filter(a => a.mustSee).length;
    console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ${orderedActivities.length} activities to schedule (${mustSeeCount} must-sees), dayStart=${dayStartHour}:00, dayEnd=${dayEndHour}:00, window=${dayEndHour - dayStartHour}h, cursor=${formatTimeHHMM(scheduler.getCurrentTime())}`);
    for (const a of orderedActivities) {
      console.log(`[Pipeline V2]   → "${a.name}" (${a.duration || 60}min, score=${a.score.toFixed(1)}, mustSee=${!!a.mustSee})`);
    }

    // 5. Insert breakfast for non-last days (last day already handled above)
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
      scheduler.addItem({
        id: `self-breakfast-${balancedDay.dayNumber}`,
        title: 'Petit-déjeuner',
        type: 'restaurant',
        duration: 30,
        minStartTime: parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`),
        maxEndTime: parseTime(dayDate, '10:00'),
        data: { name: '', description: '', estimatedCost: 0 },
      });
    }

    // 6. Pre-insert lunch if the day starts late (after 14:30 — arrival day)
    // In this case, the interleave loop will never hit the 11:30-14:30 window
    let lunchInserted = false;
    let dinnerInserted = false;

    const initialCursor = scheduler.getCurrentTime();
    const initialHour = initialCursor.getHours() + initialCursor.getMinutes() / 60;

    // If cursor starts between 11:30 and 14:30, insert lunch NOW before activities
    if (!skipLunch && lunch?.restaurant && initialHour >= 11.5 && initialHour < 14.5 && orderedActivities.length > 0) {
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
      const prev = i === 0 ? hotel : orderedActivities[i - 1];
      let travelTime = prev ? estimateTravel(prev, activity) : 10;
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

      if (!lunchInserted && !skipLunch && lunch?.restaurant && cursorHour >= 11.5 && cursorHour < 14.5) {
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

      if (!dinnerInserted && !skipDinner && dinner?.restaurant && cursorHour2 >= 18.5 && cursorHour2 < 21) {
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

      // Day-trip activities get extended duration (whole-day excursion)
      const activityDuration = balancedDay.isDayTrip
        ? Math.max(activity.duration || 120, 180) // At least 3h for day-trip activities
        : (activity.duration || 60);

      // Enforce opening/closing hours
      const activityMaxEndTime = getActivityMaxEndTime(activity, dayDate);
      const activityMinStartTime = getActivityMinStartTime(activity, dayDate);

      // Minimum meaningful duration for this activity type (e.g., 60min for museums)
      const actMinDuration = getMinDuration(activity.name || '', activity.type || '');

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
      if (!actResult && activity.mustSee) {
        const shortDuration = Math.max(actMinDuration, Math.floor(activityDuration * 0.5));
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Must-see "${activity.name}" rejected at ${activityDuration}min, retrying with ${shortDuration}min (min=${actMinDuration}min)`);
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
            const shortDuration = Math.max(actMinDuration, Math.floor(activityDuration * 0.5));
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
            latitude: hotel?.latitude || data.destCoords.lat,
            longitude: hotel?.longitude || data.destCoords.lng,
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
    if (!lunchInserted && !skipLunch) {
      const lunchDuration = lunch?.restaurant ? 60 : 45;
      const lunchData = lunch?.restaurant
        ? { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] }
        : { name: '', description: '', estimatedCost: 0 };
      const lunchTitle = lunch?.restaurant
        ? `Déjeuner — ${lunch.restaurant.name}`
        : 'Déjeuner';
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

    if (!dinnerInserted && !skipDinner) {
      const dinnerDuration = dinner?.restaurant ? 75 : 60;
      const dinnerData = dinner?.restaurant
        ? { ...dinner.restaurant, _alternatives: dinner.restaurantAlternatives || [] }
        : { name: '', description: '', estimatedCost: 0 };
      const dinnerTitle = dinner?.restaurant
        ? `Dîner — ${dinner.restaurant.name}`
        : 'Dîner';
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

    // 9b. Insert deferred Day 1 check-in (after activities, so pre-check-in activities aren't blocked)
    if (deferredCheckinData) {
      const checkinResult = scheduler.insertFixedItem(deferredCheckinData);
      if (!checkinResult) {
        console.warn(`[Pipeline V2] Deferred check-in insertFixedItem failed, using addItem fallback`);
        scheduler.addItem({
          id: `checkin-fallback-${balancedDay.dayNumber}`,
          title: deferredCheckinData.title,
          type: 'checkin',
          duration: 30,
          minStartTime: deferredCheckinData.startTime,
          maxEndTime: parseTime(dayDate, '22:00'),
          data: deferredCheckinData.data,
        });
      }
    }

    // 10. Remove scheduling conflicts (keep higher-priority items)
    scheduler.removeConflicts();

    // 11. Convert to TripItems
    const scheduleItems = scheduler.getItems();
    const tripItems: TripItem[] = scheduleItems.map((item, idx) => {
      const itemData = item.data || {};
      // Generate Google Maps "search by name" URL (more reliable than GPS coordinates)
      const placeName = itemData.name || item.title;
      const placeCity = preferences.destination || '';
      const googleMapsPlaceUrl = placeName
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName + ', ' + placeCity)}`
        : undefined;

      return {
        id: item.id || uuidv4(),
        dayNumber: balancedDay.dayNumber,
        startTime: formatTimeHHMM(item.slot.start),
        endTime: formatTimeHHMM(item.slot.end),
        type: item.type as TripItem['type'],
        title: item.title,
        description: buildDescription(itemData, item.type),
        locationName: itemData.locationName || itemData.address || itemData.name || '',
        latitude: itemData.latitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lat)
          || 0,
        longitude: itemData.longitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lng)
          || 0,
        orderIndex: idx,
        estimatedCost: itemData.estimatedCost
          || (item.type === 'flight' ? (itemData.pricePerPerson || itemData.price || 0) : 0)
          || (itemData.priceLevel ? (itemData.priceLevel || 1) * 15 : 0),
        duration: item.duration,
        rating: itemData.rating,
        bookingUrl: itemData.bookingUrl || itemData.reservationUrl
          || (item.type === 'restaurant' && (itemData.name || item.title)
            ? `https://www.thefork.com/search?queryPlace=${encodeURIComponent((itemData.name || item.title) + ', ' + preferences.destination)}`
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
        dataReliability: itemData.dataReliability || 'verified',
        imageUrl: itemData.photos?.[0] || itemData.imageUrl || itemData.photoUrl
          || (item.type === 'flight' ? TRANSPORT_IMAGES.flight : undefined)
          || (item.type === 'transport' ? (TRANSPORT_IMAGES[itemData.mode || ''] || TRANSPORT_IMAGES.train) : undefined),
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

  // 12. Enrich items missing images (Google Places photo lookup + Wikipedia fallback)
  // Non-critical: wrapped in try/catch so pipeline never fails because of images
  try {
    await enrichWithPlaceImages(days);
  } catch (e) {
    console.warn('[Pipeline V2] Image enrichment failed (non-critical):', e);
  }

  // 13. Batch fetch directions (non-blocking enrichment, 20s max)
  try {
    const directionsTimeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[Pipeline V2] ⚠️ Directions enrichment timeout (20s) — continuing');
        resolve();
      }, 20_000);
    });
    await Promise.race([
      enrichWithDirections(days),
      directionsTimeout,
    ]);
  } catch (e) {
    console.warn('[Pipeline V2] Directions enrichment failed:', e);
  }

  // 13. Build cost breakdown
  const costBreakdown = computeCostBreakdown(days, flights, hotel, preferences, transport);

  // 13b. Enrich hotel booking URLs with actual dates and guest count
  const checkinDate = startDate.toISOString().split('T')[0];
  const checkoutDate = new Date(startDate);
  checkoutDate.setDate(checkoutDate.getDate() + preferences.durationDays - 1);
  const checkoutDateStr = checkoutDate.toISOString().split('T')[0];
  const guests = preferences.groupSize || 2;

  const enrichBookingUrl = (url: string | undefined, hotelName: string): string => {
    if (!url) {
      // No URL at all — build a Booking.com search URL
      return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(hotelName + ' ' + preferences.destination)}&checkin=${checkinDate}&checkout=${checkoutDateStr}&group_adults=${guests}&no_rooms=1&lang=fr`;
    }
    // If already a booking.com URL with dates, keep it intact (from RapidAPI)
    if (url.includes('booking.com') && url.includes('checkin=') && url.includes('checkout=')) {
      return url;
    }
    // If booking.com URL but missing dates, inject them
    if (url.includes('booking.com')) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}checkin=${checkinDate}&checkout=${checkoutDateStr}&group_adults=${guests}&no_rooms=1&lang=fr`;
    }
    // Non-booking URL — return as-is
    return url;
  };

  if (hotel) {
    hotel.bookingUrl = enrichBookingUrl(hotel.bookingUrl, hotel.name);
  }
  // Also enrich alternative hotel options
  if (data.bookingHotels) {
    for (const h of data.bookingHotels) {
      (h as any).bookingUrl = enrichBookingUrl((h as any).bookingUrl, (h as any).name || '');
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

/**
 * Estimate travel time between two locations using Haversine.
 * For long distances (>15km, e.g. day-trip return), uses car/bus speed.
 */
function estimateTravel(from: any, to: any): number {
  const fromLat = from?.latitude || from?.lat;
  const fromLng = from?.longitude || from?.lng;
  const toLat = to?.latitude || to?.lat;
  const toLng = to?.longitude || to?.lng;

  if (!fromLat || !fromLng || !toLat || !toLng) return 10;

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
function getActivityMaxEndTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
  // PRIORITY 1: Use real opening hours if available (from viatorKnownProducts or API)
  if (activity.openingHours?.close && activity.openingHours.close !== '23:59') {
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
 * Get minimum start time for an activity based on its opening hours.
 * Prevents scheduling a museum visit at 07:00 when it opens at 10:00.
 */
function getActivityMinStartTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
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
async function enrichWithPlaceImages(days: TripDay[]): Promise<void> {
  try {
    const itemsNeedingImages: TripItem[] = [];
    const imageTypes = ['activity', 'restaurant', 'hotel', 'checkin', 'checkout'];

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
              item.longitude !== 0 ? item.longitude : undefined
            );
            if (imageUrl) {
              item.imageUrl = imageUrl;
            }
          } catch {
            // Individual item failure — skip silently
          }
        })
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
    console.log(`[Pipeline V2] ✅ Place images: ${enriched}/${itemsNeedingImages.length} enriched`);
  } catch (e) {
    console.warn('[Pipeline V2] Image enrichment error:', e);
  }
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
      let travelTime = estimateTravel(prev, curr);

      // Fix fakeGPS restaurants: when restaurant GPS is a city-center fallback,
      // distance to activities is meaningless (often 0km → 0min travel).
      // Enforce a minimum travel time for any restaurant transition.
      const isRestaurantTransition = prev.type === 'restaurant' || curr.type === 'restaurant';
      if (isRestaurantTransition && travelTime < 10) {
        travelTime = 10; // Minimum 10min to/from a restaurant
      }

      curr.timeFromPrevious = travelTime;
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

/**
 * Build a meaningful description for a TripItem, filtering out addresses.
 * Priority: real description > cuisineTypes/specialties > tips > empty.
 */
function buildDescription(itemData: any, itemType: string): string {
  if (!itemData) return '';
  // 1. If a real description exists and is NOT an address → use it
  if (itemData.description && typeof itemData.description === 'string' && !looksLikeAddress(itemData.description)) {
    return itemData.description;
  }

  // 2. For restaurants: build from cuisineTypes / specialties
  if (itemType === 'restaurant' && itemData.cuisineTypes?.length > 0) {
    const cuisine = itemData.cuisineTypes.slice(0, 3).join(', ');
    if (itemData.specialties?.length > 0) {
      return `${cuisine} · ${itemData.specialties[0]}`;
    }
    return cuisine;
  }

  // 3. Fallback to tips (often populated by Viator, attractions.ts curated data)
  if (itemData.tips && typeof itemData.tips === 'string' && !looksLikeAddress(itemData.tips)) {
    return itemData.tips;
  }

  // 4. Empty is better than an address
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
