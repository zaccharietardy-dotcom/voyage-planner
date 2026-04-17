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
import {
  generateFlightLink,
  generateFlightOmioLink,
  generateTrainOmioLink,
  generateTrainlineLink,
  generateSNCFLink,
  generateFlixBusLink,
  generateGoogleMapsDirectionsLink,
  formatDateForUrl,
} from '../../services/linkGenerator';
import type { TransportPlan, TransportLeg, LegMode } from '../types/transport-plan';
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
  const outboundDateStr = formatDateForUrl(preferences.startDate);
  const returnDateStr = formatDateForUrl(returnDate);
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
        { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: flight.departureCity, destination: flight.arrivalCity },
        { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
      ),
      omioFlightUrl: generateFlightOmioLink(
        flight.departureCity, flight.arrivalCity,
        outboundDateStr, preferences.groupSize
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
      bookingUrl: transport.bookingUrl || generateTrainOmioLink(
        preferences.origin,
        preferences.destination,
        outboundDateStr,
        preferences.groupSize
      ),
    };

    day1.items.unshift(trainItem);
  } else if (transport && transport.mode === 'plane') {
    // Fallback: plane recommended but no flight data (API timeout/failure/no results)
    const departMin = parseHHMM('08:00');
    const arrivalMin = departMin + (transport.totalDuration || 180);
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
        { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
      ),
      aviasalesUrl: generateFlightLink(
        { origin: preferences.origin, destination: preferences.destination },
        { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
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
      bookingUrl:
        transport.bookingUrl
        || (mode === 'train'
          ? generateTrainOmioLink(preferences.origin, preferences.destination, outboundDateStr, preferences.groupSize)
          : undefined),
    };
    day1.items.unshift(genericOutbound);
  } else if (!flight && !transport && shouldInjectLonghaulFallback(preferences)) {
    const mode = inferFallbackLonghaulMode(preferences, fallbackDistanceKm);
    const durationMin = estimateLonghaulDurationMin(mode, fallbackDistanceKm);
    const departMin = parseHHMM('08:00');
    const arriveMin = departMin + durationMin;
    if (mode === 'plane') {
      const fallbackOutboundFlight: TripItem = {
        id: uuidv4(),
        dayNumber: 1,
        startTime: minutesToHHMM(departMin),
        endTime: minutesToHHMM(Math.min(arriveMin, 23 * 60 + 55)),
        type: 'flight',
        title: `Vol ${preferences.origin} -> ${preferences.destination}`,
        description: 'Réservez votre vol',
        locationName: preferences.origin,
        latitude: preferences.originCoords?.lat ?? fallbackCoords.lat,
        longitude: preferences.originCoords?.lng ?? fallbackCoords.lng,
        orderIndex: 0,
        duration: durationMin,
        selectionSource: 'fallback',
        transportRole: 'longhaul',
        transportDirection: 'outbound',
        transportTimeSource: 'estimated_fallback',
        imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
        estimatedCost: estimateLonghaulCostEur('plane', fallbackDistanceKm, preferences.groupSize || 1),
        bookingUrl: generateFlightLink(
          { origin: preferences.origin, destination: preferences.destination },
          { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
        ),
        aviasalesUrl: generateFlightLink(
          { origin: preferences.origin, destination: preferences.destination },
          { date: outboundDateStr, returnDate: returnDateStr, passengers: preferences.groupSize }
        ),
        omioFlightUrl: generateFlightOmioLink(
          preferences.origin,
          preferences.destination,
          outboundDateStr,
          preferences.groupSize
        ),
      };
      day1.items.unshift(fallbackOutboundFlight);
    } else {
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
        transportMode: mode,
        transportRole: 'longhaul',
        transportDirection: 'outbound',
        transportTimeSource: 'estimated_fallback',
        selectionSource: 'fallback',
        estimatedCost: estimateLonghaulCostEur(mode, fallbackDistanceKm, preferences.groupSize || 1),
        bookingUrl: mode === 'train'
          ? generateTrainOmioLink(preferences.origin, preferences.destination, outboundDateStr, preferences.groupSize)
          : undefined,
      };
      day1.items.unshift(fallbackOutbound);
    }
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
  const returnDate = new Date(preferences.startDate);
  returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
  const returnDateStr = formatDateForUrl(returnDate);
  const fallbackDistanceKm = preferences.originCoords
    ? calculateDistance(
      fallbackCoords.lat,
      fallbackCoords.lng,
      preferences.originCoords.lat,
      preferences.originCoords.lng,
    )
    : 150;

  if (returnFlight) {
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
      bookingUrl: normalizeReturnTransportBookingUrl(
        transport.bookingUrl
          || generateTrainOmioLink(
            preferences.destination,
            preferences.origin,
            formatDateForUrl(returnStart),
            preferences.groupSize
          ),
        returnStart,
        { swapOmioDirection: true }
      ),
    };

    lastDay.items.push(trainItem);
  } else if (transport && transport.mode === 'plane') {
    // Fallback: plane recommended but no return flight data
    const returnDepartMin = 17 * 60;
    const returnArrivalMin = returnDepartMin + (transport.totalDuration || 180);
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
      bookingUrl: normalizeReturnTransportBookingUrl(
        transport.bookingUrl
          || (transport.mode === 'train'
            ? generateTrainOmioLink(preferences.destination, preferences.origin, returnDateStr, preferences.groupSize)
            : undefined),
        lastDay.date,
        { swapOmioDirection: true }
      ),
    };

    lastDay.items.push(trainItem);
  } else if (!returnFlight && !transport && shouldInjectLonghaulFallback(preferences)) {
    const mode = inferFallbackLonghaulMode(preferences, fallbackDistanceKm);
    const durationMin = estimateLonghaulDurationMin(mode, fallbackDistanceKm);
    const returnDepartMin = 17 * 60;
    const returnArrivalMin = returnDepartMin + durationMin;
    if (mode === 'plane') {
      const fallbackReturnFlight: TripItem = {
        id: uuidv4(),
        dayNumber: lastDay.dayNumber,
        startTime: minutesToHHMM(returnDepartMin),
        endTime: minutesToHHMM(Math.min(returnArrivalMin, 23 * 60 + 55)),
        type: 'flight',
        title: `Vol ${preferences.destination} -> ${preferences.origin}`,
        description: 'Réservez votre vol retour',
        locationName: preferences.destination,
        latitude: fallbackCoords.lat,
        longitude: fallbackCoords.lng,
        orderIndex: lastDay.items.length,
        duration: durationMin,
        selectionSource: 'fallback',
        transportRole: 'longhaul',
        transportDirection: 'return',
        transportTimeSource: 'estimated_fallback',
        imageUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
        estimatedCost: estimateLonghaulCostEur('plane', fallbackDistanceKm, preferences.groupSize || 1),
        bookingUrl: generateFlightLink(
          { origin: preferences.destination, destination: preferences.origin },
          { date: returnDateStr, passengers: preferences.groupSize }
        ),
        aviasalesUrl: generateFlightLink(
          { origin: preferences.destination, destination: preferences.origin },
          { date: returnDateStr, passengers: preferences.groupSize }
        ),
        omioFlightUrl: generateFlightOmioLink(
          preferences.destination,
          preferences.origin,
          returnDateStr,
          preferences.groupSize
        ),
      };
      lastDay.items.push(fallbackReturnFlight);
    } else {
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
        transportMode: mode,
        transportRole: 'longhaul',
        transportDirection: 'return',
        transportTimeSource: 'estimated_fallback',
        selectionSource: 'fallback',
        estimatedCost: estimateLonghaulCostEur(mode, fallbackDistanceKm, preferences.groupSize || 1),
        bookingUrl: mode === 'train'
          ? generateTrainOmioLink(preferences.destination, preferences.origin, returnDateStr, preferences.groupSize)
          : undefined,
      };
      lastDay.items.push(fallbackReturn);
    }
  }

  // Re-index order
  lastDay.items.forEach((item, idx) => {
    item.orderIndex = idx;
  });
}

