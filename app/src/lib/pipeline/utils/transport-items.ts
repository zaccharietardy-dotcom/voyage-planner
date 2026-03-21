/**
 * Transport item builders — extracted from step4-assemble-llm.ts
 *
 * Builds outbound and return transport TripItems (flight, train, plane fallback, generic ground).
 * Used by the V3 pipeline assembler.
 */

import type {
  TripDay,
  TripItem,
  TripPreferences,
  Flight,
  TransportOptionSummary,
} from '../../types';
import { AIRPORTS } from '../../services/geocoding';
import { generateFlightLink, generateFlightOmioLink, formatDateForUrl } from '../../services/linkGenerator';
import {
  buildTrainDescription,
  getTransitLegsDurationMinutes,
  normalizeReturnTransportBookingUrl,
  rebaseTransitLegsToTimeline,
} from './longhaulConsistency';

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
  const clamped = Math.max(0, Math.min(23 * 60 + 55, Math.round(totalMinutes)));
  // Round to nearest 5 minutes for clean display (no 14:56, 17:21, etc.)
  const rounded = Math.round(clamped / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseHHMM(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ============================================
// Outbound transport
// ============================================

export function addOutboundTransportItem(
  day1: TripDay,
  flight: Flight | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  fallbackCoords: { lat: number; lng: number }
): void {
  if (!flight && !transport) return;

  // Compute return date for round-trip Aviasales links
  const returnDate = new Date(preferences.startDate);
  returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);

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
      latitude: AIRPORTS[flight.departureAirportCode]?.latitude ?? fallbackCoords.lat,
      longitude: AIRPORTS[flight.departureAirportCode]?.longitude ?? fallbackCoords.lng,
      orderIndex: 0,
      duration: flight.duration,
      flight: flight,
      flightAlternatives: [],
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: flight.price,
      bookingUrl: flight.bookingUrl || generateFlightLink(
        { origin: flight.departureCity, destination: flight.arrivalCity },
        { date: formatDateForUrl(preferences.startDate), returnDate: formatDateForUrl(returnDate), passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: flight.departureCity, destination: flight.arrivalCity },
        { date: formatDateForUrl(preferences.startDate), returnDate: formatDateForUrl(returnDate), passengers: preferences.groupSize }
      ),
      omioFlightUrl: generateFlightOmioLink(
        flight.departureCity, flight.arrivalCity,
        formatDateForUrl(preferences.startDate), preferences.groupSize
      ),
    };

    day1.items.unshift(flightItem);
  } else if (transport && transport.mode === 'train' && transport.transitLegs) {
    // Add train transport item
    const firstLeg = transport.transitLegs[0];
    const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
    const outboundDuration = getTransitLegsDurationMinutes(transport.transitLegs as TripItem['transitLegs']) || transport.totalDuration;

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: minutesToHHMM(parseHHMM(firstLeg.departure.split('T')[1]?.substring(0, 5) || '08:00')),
      endTime: minutesToHHMM(parseHHMM(lastLeg.arrival.split('T')[1]?.substring(0, 5) || '12:00')),
      type: 'transport',
      title: `${firstLeg.from} → ${lastLeg.to}`,
      description: buildTrainDescription('Train', transport.transitLegs.map((leg) => leg.operator)),
      locationName: firstLeg.from,
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: 0,
      duration: outboundDuration,
      transitLegs: transport.transitLegs,
      transitDataSource: transport.dataSource || 'api',
      transportMode: 'train',
      transportRole: 'longhaul',
      transportDirection: 'outbound',
      transportTimeSource: transport.dataSource || 'api',
      imageUrl: '/images/transport/train-sncf-duplex.jpg',
      estimatedCost: transport.totalPrice,
      bookingUrl: transport.bookingUrl,
    };

    day1.items.unshift(trainItem);
  } else if (transport && transport.mode === 'plane') {
    // Fallback: plane recommended but no flight data (API timeout/failure/no results)
    const departMin = parseHHMM('08:00');
    const arrivalMin = departMin + (transport.totalDuration || 180);
    const outboundDateStr = formatDateForUrl(preferences.startDate);

    const flightFallbackItem: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: '08:00',
      endTime: minutesToHHMM(arrivalMin),
      type: 'flight',
      title: `Vol ${preferences.origin} → ${preferences.destination}`,
      description: 'Réservez votre vol',
      locationName: preferences.origin,
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: 0,
      duration: transport.totalDuration || 180,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: transport.totalPrice,
      bookingUrl: generateFlightLink(
        { origin: preferences.origin, destination: preferences.destination },
        { date: outboundDateStr, returnDate: formatDateForUrl(returnDate), passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: preferences.origin, destination: preferences.destination },
        { date: outboundDateStr, returnDate: formatDateForUrl(returnDate), passengers: preferences.groupSize }
      ),
      omioFlightUrl: generateFlightOmioLink(
        preferences.origin, preferences.destination,
        outboundDateStr, preferences.groupSize
      ),
    };

    day1.items.unshift(flightFallbackItem);
  }

  // Re-index order
  day1.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

// ============================================
// Return transport
// ============================================

