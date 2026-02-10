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

const MODE_LABELS: Record<string, string> = {
  train: '🚄 Train', bus: '🚌 Bus', car: '🚗 Voiture',
  combined: '🔄 Transport', ferry: '⛴️ Ferry',
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
        title: `Vol ${flights.outbound.airline} ${flights.outbound.flightNumber}`,
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
        title: `Vol ${flights.return.airline} ${flights.return.flightNumber}`,
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
    const skipLunch = isLastDay && hasReturnTravel && dayEndHour <= 12;
    // Skip dinner only if the day ends before dinner time
    const skipDinner = (isLastDay && hasReturnTravel && dayEndHour < 19) ||
                       (isFirstDay && dayStartHour >= 20);

    // 3. Hotel check-in (first day) / check-out (last day)
    // IMPORTANT: On the last day, insert breakfast BEFORE checkout.
    // Otherwise checkout advances the cursor past breakfast's maxEndTime (10:00).
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
      const checkinResult = scheduler.insertFixedItem({
        id: `checkin-${balancedDay.dayNumber}`,
        title: `Check-in ${hotel.name}`,
        type: 'checkin',
        startTime: checkinTime,
        endTime: new Date(checkinTime.getTime() + 30 * 60 * 1000),
        data: hotel,
      });
      // FALLBACK: If insertFixedItem failed (overlap), use addItem to find a free slot
      if (!checkinResult) {
        console.warn(`[Pipeline V2] Check-in insertFixedItem failed at ${formatTime(checkinTime)}, using addItem fallback`);
        scheduler.addItem({
          id: `checkin-fallback-${balancedDay.dayNumber}`,
          title: `Check-in ${hotel.name}`,
          type: 'checkin',
          duration: 30,
          minStartTime: checkinTime,
          maxEndTime: parseTime(dayDate, '22:00'),
          data: hotel,
        });
      }
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
        data: breakfast.restaurant,
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
    // the schedule ran out of time after scheduling 4 non-must-see activities.
    const mustSeeActivities = orderedActivities.filter(a => a.mustSee);
    const nonMustSeeActivities = orderedActivities.filter(a => !a.mustSee);

    // Optimize geographic order within each group using nearest-neighbor heuristic.
    // This reduces intra-day travel time (e.g. Vatican → Basilique St Pierre vs Vatican → far restaurant → back).
    // Start from the accommodation or previous position.
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
    const optimizedMustSees = geoOptimize(mustSeeActivities, startLat, startLng);
    const lastMustSee = optimizedMustSees.length > 0 ? optimizedMustSees[optimizedMustSees.length - 1] : null;
    const optimizedNonMustSees = geoOptimize(nonMustSeeActivities,
      lastMustSee?.latitude || startLat,
      lastMustSee?.longitude || startLng
    );
    orderedActivities = [...optimizedMustSees, ...optimizedNonMustSees];

    console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ${orderedActivities.length} activities to schedule (${mustSeeActivities.length} must-sees), dayStart=${dayStartHour}:00, dayEnd=${dayEndHour}:00, window=${dayEndHour - dayStartHour}h, cursor=${formatTimeHHMM(scheduler.getCurrentTime())}`);
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
        data: breakfast.restaurant,
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
        data: lunch.restaurant,
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
          data: lunch.restaurant,
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
          data: dinner.restaurant,
        });
        if (result) dinnerInserted = true;
      }

      // Day-trip activities get extended duration (whole-day excursion)
      const activityDuration = balancedDay.isDayTrip
        ? Math.max(activity.duration || 120, 180) // At least 3h for day-trip activities
        : (activity.duration || 60);

      // Enforce closing hours for outdoor activities (parks, gardens, viewpoints)
      // These typically close at sunset — cap at 19:30 (generous for summer)
      const activityMaxEndTime = getActivityMaxEndTime(activity, dayDate);

      let actResult = scheduler.addItem({
        id: activity.id,
        title: activity.name,
        type: 'activity',
        duration: activityDuration,
        travelTime,
        maxEndTime: activityMaxEndTime,
        data: activity,
      });

      // MUST-SEE RETRY: If a must-see was rejected, retry with shorter duration (min 30min).
      // Keep the same maxEndTime — we don't relax closing hours (a museum that closes at 17:00
      // still closes at 17:00). But a 30min visit might fit where a 2h visit didn't.
      if (!actResult && activity.mustSee) {
        const shortDuration = Math.max(30, Math.floor(activityDuration * 0.5));
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Must-see "${activity.name}" rejected at ${activityDuration}min, retrying with ${shortDuration}min`);
        actResult = scheduler.addItem({
          id: activity.id,
          title: activity.name,
          type: 'activity',
          duration: shortDuration,
          travelTime: Math.min(travelTime, 10), // Reduce travel estimate too
          maxEndTime: activityMaxEndTime, // Same closing time — no cheating
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
            maxEndTime: activityMaxEndTime,
            data: activity,
          });

          // Also try with reduced duration if full doesn't fit
          if (!actResult) {
            const shortDuration = Math.max(30, Math.floor(activityDuration * 0.5));
            actResult = scheduler.addItem({
              id: activity.id,
              title: activity.name,
              type: 'activity',
              duration: shortDuration,
              travelTime: Math.min(travelTime, 5),
              maxEndTime: activityMaxEndTime,
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

    // 8. Insert any remaining meals after all activities
    // Use wider time windows for fallback (the scheduler handles conflicts)
    if (!lunchInserted && !skipLunch && lunch?.restaurant) {
      // Try with an extended window — better to have lunch a bit late than not at all
      const lunchMinStart = parseTime(dayDate, `${String(Math.max(11, dayStartHour)).padStart(2, '0')}:30`);
      const lunchMaxEnd = parseTime(dayDate, '15:30');
      const result = scheduler.addItem({
        id: `meal-${balancedDay.dayNumber}-lunch`,
        title: `Déjeuner — ${lunch.restaurant.name}`,
        type: 'restaurant',
        duration: 60,
        minStartTime: lunchMinStart,
        maxEndTime: lunchMaxEnd,
        data: lunch.restaurant,
      });
      if (result) lunchInserted = true;
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

    // 9. Insert return transport LAST (after activities and meals)
    // This prevents the cursor from advancing past dayEnd before activities are placed.
    if (returnTransportData) {
      scheduler.insertFixedItem(returnTransportData);
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
        description: itemData.description || '',
        locationName: itemData.locationName || itemData.address || itemData.name || item.title,
        latitude: itemData.latitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lat)
          || 0,
        longitude: itemData.longitude
          || (item.type === 'transport' && itemData.segments?.[0]?.toCoords?.lng)
          || 0,
        orderIndex: idx,
        estimatedCost: itemData.estimatedCost || (itemData.priceLevel ? (itemData.priceLevel || 1) * 15 : 0),
        duration: item.duration,
        rating: itemData.rating,
        bookingUrl: itemData.bookingUrl || itemData.reservationUrl
          || (item.type === 'restaurant' && (itemData.name || item.title)
            ? `https://www.thefork.com/search?queryPlace=${encodeURIComponent((itemData.name || item.title) + ', ' + preferences.destination)}`
            : undefined),
        viatorUrl: itemData.viatorUrl,
        googleMapsPlaceUrl,
        restaurant: item.type === 'restaurant' ? itemData : undefined,
        accommodation: (item.type === 'checkin' || item.type === 'checkout') ? itemData : undefined,
        flight: item.type === 'flight' ? itemData : undefined,
        // Transport-specific fields (train/bus legs, price range)
        transitLegs: itemData.transitLegs,
        transitDataSource: itemData.transitDataSource,
        priceRange: itemData.priceRange,
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

  // 12. Batch fetch directions (non-blocking enrichment)
  await enrichWithDirections(days).catch(e =>
    console.warn('[Pipeline V2] Directions enrichment failed:', e)
  );

  // 13. Build cost breakdown
  const costBreakdown = computeCostBreakdown(days, flights, hotel, preferences, transport);

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
import { OUTDOOR_ACTIVITY_KEYWORDS, INDOOR_ACTIVITY_KEYWORDS } from './utils/constants';

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