// ============================================
// Multi-leg transport items (TransportPlan-driven)
// ============================================

const LEG_IMAGES: Partial<Record<LegMode, string>> = {
  plane: 'https://images.unsplash.com/photo-1436491865332-7a61a109db05?w=600&h=400&fit=crop',
  train: '/images/transport/train-sncf-duplex.jpg',
  high_speed_train: '/images/transport/train-sncf-duplex.jpg',
  bus: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&h=400&fit=crop',
  car: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=600&h=400&fit=crop',
};

function legModeToTripItemMode(mode: LegMode): NonNullable<TripItem['transportMode']> {
  switch (mode) {
    case 'plane': return 'plane';
    case 'high_speed_train':
    case 'train': return 'train';
    case 'bus': return 'bus';
    case 'car': return 'car';
    case 'taxi': return 'taxi';
    case 'ferry': return 'ferry';
    case 'rer': return 'RER';
    case 'metro': return 'metro';
    case 'walk': return 'walking';
  }
}

function legIsMainHaul(leg: TransportLeg): boolean {
  return leg.mode === 'plane' || leg.mode === 'high_speed_train' || leg.mode === 'ferry' || (leg.mode === 'train' && !!leg.from.hub && !!leg.to.hub) || (leg.mode === 'bus' && !!leg.from.hub && !!leg.to.hub) || (leg.mode === 'car' && leg.durationMin > 60);
}