export function addReturnTransportItem(
  lastDay: TripDay,
  returnFlight: Flight | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  fallbackCoords: { lat: number; lng: number }
): void {
  if (!returnFlight && !transport) return;

  if (returnFlight) {
    const returnDate = new Date(preferences.startDate);
    returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
    const returnDateStr = formatDateForUrl(returnDate);

    const flightItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: returnFlight.departureTimeDisplay || '18:00',
      endTime: returnFlight.arrivalTimeDisplay || '22:00',
      type: 'flight',
      title: `${returnFlight.departureCity} → ${returnFlight.arrivalCity}`,
      description: `Vol ${returnFlight.airline} ${returnFlight.flightNumber || ''}`.trim(),
      locationName: returnFlight.departureAirport,
      latitude: AIRPORTS[returnFlight.departureAirportCode]?.latitude ?? fallbackCoords.lat,
      longitude: AIRPORTS[returnFlight.departureAirportCode]?.longitude ?? fallbackCoords.lng,
      orderIndex: lastDay.items.length,
      duration: returnFlight.duration,
      flight: returnFlight,
      flightAlternatives: [],
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: returnFlight.price,
      bookingUrl: returnFlight.bookingUrl || generateFlightLink(
        { origin: returnFlight.departureCity, destination: returnFlight.arrivalCity },
        { date: returnDateStr, passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: returnFlight.departureCity, destination: returnFlight.arrivalCity },
        { date: returnDateStr, passengers: preferences.groupSize }
      ),
      omioFlightUrl: generateFlightOmioLink(
        returnFlight.departureCity, returnFlight.arrivalCity,
        returnDateStr, preferences.groupSize
      ),
    };

    lastDay.items.push(flightItem);
  } else if (transport && transport.mode === 'train' && transport.transitLegs) {
    // Estimate return departure: afternoon (17:00 default), then rebase legs.
    const returnDepartMin = 17 * 60; // 17:00
    const returnStart = new Date(lastDay.date);
    returnStart.setHours(Math.floor(returnDepartMin / 60), returnDepartMin % 60, 0, 0);
    const rebasedReturnLegs = rebaseTransitLegsToTimeline({
      transitLegs: transport.transitLegs as TripItem['transitLegs'],
      startTime: returnStart,
      direction: 'return',
    });
    const rebasedReturnDuration = getTransitLegsDurationMinutes(rebasedReturnLegs) || transport.totalDuration || 120;
    const returnArrivalMin = returnDepartMin + rebasedReturnDuration;
    const returnFirstLeg = rebasedReturnLegs?.[0];
    const returnLastLeg = rebasedReturnLegs?.[rebasedReturnLegs.length - 1];

    const trainItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(returnDepartMin),
      endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 59)),
      type: 'transport',
      title: `${returnFirstLeg?.from || preferences.destination} → ${returnLastLeg?.to || preferences.origin}`,
      description: buildTrainDescription('Train retour', (rebasedReturnLegs || []).map((leg) => leg.operator)),
      locationName: returnFirstLeg?.from || preferences.destination,
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: lastDay.items.length,
      duration: rebasedReturnDuration,
      transitLegs: rebasedReturnLegs,
      transitDataSource: transport.dataSource || 'api',
      transportMode: 'train',
      transportRole: 'longhaul',
      transportDirection: 'return',
      transportTimeSource: rebasedReturnLegs?.length ? 'rebased' : 'estimated',
      imageUrl: '/images/transport/train-sncf-duplex.jpg',
      estimatedCost: transport.totalPrice,
      bookingUrl: normalizeReturnTransportBookingUrl(transport.bookingUrl, returnStart, { swapOmioDirection: true }),
    };

    lastDay.items.push(trainItem);
  } else if (transport && transport.mode === 'plane') {
    // Fallback: plane recommended but no return flight data
    const returnDepartMin = 17 * 60;
    const returnArrivalMin = returnDepartMin + (transport.totalDuration || 180);
    const returnDate = new Date(preferences.startDate);
    returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
    const returnDateStr = formatDateForUrl(returnDate);

    const flightFallbackItem: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(returnDepartMin),
      endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 59)),
      type: 'flight',
      title: `Vol ${preferences.destination} → ${preferences.origin}`,
      description: 'Réservez votre vol retour',
      locationName: preferences.destination,
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: lastDay.items.length,
      duration: transport.totalDuration || 180,
      imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
      estimatedCost: transport.totalPrice,
      bookingUrl: generateFlightLink(
        { origin: preferences.destination, destination: preferences.origin },
        { date: returnDateStr, passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: preferences.destination, destination: preferences.origin },
        { date: returnDateStr, passengers: preferences.groupSize }
      ),
      omioFlightUrl: generateFlightOmioLink(
        preferences.destination, preferences.origin,
        returnDateStr, preferences.groupSize
      ),
    };

    lastDay.items.push(flightFallbackItem);
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
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: lastDay.items.length,
      duration: transport.totalDuration,
      transportMode: transport.mode as any,
      transportRole: 'longhaul',
      transportDirection: 'return',
      transportTimeSource: 'estimated',
      estimatedCost: transport.totalPrice,
      bookingUrl: normalizeReturnTransportBookingUrl(transport.bookingUrl, lastDay.date, { swapOmioDirection: true }),
    };

    lastDay.items.push(trainItem);
  }

  // Re-index order
  lastDay.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}
