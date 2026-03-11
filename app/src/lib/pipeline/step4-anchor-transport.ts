/**
 * Pipeline V3 — Step 4: Anchor Transport
 *
 * Computes per-day activity time windows based on arrival/departure transport.
 * Transport events (flights, trains) are immovable time anchors that constrain
 * the available time for activities on first and last days.
 *
 * For a 3-day trip with flight arrival at 10:30 and departure at 18:00:
 *   Day 1: 12:00 → 22:00 (arrival + transfer + buffer)
 *   Day 2: 08:30 → 22:00 (full day)
 *   Day 3: 08:30 → 15:30 (departure - transfer - buffer)
 */

import type { Flight, TransportOptionSummary } from '../types';
import { timeToMin, addMinutes } from './utils/time';

// ============================================
// Types
// ============================================

export interface DayTimeWindow {
  dayNumber: number;
  /** Activity start time in "HH:MM" format */
  activityStartTime: string;
  /** Activity end time in "HH:MM" format */
  activityEndTime: string;
  /** Whether this day has arrival transport constraining the morning */
  hasArrivalTransport: boolean;
  /** Whether this day has departure transport constraining the evening */
  hasDepartureTransport: boolean;
}

// ============================================
// Constants
// ============================================

/** Default activity window if no transport constraints */
const DEFAULT_START = '08:30';
const DEFAULT_END = '22:00';

/** Buffer after arrival (transfer + check-in + freshen up) */
const ARRIVAL_BUFFER_MIN = 90;

/** Buffer before departure (check-out + transfer + check-in at airport/station) */
const DEPARTURE_BUFFER_MIN = 150; // 2h30 before flight

/** Buffer for train departures (shorter than flights) */
const TRAIN_DEPARTURE_BUFFER_MIN = 75; // 1h15 before train

// ============================================
// Helpers
// ============================================

function subtractMinutesFromTime(time: string, minutes: number): string {
  return addMinutes(time, -minutes);
}

function clampTime(time: string, min: string, max: string): string {
  const val = timeToMin(time);
  const lo = timeToMin(min);
  const hi = timeToMin(max);
  if (val < lo) return min;
  if (val > hi) return max;
  return time;
}