function buildLegBookingUrls(
  leg: TransportLeg,
  preferences: TripPreferences,
  dateStr: string,
  returnDateStr: string,
): { bookingUrl?: string; aviasalesUrl?: string; omioFlightUrl?: string } {
  const fromName = leg.from.hub?.city || leg.from.hub?.name || leg.from.name;
  const toName = leg.to.hub?.city || leg.to.hub?.name || leg.to.name;
  const passengers = preferences.groupSize || 1;

  if (leg.mode === 'plane') {
    const originForIata = leg.from.hub?.code || fromName;
    const destForIata = leg.to.hub?.code || toName;
    const aviasales = generateFlightLink(
      { origin: originForIata, destination: destForIata },
      { date: dateStr, returnDate: returnDateStr, passengers },
    );
    const omio = generateFlightOmioLink(fromName, toName, dateStr, passengers);
    return { bookingUrl: aviasales, aviasalesUrl: aviasales, omioFlightUrl: omio };
  }

  if (leg.mode === 'train' || leg.mode === 'high_speed_train') {
    const isFrance = /france|france$/i.test(leg.from.hub?.country || '') || /france|france$/i.test(leg.to.hub?.country || '');
    const primary = isFrance
      ? generateSNCFLink(fromName, toName, dateStr, passengers)
      : generateTrainlineLink(fromName, toName, dateStr, passengers);
    const omio = generateTrainOmioLink(fromName, toName, dateStr, passengers);
    return { bookingUrl: primary, omioFlightUrl: omio };
  }

  if (leg.mode === 'bus') {
    const primary = generateFlixBusLink(fromName, toName, dateStr, passengers);
    return { bookingUrl: primary };
  }

  // Transfers (rer, metro, taxi, walk, car) → Google Maps Directions
  const travelMode: 'transit' | 'driving' | 'walking' = leg.mode === 'walk'
    ? 'walking'
    : leg.mode === 'car' || leg.mode === 'taxi' ? 'driving' : 'transit';
  return {
    bookingUrl: generateGoogleMapsDirectionsLink(
      { name: leg.from.name, lat: leg.from.lat, lng: leg.from.lng },
      { name: leg.to.name, lat: leg.to.lat, lng: leg.to.lng },
      travelMode,
    ),
  };
}

function legTitle(leg: TransportLeg): string {
  const from = leg.from.hub?.code || leg.from.name;
  const to = leg.to.hub?.code || leg.to.name;
  const prefix = leg.mode === 'plane'
    ? 'Vol'
    : leg.mode === 'high_speed_train' ? 'TGV / train rapide'
    : leg.mode === 'train' ? 'Train'
    : leg.mode === 'bus' ? 'Bus longue distance'
    : leg.mode === 'car' ? 'Route'
    : leg.mode === 'taxi' ? 'Taxi'
    : leg.mode === 'rer' ? 'RER'
    : leg.mode === 'metro' ? 'Métro'
    : leg.mode === 'ferry' ? 'Ferry'
    : 'Transfert';
  return `${prefix} ${from} → ${to}`;
}

