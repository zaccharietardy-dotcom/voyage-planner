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
import { AIRPORTS, calculateDistance } from '../../services/geocoding';
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

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferFallbackLonghaulMode(preferences: TripPreferences, distanceKm: number): 'car' | 'train' | 'bus' | 'plane' {
  if (preferences.transport && preferences.transport !== 'optimal') {
    if (preferences.transport === 'plane') return 'plane';
    if (preferences.transport === 'train') return 'train';
    if (preferences.transport === 'car') return 'car';
    if (preferences.transport === 'bus') return 'bus';
  }
  if (distanceKm >= 650) return 'plane';
  if (distanceKm >= 180) return 'train';
  if (distanceKm >= 90) return 'bus';
  return 'car';
}

function estimateLonghaulDurationMin(mode: 'car' | 'train' | 'bus' | 'plane', distanceKm: number): number {
  const speedKmh = mode === 'plane'
    ? 700
    : mode === 'train'
      ? 110
      : mode === 'bus'
        ? 60
        : 70;
  const fixedBuffer = mode === 'plane' ? 120 : 20;
  const travelMin = Math.max(45, Math.round((distanceKm / Math.max(1, speedKmh)) * 60));
  return Math.max(75, travelMin + fixedBuffer);
}

function estimateLonghaulCostEur(mode: 'car' | 'train' | 'bus' | 'plane', distanceKm: number, groupSize: number): number {
  const perKm = mode === 'plane'
    ? 0.22
    : mode === 'train'
      ? 0.12
      : mode === 'bus'
        ? 0.08
        : 0.18;
  const base = Math.max(25, Math.round(distanceKm * perKm));
  const multiplier = mode === 'car' ? 1 : Math.max(1, groupSize || 1);
  return Math.round(base * multiplier);
}

function shouldInjectLonghaulFallback(preferences: TripPreferences): boolean {
  return normalizeText(preferences.origin) !== normalizeText(preferences.destination);
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
  // Compute return date for round-trip Aviasales links
  const returnDate = new Date(preferences.startDate);
  returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
  const fallbackDistanceKm = preferences.originCoords
    ? calculateDistance(
      preferences.originCoords.lat,
      preferences.originCoords.lng,
      fallbackCoords.lat,
      fallbackCoords.lng,
    )
    : 150;

  if (flight) {
    const flightItem: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: flight.departureTimeDisplay || '08:00',
      endTime: flight.arrivalTimeDisplay || '12:00',
      type: 'flight',
      title: `${flight.departureCity} -> ${flight.arrivalCity}`,
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
      title: `${firstLeg.from} -> ${lastLeg.to}`,
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
      title: `Vol ${preferences.origin} -> ${preferences.destination}`,
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
  } else if (transport && transport.mode !== 'plane' && !transport.transitLegs) {
    const departMin = parseHHMM('08:00');
    const durationMin = Math.max(60, transport.totalDuration || estimateLonghaulDurationMin(
      transport.mode as 'car' | 'train' | 'bus',
      fallbackDistanceKm,
    ));
    const arriveMin = departMin + durationMin;
    const mode = (transport.mode as 'car' | 'train' | 'bus');
    const genericOutbound: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: minutesToHHMM(departMin),
      endTime: minutesToHHMM(Math.min(arriveMin, 23 * 60 + 55)),
      type: 'transport',
      title: `${preferences.origin} -> ${preferences.destination}`,
      description: `Trajet ${mode} estimé`,
      locationName: preferences.origin,
      latitude: preferences.originCoords?.lat ?? fallbackCoords.lat,
      longitude: preferences.originCoords?.lng ?? fallbackCoords.lng,
      orderIndex: 0,
      duration: durationMin,
      transportMode: mode,
      transportRole: 'longhaul',
      transportDirection: 'outbound',
      transportTimeSource: 'estimated',
      selectionSource: 'api',
      estimatedCost: transport.totalPrice || estimateLonghaulCostEur(mode, fallbackDistanceKm, preferences.groupSize || 1),
      bookingUrl: transport.bookingUrl,
    };
    day1.items.unshift(genericOutbound);
  } else if (!flight && !transport && shouldInjectLonghaulFallback(preferences)) {
    const mode = inferFallbackLonghaulMode(preferences, fallbackDistanceKm);
    const durationMin = estimateLonghaulDurationMin(mode, fallbackDistanceKm);
    const departMin = parseHHMM('08:00');
    const arriveMin = departMin + durationMin;
    const fallbackOutbound: TripItem = {
      id: uuidv4(),
      dayNumber: 1,
      startTime: minutesToHHMM(departMin),
      endTime: minutesToHHMM(Math.min(arriveMin, 23 * 60 + 55)),
      type: 'transport',
      title: `${preferences.origin} -> ${preferences.destination}`,
      description: `Trajet ${mode} estimé (fallback)`,
      locationName: preferences.origin,
      latitude: preferences.originCoords?.lat ?? fallbackCoords.lat,
      longitude: preferences.originCoords?.lng ?? fallbackCoords.lng,
      orderIndex: 0,
      duration: durationMin,
      transportMode: mode === 'plane' ? 'transit' : mode,
      transportRole: 'longhaul',
      transportDirection: 'outbound',
      transportTimeSource: 'estimated_fallback',
      selectionSource: 'fallback',
      estimatedCost: estimateLonghaulCostEur(mode, fallbackDistanceKm, preferences.groupSize || 1),
    };
    day1.items.unshift(fallbackOutbound);
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
  const fallbackDistanceKm = preferences.originCoords
    ? calculateDistance(
      fallbackCoords.lat,
      fallbackCoords.lng,
      preferences.originCoords.lat,
      preferences.originCoords.lng,
    )
    : 150;

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
      title: `${returnFlight.departureCity} -> ${returnFlight.arrivalCity}`,
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
      title: `${returnFirstLeg?.from || preferences.destination} -> ${returnLastLeg?.to || preferences.origin}`,
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
      title: `Vol ${preferences.destination} -> ${preferences.origin}`,
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
      title: `${preferences.destination} -> ${preferences.origin}`,
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
  } else if (!returnFlight && !transport && shouldInjectLonghaulFallback(preferences)) {
    const mode = inferFallbackLonghaulMode(preferences, fallbackDistanceKm);
    const durationMin = estimateLonghaulDurationMin(mode, fallbackDistanceKm);
    const returnDepartMin = 17 * 60;
    const returnArrivalMin = returnDepartMin + durationMin;
    const fallbackReturn: TripItem = {
      id: uuidv4(),
      dayNumber: lastDay.dayNumber,
      startTime: minutesToHHMM(returnDepartMin),
      endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 55)),
      type: 'transport',
      title: `${preferences.destination} -> ${preferences.origin}`,
      description: `Trajet ${mode} estimé (fallback)`,
      locationName: preferences.destination,
      latitude: fallbackCoords.lat,
      longitude: fallbackCoords.lng,
      orderIndex: lastDay.items.length,
      duration: durationMin,
      transportMode: mode === 'plane' ? 'transit' : mode,
      transportRole: 'longhaul',
      transportDirection: 'return',
      transportTimeSource: 'estimated_fallback',
      selectionSource: 'fallback',
      estimatedCost: estimateLonghaulCostEur(mode, fallbackDistanceKm, preferences.groupSize || 1),
    };
    lastDay.items.push(fallbackReturn);
  }

  // Re-index order
  lastDay.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}