/** Round time to nearest 5 minutes (ceiling) */
function roundUpTo5Min(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.ceil(m / 5) * 5;
  const newH = h + Math.floor(rounded / 60);
  const newM = rounded % 60;
  return `${String(newH % 24).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/** Round time to nearest 5 minutes (floor) */
function roundDownTo5Min(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.floor(m / 5) * 5;
  return `${String(h).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`;
}

// ============================================
// Main Function
// ============================================

/**
 * Compute per-day activity time windows based on transport constraints.
 *
 * @param durationDays - Total number of days in the trip
 * @param inboundFlight - Arrival flight (if any)
 * @param outboundFlight - Departure flight (if any)
 * @param inboundTransport - Arrival transport summary (train/bus, if any)
 * @param outboundTransport - Departure transport summary (train/bus, if any)
 * @returns Array of time windows, one per day
 */
export function anchorTransport(
  durationDays: number,
  inboundFlight?: Flight | null,
  outboundFlight?: Flight | null,
  inboundTransport?: TransportOptionSummary | null,
  outboundTransport?: TransportOptionSummary | null,
): DayTimeWindow[] {
  const windows: DayTimeWindow[] = [];

  for (let day = 1; day <= durationDays; day++) {
    let startTime = DEFAULT_START;
    let endTime = DEFAULT_END;
    let hasArrival = false;
    let hasDeparture = false;

    // Day 1: Constrain by arrival transport
    if (day === 1) {
      // Check inbound flight
      if (inboundFlight?.arrivalTime) {
        const arrivalTime = extractTimeFromDateString(inboundFlight.arrivalTime);
        if (arrivalTime) {
          const arrivalMin = timeToMin(arrivalTime);
          const rawStartMin = arrivalMin + ARRIVAL_BUFFER_MIN;
          // Late arrival (after 21:00): Day 1 is transit-only, no activities
          if (arrivalMin >= 21 * 60 || rawStartMin >= 23 * 60) {
            startTime = '23:59';
            endTime = '23:59';
            hasArrival = true;
          } else {
            startTime = roundUpTo5Min(addMinutes(arrivalTime, ARRIVAL_BUFFER_MIN));
            hasArrival = true;
          }
        }
      }
      // Check inbound train/bus (from last leg if present)
      if (inboundTransport?.transitLegs && inboundTransport.transitLegs.length > 0) {
        const lastLeg = inboundTransport.transitLegs[inboundTransport.transitLegs.length - 1];
        if (lastLeg.arrival) {
          const arrivalTime = extractTimeFromDateString(lastLeg.arrival);
          if (arrivalTime) {
            const arrivalMin = timeToMin(arrivalTime);
            // Late arrival by train (after 21:00): transit-only day
            if (arrivalMin >= 21 * 60) {
              startTime = '23:59';
              endTime = '23:59';
              hasArrival = true;
            } else {
              const trainStart = roundUpTo5Min(addMinutes(arrivalTime, 45)); // 45min buffer for trains
              if (!hasArrival || timeToMin(trainStart) > timeToMin(startTime)) {
                startTime = trainStart;
              }
              hasArrival = true;
            }
          }
        }
      }
      // Ensure reasonable bounds (skip if transit-only day)
      if (startTime !== '23:59') {
        startTime = clampTime(startTime, '07:00', '18:00');
      }
    }

    // Last day: Constrain by departure transport
    if (day === durationDays) {
      // Check outbound flight
      if (outboundFlight?.departureTime) {
        const departureTime = extractTimeFromDateString(outboundFlight.departureTime);
        if (departureTime) {
          endTime = roundDownTo5Min(subtractMinutesFromTime(departureTime, DEPARTURE_BUFFER_MIN));
          hasDeparture = true;
        }
      }
      // Check outbound train/bus (from first leg if present)
      if (outboundTransport?.transitLegs && outboundTransport.transitLegs.length > 0) {
        const firstLeg = outboundTransport.transitLegs[0];
        if (firstLeg.departure) {
          const departureTime = extractTimeFromDateString(firstLeg.departure);
          if (departureTime) {
            const trainEnd = roundDownTo5Min(subtractMinutesFromTime(departureTime, TRAIN_DEPARTURE_BUFFER_MIN));
            if (!hasDeparture || timeToMin(trainEnd) < timeToMin(endTime)) {
              endTime = trainEnd;
            }
            hasDeparture = true;
          }
        }
      }
      // Ensure reasonable bounds — departure days keep their computed cutoff
      // (early flights like 08:55 produce endTime=06:25, which is correct)
      if (hasDeparture) {
        endTime = clampTime(endTime, '04:00', '22:00');
      } else {
        endTime = clampTime(endTime, '10:00', '22:00');
      }
    }

    windows.push({
      dayNumber: day,
      activityStartTime: startTime,
      activityEndTime: endTime,
      hasArrivalTransport: hasArrival,
      hasDepartureTransport: hasDeparture,
    });
  }

  console.log(`[Anchor Transport] Generated time windows for ${durationDays} days:`);
  for (const w of windows) {
    console.log(`  Day ${w.dayNumber}: ${w.activityStartTime} → ${w.activityEndTime}${w.hasArrivalTransport ? ' (arrival)' : ''}${w.hasDepartureTransport ? ' (departure)' : ''}`);
  }

  return windows;
}

// ============================================
// Utility
// ============================================

/**
 * Extract "HH:MM" time from various date string formats.
 * Handles ISO strings, "HH:MM", and common flight time formats.
 */
function extractTimeFromDateString(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try HH:MM format directly
  const directMatch = dateStr.match(/^(\d{1,2}):(\d{2})$/);
  if (directMatch) {
    return `${directMatch[1].padStart(2, '0')}:${directMatch[2]}`;
  }

  // Try ISO date format
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
  } catch { /* ignore */ }

  // Try extracting time from string like "2024-07-15T10:30:00"
  const isoMatch = dateStr.match(/T(\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}:${isoMatch[2]}`;
  }

  // Try extracting time from string like "10:30" embedded somewhere
  const embeddedMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
  if (embeddedMatch) {
    return `${embeddedMatch[1].padStart(2, '0')}:${embeddedMatch[2]}`;
  }

  return null;
}