function legDescription(leg: TransportLeg): string {
  const parts: string[] = [];
  if (leg.provider) parts.push(leg.provider);
  if (leg.reasoning) parts.push(leg.reasoning);
  if (parts.length === 0) return '';
  return parts.join(' · ');
}

function buildLegItem(
  leg: TransportLeg,
  direction: 'outbound' | 'return',
  dayNumber: number,
  startTimeMin: number,
  preferences: TripPreferences,
  dateStr: string,
  returnDateStr: string,
): TripItem {
  const isMain = legIsMainHaul(leg);
  const role = isMain ? 'longhaul' : 'transfer_hub';
  const itemType: TripItem['type'] = leg.mode === 'plane' ? 'flight' : 'transport';
  const urls = buildLegBookingUrls(leg, preferences, dateStr, returnDateStr);
  const endTimeMin = startTimeMin + leg.durationMin;

  return {
    id: uuidv4(),
    dayNumber,
    startTime: minutesToHHMM(startTimeMin),
    endTime: minutesToHHMM(Math.min(endTimeMin, 23 * 60 + 55)),
    type: itemType,
    title: legTitle(leg),
    description: legDescription(leg),
    locationName: leg.from.hub?.name || leg.from.name,
    latitude: leg.from.lat,
    longitude: leg.from.lng,
    orderIndex: 0,
    duration: leg.durationMin,
    imageUrl: LEG_IMAGES[leg.mode],
    estimatedCost: Math.round(leg.costEur * (preferences.groupSize || 1)),
    transportMode: legModeToTripItemMode(leg.mode),
    transportRole: role,
    transportDirection: direction,
    transportTimeSource: 'estimated',
    selectionSource: 'api',
    bookingUrl: urls.bookingUrl,
    aviasalesUrl: urls.aviasalesUrl,
    omioFlightUrl: urls.omioFlightUrl,
  };
}

/**
 * Injects outbound transport items (multiple legs) for day 1.
 * Replaces addOutboundTransportItem when a TransportPlan is available.
 */
export function addOutboundTransportItemsFromPlan(
  day1: TripDay,
  plan: TransportPlan,
  preferences: TripPreferences,
): void {
  const returnDate = new Date(preferences.startDate);
  returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
  const outboundDateStr = formatDateForUrl(preferences.startDate);
  const returnDateStr = formatDateForUrl(returnDate);

  const sortedLegs = [...plan.outboundLegs].sort((a, b) => a.index - b.index);
  let cursor = parseHHMM('08:00');
  const items: TripItem[] = [];
  for (const leg of sortedLegs) {
    items.push(buildLegItem(leg, 'outbound', 1, cursor, preferences, outboundDateStr, returnDateStr));
    cursor += leg.durationMin;
  }

  // Prepend legs before any existing items (keep activities later in the day)
  day1.items = [...items, ...day1.items];
  day1.items.forEach((item, idx) => { item.orderIndex = idx; });
}

/**
 * Injects return transport items (multiple legs) for the last day.
 */
export function addReturnTransportItemsFromPlan(
  lastDay: TripDay,
  plan: TransportPlan,
  preferences: TripPreferences,
): void {
  const returnDate = new Date(preferences.startDate);
  returnDate.setDate(returnDate.getDate() + preferences.durationDays - 1);
  const outboundDateStr = formatDateForUrl(preferences.startDate);
  const returnDateStr = formatDateForUrl(returnDate);

  const sortedLegs = [...plan.returnLegs].sort((a, b) => a.index - b.index);
  const totalMin = sortedLegs.reduce((s, l) => s + l.durationMin, 0);
  // Anchor: last leg should arrive around 21:00 local — start accordingly.
  const targetArrivalMin = parseHHMM('21:00');
  let cursor = Math.max(parseHHMM('10:00'), targetArrivalMin - totalMin);

  const items: TripItem[] = [];
  for (const leg of sortedLegs) {
    items.push(buildLegItem(leg, 'return', lastDay.dayNumber, cursor, preferences, outboundDateStr, returnDateStr));
    cursor += leg.durationMin;
  }

  lastDay.items = [...lastDay.items, ...items];
  lastDay.items.forEach((item, idx) => { item.orderIndex = idx; });
}
