/**
 * Pipeline V2 — Step 7: Schedule Assembly
 *
 * Converts balanced clusters + restaurants + transport into a fully-slotted Trip.
 * Uses the existing DayScheduler for time slot management.
 */

import type { Trip, TripDay, TripItem, TripPreferences, Flight, Accommodation, TransportOptionSummary, Restaurant, ParkingOption } from '../types';
import type { FetchedData, ActivityCluster, MealAssignment, BalancedPlan, ScoredActivity } from './types';
import { DayScheduler, parseTime } from '../services/scheduler';
import type { ScheduleItem } from '../services/scheduler';
import { calculateDistance, geocodeAddress } from '../services/geocoding';
import { getDirections } from '../services/directions';
import { fetchPlaceImage, fetchRestaurantPhotoByPlaceId } from './services/wikimediaImages';
import type { OnPipelineEvent } from './types';
import { isAppropriateForMeal, getCuisineFamily, isBreakfastSpecialized } from './step4-restaurants';
import { selectTopHotelsByBarycenter } from './step5-hotel';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { batchFetchWikipediaSummaries, getWikiLanguageForDestination } from '../services/wikipedia';
import { normalizeHotelBookingUrl } from '../services/bookingLinks';
import { generateFlightLink, generateFlightOmioLink, formatDateForUrl, generateGoogleFlightsLink, buildDirectionsUrl, generateHotelSearchLinks } from '../services/linkGenerator';
import { sanitizeApiKeyLeaksInString, sanitizeGoogleMapsUrl } from '../services/googlePlacePhoto';
import { dedupeActivitiesBySimilarity, isDuplicateActivityCandidate } from './utils/activityDedup';
import { getRestaurantMaxDistanceKmForProfile, resolveQualityCityProfile, RESTAURANT_ABSOLUTE_MAX_KM } from './qualityPolicy';
import { isMonumentLikeActivityName, resolveOfficialTicketing } from '../services/officialTicketing';
import { scoreViatorPlusValue } from '../services/viator';
import { buildAirportParkingBookingUrl, calculateParkingTime, selectBestParking } from '../services/parking';
import { accommodationHasKitchen } from './utils/accommodation';
import {
  normalizeReturnTransportBookingUrl as normalizeReturnTransportBookingUrlShared,
  rebaseTransitLegsToTimeline,
  getTransitLegsDurationMinutes,
} from './utils/longhaulConsistency';
import type { Attraction } from '../services/attractions';
import { isGarbageActivity } from './utils/garbage-filter';
import {
  type AnchorPoint,
  hasValidCoords,
  restaurantAnchorPoints as restaurantAnchorPointsFromSorted,
  minDistanceToAnchorsKm,
} from './utils/restaurant-proximity';
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

function normalizeLocationKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Extract meal label (Petit-déjeuner/Déjeuner/Dîner) from a restaurant title.
 * Used to rebuild title when restaurant is swapped after initial scheduler item creation.
 */
function extractMealLabel(title: string): string {
  if (title.startsWith('Petit-déjeuner')) return 'Petit-déjeuner';
  if (title.startsWith('Déjeuner')) return 'Déjeuner';
  if (title.startsWith('Dîner')) return 'Dîner';
  return title.split(' — ')[0] || title;
}

function inferMealTypeFromTitle(title: string): TripItem['mealType'] | undefined {
  if (title.startsWith('Petit-déjeuner')) return 'breakfast';
  if (title.startsWith('Déjeuner')) return 'lunch';
  if (title.startsWith('Dîner')) return 'dinner';
  return undefined;
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

const MAX_INTRA_DAY_GAP_MIN = 90;
const DEFAULT_BREAKFAST_RESTAURANT_MAX_KM = 1.2;
const DEFAULT_MEAL_RESTAURANT_MAX_KM = 1.0;
const ADJACENT_LOAD_REBALANCE_THRESHOLD_MIN = 430;
const ADJACENT_GEO_NET_GAIN_MIN_KM = 1.5;
const ADJACENT_GEO_TARGET_RADIUS_TOLERANCE_KM = 0.35;
const ADJACENT_GEO_TARGET_MAX_LEG_TOLERANCE_KM = 0.45;
const MEAL_SLOT_DETOUR_WEIGHT = 35;
const MEAL_SLOT_ZIGZAG_ANGLE_THRESHOLD = 115;
const MEAL_SLOT_ZIGZAG_PENALTY = 45;
const GEO_STRICT_ZIGZAG_THRESHOLD = 2;
const GEO_STRICT_INEFFICIENCY_RATIO_THRESHOLD = 1.75;
const GEO_STRICT_MAX_PRUNED_OPTIONALS_PER_DAY = 2;
const GEO_STRICT_LOCAL_LEG_MAX_KM = 3.5;
const GEO_STRICT_LOCAL_MOVE_TOLERANCE_KM = 0.1;
const GAP_FILL_MIN_GAP_MIN = 75;
const GAP_FILL_MAX_INSERTIONS_PER_DAY = 5;
const GAP_FILL_MAX_DETOUR_KM = 1.2;
const GAP_FILL_MIN_DURATION_MIN = 45;
const GAP_FILL_WORTHWHILE_KEYWORDS = [
  'museum',
  'musee',
  'gallery',
  'galerie',
  'park',
  'parc',
  'garden',
  'jardin',
  'botanic',
  'botanique',
  'cathedral',
  'cathedrale',
  'church',
  'eglise',
  'basilica',
  'palace',
  'palais',
  'castle',
  'chateau',
  'monument',
  'historical',
  'historic',
  'heritage',
  'old town',
  'viewpoint',
  'belvedere',
  'waterfront',
  'canal',
  'piazza',
  'plaza',
  'square',
  'fountain',
  'fontana',
  'ponte',
  'bridge',
  'torre',
  'tower',
  'duomo',
  'teatro',
  'theatre',
  'theater',
  'opera',
  'library',
  'biblioteca',
  'arch',
  'arco',
  'porta',
  'gate',
  'cemetery',
  'cimetiere',
  'cimitero',
  'statue',
  'sculpture',
  'arena',
  'ruin',
  'quartier',
  'quarter',
  'district',
];
const GAP_FILL_LOW_VALUE_KEYWORDS = [
  'segway',
  'pub crawl',
  'bar crawl',
  'night club',
  'nightlife',
  'transfer',
  'airport transfer',
  'shopping',
  'outlet',
  'mall',
  'souvenir',
  'workshop',
  'atelier',
  'class',
  'cours',
  'masterclass',
];
const GAP_FILL_WEAK_QUALITY_FLAG_FRAGMENTS = [
  'low_plus_value',
  'filtered_low_plus_value',
  'city_fallback',
  'geo_fallback',
];
const GAP_FILL_FOOD_ESTABLISHMENT_KEYWORDS = [
  'restaurant', 'ristorante', 'trattoria', 'osteria', 'pizzeria', 'gelateria',
  'panificio', 'paninoteca', 'sandwicherie', 'brasserie', 'bistrot', 'bistro',
  'cafe', 'caffe', 'caffetteria', 'coffee', 'bakery', 'boulangerie', 'patisserie',
  'pasticceria', 'bar ', 'pub ', 'taverna', 'taverne', 'kebab', 'sushi',
  'burger', 'grill', 'diner', 'cantina', 'enoteca', 'wine bar',
  'food', 'brunch', 'breakfast', 'lunch', 'dinner',
];

export function getAirportPreDepartureLeadMinutes(flight: Flight): number {
  const airportText = `${flight.departureAirport || ''} ${flight.departureAirportCode || ''}`.toLowerCase();
  const needsExtraMargin = /international|intl|orly|charles|gaulle|fiumicino|heathrow|gatwick|schiphol|barajas|frankfurt/.test(airportText);
  // User constraint: include transfer + check-in/security in a 1h30 to 2h window.
  return needsExtraMargin ? 150 : 120;
}

function getLocalTimeMinutes(displayTime?: string, isoTime?: string): number {
  if (displayTime && /^([01]?\d|2[0-3]):([0-5]\d)$/.test(displayTime)) {
    const [h, m] = displayTime.split(':').map(Number);
    return h * 60 + m;
  }
  if (isoTime) {
    const d = new Date(isoTime);
    if (Number.isFinite(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  }
  return 0;
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeDayBoundsMinutes(
  rawStartMinutes: number,
  rawEndMinutes: number,
  options: { isFirstDay: boolean; isLastDay: boolean; isDayTrip: boolean }
): { dayStartMinutes: number; dayEndMinutes: number } {
  const ABSOLUTE_DAY_END = 23 * 60 + 59;
  let dayStartMinutes = Math.round(rawStartMinutes);
  let dayEndMinutes = Math.round(rawEndMinutes);

  // Keep full days reasonably early by default (user expectation: start around 8-9am).
  if (!options.isFirstDay && !options.isLastDay && !options.isDayTrip) {
    dayStartMinutes = Math.min(dayStartMinutes, 9 * 60);
  }

  dayStartMinutes = Math.max(0, Math.min(ABSOLUTE_DAY_END, dayStartMinutes));
  dayEndMinutes = Math.max(0, Math.min(ABSOLUTE_DAY_END, dayEndMinutes));

  // Ensure a valid usable window, even for very late arrivals.
  if (dayEndMinutes <= dayStartMinutes) {
    const preferredWindow = options.isFirstDay || options.isLastDay ? 90 : 180;
    dayEndMinutes = Math.min(ABSOLUTE_DAY_END, dayStartMinutes + preferredWindow);

    // Edge case: dayStart already at 23:59 (can't extend end anymore).
    if (dayEndMinutes <= dayStartMinutes) {
      dayStartMinutes = Math.max(0, dayStartMinutes - 60);
      dayEndMinutes = Math.min(ABSOLUTE_DAY_END, dayStartMinutes + 60);
    }
  }

  return { dayStartMinutes, dayEndMinutes };
}

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

export function normalizeReturnTransportBookingUrl(
  rawUrl: string | undefined,
  returnDate: Date,
  options: { swapOmioDirection?: boolean } = {}
): string | undefined {
  return normalizeReturnTransportBookingUrlShared(rawUrl, returnDate, options);
}

type InterCityFallbackDirection = 'outbound' | 'return';

export function buildInterCityFallbackTransportPayload(params: {
  direction: InterCityFallbackDirection;
  preferences: TripPreferences;
  transport: TransportOptionSummary | null;
  date: Date;
}): { title: string; data: Record<string, any> } {
  const { direction, preferences, transport, date } = params;
  const from = direction === 'outbound' ? preferences.origin : preferences.destination;
  const to = direction === 'outbound' ? preferences.destination : preferences.origin;
  const dateStr = formatDateForUrl(date);
  const passengers = Math.max(1, preferences.groupSize || 1);

  if (transport?.mode === 'plane') {
    const computedAviasalesUrl = generateFlightLink(
      { origin: from, destination: to },
      { date: dateStr, passengers }
    );
    const baseBookingUrl = direction === 'return'
      ? computedAviasalesUrl
      : (transport.bookingUrl || transport.aviasalesUrl || computedAviasalesUrl);
    const bookingUrl = direction === 'return'
      ? normalizeReturnTransportBookingUrl(baseBookingUrl, date)
      : baseBookingUrl;
    const omioFlightUrl = direction === 'return'
      ? generateFlightOmioLink(from, to, dateStr)
      : (transport.omioFlightUrl || generateFlightOmioLink(from, to, dateStr));
    const aviasalesUrl = bookingUrl?.includes('aviasales.com') ? bookingUrl : computedAviasalesUrl;
    const googleFlightsUrl = generateGoogleFlightsLink(from, to, dateStr, undefined, passengers);
    const qualityFlags = ['longhaul_fallback_injected', 'plane_transport_fallback'];
    if (aviasalesUrl.includes('aviasales.com')) qualityFlags.push('aviasales_fallback_link');

    return {
      title: `✈️ Vol → ${to}`,
      data: {
        description: `${from} → ${to} (estimation, lien vols recommandé)`,
        locationName: `${from} → ${to}`,
        transportMode: 'transit',
        transportRole: 'longhaul',
        transportDirection: direction,
        transportTimeSource: 'estimated',
        estimatedCost: transport.totalPrice || 0,
        bookingUrl,
        aviasalesUrl,
        omioFlightUrl,
        googleFlightsUrl,
        dataReliability: 'estimated',
        qualityFlags,
      },
    };
  }

  const bookingUrl = direction === 'return'
    ? normalizeReturnTransportBookingUrl(transport?.bookingUrl, date, { swapOmioDirection: true })
    : transport?.bookingUrl;

  return {
    title: `🔄 Transport → ${to}`,
    data: {
      description: `${from} → ${to} (estimation)`,
      locationName: `${from} → ${to}`,
      transportMode: 'transit',
      transportRole: 'longhaul',
      transportDirection: direction,
      transportTimeSource: 'estimated',
      estimatedCost: transport?.totalPrice || 0,
      bookingUrl,
      dataReliability: 'estimated',
      qualityFlags: ['longhaul_fallback_injected'],
    },
  };
}

function inferInterItemTransportMode(distanceKm: number, travelMinutes: number): TripItem['transportToPrevious'] {
  if (distanceKm <= 2.2) return 'walk';
  if (distanceKm >= 12 && travelMinutes <= 25) return 'car';
  return 'public';
}

type AirportRef = FetchedData['originAirports'][number];

function normalizeAirportToken(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function chooseOriginAirportForDeparture(args: {
  preferences: TripPreferences;
  airports: AirportRef[];
  outboundFlight: Flight | null;
  anchorCoords: { lat: number; lng: number };
}): AirportRef | null {
  const { preferences, airports, outboundFlight, anchorCoords } = args;
  if (!airports || airports.length === 0) return null;

  if (outboundFlight?.departureAirportCode) {
    const byFlight = airports.find((airport) => airport.code === outboundFlight.departureAirportCode);
    if (byFlight) return byFlight;
  }

  const preferredToken = normalizeAirportToken(preferences.preferredAirport);
  if (preferredToken) {
    const byPreference = airports.find((airport) => {
      const codeToken = normalizeAirportToken(airport.code);
      const nameToken = normalizeAirportToken(airport.name);
      return codeToken === preferredToken || nameToken.includes(preferredToken) || preferredToken.includes(codeToken);
    });
    if (byPreference) return byPreference;
  }

  return [...airports].sort((a, b) => {
    const distA = calculateDistance(anchorCoords.lat, anchorCoords.lng, a.latitude, a.longitude);
    const distB = calculateDistance(anchorCoords.lat, anchorCoords.lng, b.latitude, b.longitude);
    return distA - distB;
  })[0];
}

function estimateDriveMinutesToAirport(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null
): number {
  if (!from || !to) return 45;
  const distanceKm = calculateDistance(from.lat, from.lng, to.lat, to.lng);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 45;
  const minutes = Math.round((distanceKm / 45) * 60 + 12); // average urban/suburban drive + parking drop-off buffer
  return Math.max(15, Math.min(240, minutes));
}

function getGroundDepartureLeadMinutes(mode?: TransportOptionSummary['mode']): number {
  if (mode === 'train') return 45;
  if (mode === 'bus') return 35;
  if (mode === 'ferry') return 40;
  if (mode === 'car') return 20;
  return 30;
}

function buildDrivingGoogleMapsUrl(
  originLabel: string,
  airport: AirportRef
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originLabel)}&destination=${encodeURIComponent(`${airport.latitude},${airport.longitude}`)}&travelmode=driving`;
}

function buildDrivingGoogleMapsUrlToCoords(
  originLabel: string,
  destination: { lat: number; lng: number }
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originLabel)}&destination=${encodeURIComponent(`${destination.lat},${destination.lng}`)}&travelmode=driving`;
}

type OutboundAirportParkingResolution = {
  parking: ParkingOption | null;
  fallbackOptionUsed: boolean;
  fallbackBookingUrlUsed: boolean;
};

export function resolveOutboundAirportParking(args: {
  selectedOriginAirport: Pick<AirportRef, 'code' | 'name' | 'city' | 'latitude' | 'longitude'> | null;
  durationDays: number;
  budgetLevel: TripPreferences['budgetLevel'];
  hasOutboundAirTravel: boolean;
}): OutboundAirportParkingResolution {
  const { selectedOriginAirport, durationDays, budgetLevel, hasOutboundAirTravel } = args;
  if (!hasOutboundAirTravel || !selectedOriginAirport) {
    return {
      parking: null,
      fallbackOptionUsed: false,
      fallbackBookingUrlUsed: false,
    };
  }

  const preferredParking = selectBestParking(
    selectedOriginAirport.code,
    durationDays,
    budgetLevel
  );
  const fallbackBookingUrl = buildAirportParkingBookingUrl(
    selectedOriginAirport.code,
    selectedOriginAirport.name,
    selectedOriginAirport.city
  );

  if (preferredParking) {
    const fallbackBookingUrlUsed = !preferredParking.bookingUrl;
    return {
      parking: {
        ...preferredParking,
        bookingUrl: preferredParking.bookingUrl || fallbackBookingUrl,
      },
      fallbackOptionUsed: false,
      fallbackBookingUrlUsed,
    };
  }

  return {
    parking: {
      id: `${selectedOriginAirport.code.toLowerCase()}-parking-fallback`,
      name: `Parking aéroport ${selectedOriginAirport.code}`,
      type: 'airport',
      address: selectedOriginAirport.name,
      latitude: selectedOriginAirport.latitude,
      longitude: selectedOriginAirport.longitude,
      distanceToTerminal: 500,
      pricePerDay: 0,
      totalPrice: 0,
      currency: 'EUR',
      amenities: ['24h'],
      bookingUrl: fallbackBookingUrl,
    },
    fallbackOptionUsed: true,
    fallbackBookingUrlUsed: true,
  };
}

function clampToDayTime(date: Date, dayDate: Date): Date {
  const dayStart = new Date(dayDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayDate);
  dayEnd.setHours(23, 59, 0, 0);
  if (date < dayStart) return dayStart;
  if (date > dayEnd) return dayEnd;
  return date;
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
  const qualityProfile = resolveQualityCityProfile({
    destination: preferences.destination,
    clusters,
  });
  const breakfastRestaurantMaxKm = getRestaurantMaxDistanceKmForProfile(qualityProfile, 'breakfast') || DEFAULT_BREAKFAST_RESTAURANT_MAX_KM;
  const mealRestaurantMaxKm = getRestaurantMaxDistanceKmForProfile(qualityProfile, 'lunch') || DEFAULT_MEAL_RESTAURANT_MAX_KM;
  const isInterCityTrip = normalizeLocationKey(preferences.origin) !== normalizeLocationKey(preferences.destination);
  const interCityDistanceKm = calculateDistance(
    data.originCoords.lat,
    data.originCoords.lng,
    data.destCoords.lat,
    data.destCoords.lng
  );
  const fallbackInterCityTravelMin = Math.max(120, Math.round((interCityDistanceKm / 90) * 60));
  const hotelSupportsKitchen = accommodationHasKitchen(hotel);
  const hasAnyFlightPayload = Boolean(flights.outbound || flights.return);
  const useAirLonghaul = transport?.mode === 'plane' || (!transport && hasAnyFlightPayload);
  const outboundFlight = useAirLonghaul ? (flights.outbound || null) : null;
  const returnFlight = useAirLonghaul ? (flights.return || null) : null;
  const effectiveFlights = { outbound: outboundFlight, return: returnFlight };

  if (!useAirLonghaul && hasAnyFlightPayload) {
    console.warn('[Pipeline V2] Ignoring fetched flights because selected longhaul mode is not plane');
  }

  let departureAnchorCoords = preferences.homeCoords
    ? { lat: preferences.homeCoords.lat, lng: preferences.homeCoords.lng }
    : { lat: data.originCoords.lat, lng: data.originCoords.lng };
  let departureAddressLabel = (preferences.homeAddress || '').trim() || preferences.origin;

  if (!preferences.homeCoords && (preferences.homeAddress || '').trim()) {
    try {
      const geocodedHome = await geocodeAddress(preferences.homeAddress!.trim());
      if (geocodedHome) {
        departureAnchorCoords = { lat: geocodedHome.lat, lng: geocodedHome.lng };
        departureAddressLabel = geocodedHome.displayName || preferences.homeAddress!.trim();
      }
    } catch (error) {
      console.warn('[Pipeline V2] Home address geocoding failed, fallback to origin city:', error);
    }
  }

  let selectedOriginAirport = chooseOriginAirportForDeparture({
    preferences,
    airports: data.originAirports || [],
    outboundFlight,
    anchorCoords: departureAnchorCoords,
  });
  if (!selectedOriginAirport && outboundFlight?.departureAirportCode) {
    selectedOriginAirport = {
      code: outboundFlight.departureAirportCode,
      name: outboundFlight.departureAirport || outboundFlight.departureAirportCode,
      city: preferences.origin,
      country: '',
      latitude: data.originCoords.lat,
      longitude: data.originCoords.lng,
    };
  }
  const hasOutboundAirTravel = Boolean(outboundFlight) || transport?.mode === 'plane';
  const outboundParkingResolution = resolveOutboundAirportParking({
    selectedOriginAirport,
    durationDays: preferences.durationDays,
    budgetLevel: preferences.budgetLevel,
    hasOutboundAirTravel,
  });
  const selectedParking = outboundParkingResolution.parking;
  const parkingOptionWasSynthesized = outboundParkingResolution.fallbackOptionUsed;
  const parkingBookingLinkWasSynthesized = outboundParkingResolution.fallbackBookingUrlUsed;

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
  // PRE-LOOP: Enrich hotel booking URLs BEFORE items are assembled
  // (so checkin/checkout items pick up the enriched URL via shared reference)
  // ---------------------------------------------------------------------------
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
  if (data.bookingHotels) {
    for (const hotelOption of data.bookingHotels) {
      hotelOption.bookingUrl = enrichBookingUrl(hotelOption.bookingUrl, hotelOption.name || '');
    }
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
    let dayStartMinutes = dayStartHour * 60;
    let dayEndMinutes = dayEndHour * 60;

    // Detect ground transport (train/bus/car) — used when no flights
    const isGroundTransport = transport && transport.mode !== 'plane';
    const hasOutboundTransport = isFirstDay && isGroundTransport;
    const hasReturnTransport = isLastDay && isGroundTransport;

    // DIAGNOSTIC: Log transport detection
    console.log(`[Pipeline V2] Transport debug: transport=${transport ? transport.mode : 'NULL'}, isGroundTransport=${isGroundTransport}, hasOutboundTransport=${hasOutboundTransport}, hasReturnTransport=${hasReturnTransport}`);

    // Compute outbound arrival hour for ground transport
    let groundArrivalMinutes: number | null = null;
    if (hasOutboundTransport && transport) {
      if (transport.transitLegs?.length) {
        const lastLeg = transport.transitLegs[transport.transitLegs.length - 1];
        const lastLegArrival = new Date(lastLeg.arrival);
        groundArrivalMinutes = lastLegArrival.getHours() * 60 + lastLegArrival.getMinutes();
      } else {
        // Estimated: depart 08:00 + total duration
        groundArrivalMinutes = (8 + Math.ceil(transport.totalDuration / 60)) * 60;
      }
    }

    // Compute return departure hour for ground transport
    // Transit legs have outbound dates — they almost never match the return day
    // Use estimated afternoon departure (15:00 gives a full morning for activities)
    let groundDepartureMinutes: number | null = null;
    if (hasReturnTransport && transport) {
      // Estimate based on total duration: leave at 15:00 by default
      // If the trip is very long (>4h), leave earlier (14:00) to arrive at reasonable time
      const durationHours = (transport.totalDuration || 120) / 60;
      groundDepartureMinutes = (durationHours > 4 ? 14 : 15) * 60;
    }

    if (isFirstDay && outboundFlight) {
      const arrivalMinutes = getLocalTimeMinutes(outboundFlight.arrivalTimeDisplay, outboundFlight.arrivalTime);
      dayStartMinutes = Math.max(dayStartMinutes, arrivalMinutes + 60); // +1h transfer
    } else if (hasOutboundTransport && groundArrivalMinutes !== null) {
      // Ground transport: activities start after arrival + settling buffer
      // 60min for station-to-city transfer + 30min to settle in / drop bags
      dayStartMinutes = Math.max(dayStartMinutes, groundArrivalMinutes + 90);
      console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ground transport arrival buffer — first activity no earlier than ${minutesToHHMM(dayStartMinutes)}`);
    }

    // DIAGNOSTIC: Log Day 1 timing calculation
    if (isFirstDay) {
      console.log(`[Pipeline V2] Day 1 timing: groundArrivalMinutes=${groundArrivalMinutes}, dayStartMinutes=${dayStartMinutes} (${minutesToHHMM(dayStartMinutes)})`);
    }

    // SAFETY NET: If Day 1 and no outbound transport detected, but startDate has time > 10h,
    // assume late arrival and push dayStart accordingly
    if (isFirstDay && !outboundFlight && !hasOutboundTransport) {
      const startDateObj = new Date(preferences.startDate);
      const startHourUTC = startDateObj.getUTCHours();
      const startMinUTC = startDateObj.getUTCMinutes();
      // If the start date has a time component (not midnight), use it as arrival hint
      // startDate "2026-03-06T11:00:00.000Z" → 11:00 UTC = arrival time
      if (startHourUTC >= 8) {
        // Assume this is the arrival time (UTC). Add 90min buffer for transfer.
        const arrivalMinutesUTC = startHourUTC * 60 + startMinUTC;
        const buffered = arrivalMinutesUTC + 90;
        if (buffered > dayStartMinutes) {
          console.log(`[Pipeline V2] Day 1 safety net: no transport detected but startDate suggests arrival at ~${startHourUTC}:${String(startMinUTC).padStart(2, '0')} UTC — pushing dayStart from ${minutesToHHMM(dayStartMinutes)} to ${minutesToHHMM(buffered)}`);
          dayStartMinutes = buffered;
        }
      }
    }

    if (isLastDay && returnFlight) {
      const departureMinutes = getLocalTimeMinutes(returnFlight.departureTimeDisplay, returnFlight.departureTime);
      const airportLeadMinutes = getAirportPreDepartureLeadMinutes(returnFlight);
      if (departureMinutes >= 14 * 60) {
        dayStartMinutes = Math.min(dayStartMinutes, 8 * 60);
      }
      // Keep a realistic airport lead window (1h30 to 2h including transfer).
      // Still guarantee a minimum usable half-day block.
      dayEndMinutes = Math.max(dayStartMinutes + 180, departureMinutes - airportLeadMinutes);
      // If flight is very early (before noon), start earlier
      if (departureMinutes <= 12 * 60) {
        dayStartMinutes = Math.min(dayStartMinutes, 7 * 60);
      }
    } else if (hasReturnTransport && groundDepartureMinutes !== null) {
      if (groundDepartureMinutes >= 14 * 60) {
        dayStartMinutes = Math.min(dayStartMinutes, 8 * 60);
      }
      // Ground transport: keep enough prep/buffer before station departure.
      const returnGroundLeadMinutes = Math.max(60, getGroundDepartureLeadMinutes(transport?.mode) + 15);
      dayEndMinutes = Math.max(dayStartMinutes + 180, groundDepartureMinutes - returnGroundLeadMinutes);
      if (groundDepartureMinutes <= 12 * 60) {
        dayStartMinutes = Math.min(dayStartMinutes, 7 * 60);
      }
    }

    ({ dayStartMinutes, dayEndMinutes } = normalizeDayBoundsMinutes(dayStartMinutes, dayEndMinutes, {
      isFirstDay,
      isLastDay,
      isDayTrip: !!balancedDay.isDayTrip,
    }));

    // Day 1 late arrival: if available window < 2h, skip activity scheduling.
    // Activities from this cluster will be picked up by the gap-fill pool on other days.
    const dayAvailableMinutes = dayEndMinutes - dayStartMinutes;
    const day1TooShort = isFirstDay && dayAvailableMinutes < 120;
    if (day1TooShort) {
      const actCount = (prepassActivities.get(balancedDay.dayNumber) || []).length;
      if (actCount > 0) {
        console.log(
          `[Pipeline V2] Day 1: only ${dayAvailableMinutes}min available (arrival too late) — ` +
          `clearing ${actCount} activities for redistribution to other days`
        );
        prepassActivities.set(balancedDay.dayNumber, []);
      }
    }

    dayStartHour = Math.floor(dayStartMinutes / 60);
    dayEndHour = Math.floor(dayEndMinutes / 60);

    const dayStart = parseTime(dayDate, minutesToHHMM(dayStartMinutes));
    const dayEnd = parseTime(dayDate, minutesToHHMM(dayEndMinutes));

    const scheduler = new DayScheduler(dayDate, dayStart, dayEnd);

    const insertHomeToAirportLogistics = (departureTime: Date, airportLeadMinutes: number) => {
      if (!isFirstDay || !selectedOriginAirport) return;

      const airportCoords = { lat: selectedOriginAirport.latitude, lng: selectedOriginAirport.longitude };
      const homeCoords = departureAnchorCoords || null;
      const estimatedDriveMinutes = estimateDriveMinutesToAirport(homeCoords, airportCoords);
      const estimatedDriveDistanceKm = homeCoords
        ? calculateDistance(homeCoords.lat, homeCoords.lng, airportCoords.lat, airportCoords.lng)
        : 0;
      const estimatedDriveCost = estimatedDriveDistanceKm > 0
        ? Math.round(estimatedDriveDistanceKm * 0.23)
        : 0;

      const airportArrivalTime = new Date(departureTime.getTime() - airportLeadMinutes * 60 * 1000);
      const parkingMinutes = selectedParking ? calculateParkingTime(selectedParking) : 0;
      const parkingStart = selectedParking
        ? new Date(airportArrivalTime.getTime() - parkingMinutes * 60 * 1000)
        : null;
      const driveEnd = parkingStart || airportArrivalTime;
      const driveStart = new Date(driveEnd.getTime() - estimatedDriveMinutes * 60 * 1000);

      const clampedDriveStart = clampToDayTime(driveStart, dayDate);
      const clampedDriveEnd = clampToDayTime(driveEnd, dayDate);
      if (clampedDriveEnd > clampedDriveStart) {
        const driveQualityFlags: string[] = [];
        if (!homeCoords) driveQualityFlags.push('home_departure_coords_estimated');
        if (selectedParking) driveQualityFlags.push('airport_parking_included');
        if (parkingBookingLinkWasSynthesized) driveQualityFlags.push('airport_parking_fallback_link');
        scheduler.insertFixedItem({
          id: `home-airport-out-${balancedDay.dayNumber}`,
          title: `🚗 Trajet vers ${selectedOriginAirport.code}`,
          type: 'transport',
          startTime: clampedDriveStart,
          endTime: clampedDriveEnd,
          data: {
            description: `${departureAddressLabel} → ${selectedOriginAirport.name}`,
            locationName: selectedOriginAirport.name,
            latitude: selectedOriginAirport.latitude,
            longitude: selectedOriginAirport.longitude,
            estimatedCost: estimatedDriveCost,
            googleMapsUrl: buildDrivingGoogleMapsUrl(departureAddressLabel, selectedOriginAirport),
            transportMode: 'car',
            transportRole: 'inter_item',
            dataReliability: homeCoords ? 'verified' : 'estimated',
            qualityFlags: driveQualityFlags,
          },
        });
      }

      if (selectedParking && parkingStart) {
        const clampedParkingStart = clampToDayTime(parkingStart, dayDate);
        const clampedParkingEnd = clampToDayTime(airportArrivalTime, dayDate);
        if (clampedParkingEnd > clampedParkingStart) {
          scheduler.insertFixedItem({
            id: `parking-out-${balancedDay.dayNumber}`,
            title: `Parking aéroport — ${selectedParking.name}`,
            type: 'parking',
            startTime: clampedParkingStart,
            endTime: clampedParkingEnd,
            data: {
              ...selectedParking,
              locationName: selectedParking.address,
              latitude: selectedParking.latitude,
              longitude: selectedParking.longitude,
              estimatedCost: selectedParking.totalPrice || 0,
              bookingUrl: selectedParking.bookingUrl || buildAirportParkingBookingUrl(
                selectedOriginAirport.code,
                selectedOriginAirport.name,
                selectedOriginAirport.city
              ),
              dataReliability: parkingOptionWasSynthesized || parkingBookingLinkWasSynthesized ? 'estimated' : 'verified',
              qualityFlags: [
                'airport_parking_selected',
                ...(parkingOptionWasSynthesized ? ['airport_parking_option_fallback'] : []),
                ...(parkingBookingLinkWasSynthesized ? ['airport_parking_fallback_link'] : []),
              ],
            },
          });
        }
      }
    };

    const insertHomeToGroundDepartureLogistics = (
      departureTime: Date,
      mode?: TransportOptionSummary['mode']
    ) => {
      if (!isFirstDay) return;

      const originPoint = { lat: data.originCoords.lat, lng: data.originCoords.lng };
      const homeCoords = departureAnchorCoords || null;
      const normalizedOrigin = normalizeLocationKey(preferences.origin);
      const normalizedHome = normalizeLocationKey(departureAddressLabel);

      const hasDistinctHomeAddress = Boolean(normalizedHome && normalizedHome !== normalizedOrigin);
      const homeToOriginKm = homeCoords
        ? calculateDistance(homeCoords.lat, homeCoords.lng, originPoint.lat, originPoint.lng)
        : 0;

      // Keep an explicit departure block:
      // - always when home address differs from origin city
      // - or when geocoded home is materially far from the origin anchor
      // - or as a lightweight prep slot for inter-city readability
      const needsActualTransfer = hasDistinctHomeAddress || homeToOriginKm > 0.4;
      const stationLeadMinutes = getGroundDepartureLeadMinutes(mode);
      const localLeadMinutes = needsActualTransfer
        ? Math.max(stationLeadMinutes, Math.min(120, estimateDriveMinutesToAirport(homeCoords, originPoint)))
        : Math.max(20, Math.round(stationLeadMinutes * 0.6));
      const transferEnd = clampToDayTime(departureTime, dayDate);
      const transferStart = clampToDayTime(
        new Date(transferEnd.getTime() - localLeadMinutes * 60 * 1000),
        dayDate
      );
      if (transferEnd <= transferStart) return;

      const modeLabel = mode === 'train'
        ? 'départ train'
        : mode === 'bus'
          ? 'départ bus'
          : mode === 'ferry'
            ? 'départ ferry'
            : 'départ';
      const driveMapsUrl = buildDrivingGoogleMapsUrlToCoords(departureAddressLabel, originPoint);
      const qualityFlags: string[] = ['home_departure_local_segment'];
      if (!homeCoords) qualityFlags.push('home_departure_coords_estimated');
      if (!needsActualTransfer) qualityFlags.push('home_departure_prep_only');

      scheduler.insertFixedItem({
        id: `home-ground-out-${balancedDay.dayNumber}`,
        title: needsActualTransfer
          ? `🚗 Trajet vers ${modeLabel}`
          : `🧭 Départ depuis ${preferences.origin}`,
        type: 'transport',
        startTime: transferStart,
        endTime: transferEnd,
        data: {
          description: needsActualTransfer
            ? `${departureAddressLabel} → ${preferences.origin}`
            : `Départ depuis ${preferences.origin}`,
          locationName: preferences.origin,
          latitude: data.originCoords.lat,
          longitude: data.originCoords.lng,
          estimatedCost: needsActualTransfer ? Math.round(homeToOriginKm * 0.23) : 0,
          googleMapsUrl: driveMapsUrl,
          transportMode: 'car',
          transportRole: 'inter_item',
          dataReliability: homeCoords ? 'verified' : 'estimated',
          qualityFlags,
        },
      });
    };

    // 1. Fixed items: flights OR ground transport
    if (isFirstDay && outboundFlight) {
      const depTime = new Date(outboundFlight.departureTime);
      const arrTime = new Date(outboundFlight.arrivalTime);
      const airportLeadMinutes = getAirportPreDepartureLeadMinutes(outboundFlight);
      insertHomeToAirportLogistics(depTime, airportLeadMinutes);
      scheduler.insertFixedItem({
        id: `flight-out-${balancedDay.dayNumber}`,
        title: `Vol ${outboundFlight.flightNumber}`,
        type: 'flight',
        startTime: depTime,
        endTime: arrTime,
        data: outboundFlight,
      });
    } else if (hasOutboundTransport && transport) {
      // Ground transport outbound (train, bus, car)
      const { start: tStart, end: tEnd } = getGroundTransportTimes(transport, dayDate, 'outbound');
      insertHomeToGroundDepartureLogistics(tStart, transport.mode);
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
          transportDirection: 'outbound',
          transportTimeSource: transport.transitLegs?.length ? (transport.dataSource || 'estimated') : 'estimated',
        },
      });
    } else if (isFirstDay && isInterCityTrip) {
      const fallbackStart = parseTime(dayDate, '08:00');
      const fallbackEnd = new Date(fallbackStart.getTime() + fallbackInterCityTravelMin * 60 * 1000);
      const fallbackPayload = buildInterCityFallbackTransportPayload({
        direction: 'outbound',
        preferences,
        transport,
        date: fallbackStart,
      });
      if (transport?.mode === 'plane') {
        insertHomeToAirportLogistics(fallbackStart, 120);
      } else {
        insertHomeToGroundDepartureLogistics(fallbackStart, transport?.mode);
      }
      scheduler.insertFixedItem({
        id: `transport-out-${balancedDay.dayNumber}-fallback`,
        title: fallbackPayload.title,
        type: 'transport',
        startTime: fallbackStart,
        endTime: fallbackEnd,
        data: fallbackPayload.data,
      });
    }

    // IMPORTANT: Return flight/transport is inserted AFTER activities (see section 9 below)
    // This prevents the cursor from jumping past dayEnd, blocking activity insertion.
    // We prepare the data here but insert it later.
    let returnTransportData: {
      id: string; title: string; type: string;
      startTime: Date; endTime: Date; data: any;
    } | null = null;
    let returnAirportPrepData: {
      id: string; title: string; type: string;
      startTime: Date; endTime: Date; data: any;
    } | null = null;

    if (isLastDay && returnFlight) {
      const flightDeparture = new Date(returnFlight.departureTime);
      const airportLeadMinutes = getAirportPreDepartureLeadMinutes(returnFlight);
      const airportPrepStart = new Date(flightDeparture.getTime() - airportLeadMinutes * 60 * 1000);

      returnAirportPrepData = {
        id: `airport-prep-${balancedDay.dayNumber}`,
        title: `Trajet vers ${returnFlight.departureAirportCode || "l'aéroport"} + check-in`,
        type: 'transport',
        startTime: airportPrepStart,
        endTime: flightDeparture,
        data: {
          locationName: returnFlight.departureAirport || returnFlight.departureAirportCode || "Aéroport",
          description: `Trajet + formalités aéroport (${airportLeadMinutes} min)`,
          estimatedCost: 0,
          transportMode: 'transit',
          transportRole: 'longhaul',
        },
      };

      returnTransportData = {
        id: `flight-ret-${balancedDay.dayNumber}`,
        title: `Vol ${returnFlight.flightNumber}`,
        type: 'flight',
        startTime: flightDeparture,
        endTime: new Date(returnFlight.arrivalTime),
        data: returnFlight,
      };
    } else if (hasReturnTransport && transport) {
      const { start: tStart, end: tEnd } = getGroundTransportTimes(transport, dayDate, 'return');

      // Rebase return transit legs on the return-day timeline.
      const returnTransitLegs = rebaseTransitLegsToTimeline({
        transitLegs: transport.transitLegs as TripItem['transitLegs'],
        startTime: tStart,
        direction: 'return',
      });
      const rebasedDurationMinutes = getTransitLegsDurationMinutes(returnTransitLegs);
      const returnEnd = rebasedDurationMinutes > 0
        ? new Date(tStart.getTime() + rebasedDurationMinutes * 60 * 1000)
        : tEnd;

      returnTransportData = {
        id: `transport-ret-${balancedDay.dayNumber}`,
        title: `${MODE_LABELS[transport.mode] || '🚊 Transport'} → ${preferences.origin}`,
        type: 'transport',
        startTime: tStart,
        endTime: returnEnd,
        data: {
          ...transport,
          description: transport.segments?.map(s => `${s.to} → ${s.from}`).join(' | '),
          locationName: `${preferences.destination} → ${preferences.origin}`,
          transitLegs: returnTransitLegs,
          transitDataSource: transport.dataSource,
          priceRange: transport.priceRange,
          estimatedCost: transport.totalPrice,
          bookingUrl: normalizeReturnTransportBookingUrl(transport.bookingUrl, tStart, { swapOmioDirection: true }),
          transportMode: normalizeTransportMode(transport.mode),
          transportRole: 'longhaul',
          transportDirection: 'return',
          transportTimeSource: returnTransitLegs?.length ? 'rebased' : 'estimated',
        },
      };

      // DIAGNOSTIC: Log return transport construction
      console.log(`[Pipeline V2] Day ${balancedDay.dayNumber} return transport: hasReturnTransport=${hasReturnTransport}, returnTransportData=BUILT, returnFlight=${returnFlight ? 'BUILT' : 'NULL'}`);
    } else if (isLastDay && isInterCityTrip) {
      const fallbackStart = parseTime(dayDate, '15:00');
      const fallbackEnd = new Date(fallbackStart.getTime() + fallbackInterCityTravelMin * 60 * 1000);
      const fallbackPayload = buildInterCityFallbackTransportPayload({
        direction: 'return',
        preferences,
        transport,
        date: fallbackStart,
      });
      returnTransportData = {
        id: `transport-ret-${balancedDay.dayNumber}-fallback`,
        title: fallbackPayload.title,
        type: 'transport',
        startTime: fallbackStart,
        endTime: fallbackEnd,
        data: fallbackPayload.data,
      };
    }

    // 2. Prepare meal data early (needed for scheduling order decisions)
    const dayMeals = meals.filter(m => m.dayNumber === balancedDay.dayNumber);
    const breakfast = dayMeals.find(m => m.mealType === 'breakfast');
    const lunch = dayMeals.find(m => m.mealType === 'lunch');
    const dinner = dayMeals.find(m => m.mealType === 'dinner');

    // FIX 4: Distance-gate meals — reject restaurants that are too far from day center
    // This prevents Versailles restaurants from being assigned to regular Paris days
    const dayAnchor = hotel
      ? { lat: hotel.latitude, lng: hotel.longitude }
      : data.destCoords;
    const MEAL_MAX_DISTANCE_KM = 8;

    for (const meal of [breakfast, lunch, dinner]) {
      if (meal?.restaurant?.latitude && meal?.restaurant?.longitude) {
        const mealDist = calculateDistance(
          dayAnchor.lat, dayAnchor.lng,
          meal.restaurant.latitude, meal.restaurant.longitude
        );
        if (mealDist > MEAL_MAX_DISTANCE_KM) {
          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: rejecting restaurant "${meal.restaurant.name}" — ${mealDist.toFixed(1)}km from day anchor (max: ${MEAL_MAX_DISTANCE_KM}km)`);
          meal.restaurant = undefined as any;
        }
      }
    }

    // Determine which meals to skip based on time constraints
    const hasReturnTravel = !!(returnFlight || hasReturnTransport);
    // Skip breakfast only if we physically can't have it (arriving after 10am)
    const skipBreakfast = isFirstDay && dayStartHour >= 10;
    // Skip lunch only if the day ends before lunch time (e.g. very early departure)
    const skipLunch = (isLastDay && hasReturnTravel && dayEndMinutes <= 12 * 60) ||
                       (isFirstDay && dayStartMinutes >= 14 * 60);
    // Skip dinner only if the day ends before dinner time
    const skipDinner = (isLastDay && hasReturnTravel && dayEndMinutes < 19 * 60) ||
                       (isFirstDay && dayStartMinutes >= 20 * 60);

    // 3. Hotel check-in (first day) / check-out (last day)
    // IMPORTANT: On the last day, insert breakfast BEFORE checkout.
    // Otherwise checkout advances the cursor past breakfast's maxEndTime (10:00).
    // On arrival day (first day), if the traveler arrives early (before 16:00), we allow
    // activities to be scheduled AFTER check-in but also try to fit 1-2 activities on the way
    // from airport to hotel. Check-in is flexible and won't block the entire afternoon.
    if (isFirstDay && hotel) {
      let checkinTime = parseTime(dayDate, hotel.checkInTime || '15:00');
      let actualArrivalMinutes: number | null = null;

      // If there's a flight, check-in must be AFTER arrival + transfer
      if (outboundFlight) {
        const arrivalHour = outboundFlight.arrivalTimeDisplay
          ? parseInt(outboundFlight.arrivalTimeDisplay.split(':')[0], 10)
          : new Date(outboundFlight.arrivalTime).getHours();
        const arrivalMin = outboundFlight.arrivalTimeDisplay
          ? parseInt(outboundFlight.arrivalTimeDisplay.split(':')[1], 10)
          : new Date(outboundFlight.arrivalTime).getMinutes();
        actualArrivalMinutes = arrivalHour * 60 + arrivalMin;
        const earliestCheckin = parseTime(dayDate, `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMin).padStart(2, '0')}`);
        // Add 1h for transfer from airport
        const earliestCheckinWithTransfer = new Date(earliestCheckin.getTime() + 60 * 60 * 1000);
        if (earliestCheckinWithTransfer > checkinTime) {
          checkinTime = earliestCheckinWithTransfer;
        }
      } else if (hasOutboundTransport && groundArrivalMinutes !== null) {
        // Ground transport: check-in after arrival at destination
        actualArrivalMinutes = groundArrivalMinutes;
        const earliestCheckin = parseTime(dayDate, minutesToHHMM(groundArrivalMinutes + 30));
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

      // FIX D: For early arrivals (before 16:00), defer check-in to allow afternoon activities
      // Store check-in data for later insertion after we know activity count
      const checkinHour = checkinTime.getHours() + checkinTime.getMinutes() / 60;
      const hasAfternoonWindow = actualArrivalMinutes && actualArrivalMinutes < 16 * 60;
      (scheduler as any)._deferredCheckin = {
        time: checkinTime,
        hasAfternoonWindow: hasAfternoonWindow && checkinHour < 18,
        hotel,
      };
    }

    // Last day breakfast + checkout: BOTH DEFERRED to section 4c below.
    // Breakfast is inserted first (insertFixedItem), then checkout is inserted
    // AFTER breakfast ends. This ensures the sequence: breakfast → checkout → activities.
    // Previously, checkout was inserted here (before breakfast) which caused the scheduler
    // cursor to advance past breakfast's maxEndTime (10:00), breaking breakfast placement.
    let lastDayLatestCheckoutTime: Date | null = null;
    if (isLastDay && hotel) {
      lastDayLatestCheckoutTime = parseTime(dayDate, hotel.checkOutTime || '11:00');
      // If there's a return flight, check-out must be well before departure
      if (returnFlight) {
        const departureMinutes = getLocalTimeMinutes(returnFlight.departureTimeDisplay, returnFlight.departureTime);
        const airportLeadMinutes = getAirportPreDepartureLeadMinutes(returnFlight);
        // Latest checkout aligns with airport transfer/security buffer.
        const latestCheckoutMinutes = Math.max(7 * 60, departureMinutes - airportLeadMinutes);
        const latestCheckout = parseTime(dayDate, minutesToHHMM(latestCheckoutMinutes));
        if (latestCheckout < lastDayLatestCheckoutTime) {
          lastDayLatestCheckoutTime = latestCheckout;
        }
      }
      // Checkout will be inserted in section 4c, AFTER breakfast
    }

    // 4. Get activities from pre-pass (already geo-optimized + re-optimized with real times)
    const orderedActivitiesRaw = prepassActivities.get(balancedDay.dayNumber) || [];
    const intraDayDedup = dedupeActivitiesBySimilarity(
      orderedActivitiesRaw,
      [],
      { nearDistanceKm: 0.35, canonicalDistanceKm: 2.5 }
    );
    const orderedActivities = intraDayDedup.deduped;
    const prioritizedActivities = orderedActivities;
    if (intraDayDedup.dropped > 0) {
      console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: removed ${intraDayDedup.dropped} intra-day duplicate activity(ies)`);
    }

    const mustSeeCount = prioritizedActivities.filter(a => a.mustSee).length;
    console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: ${prioritizedActivities.length} activities to schedule (${mustSeeCount} must-sees), dayStart=${minutesToHHMM(dayStartMinutes)}, dayEnd=${minutesToHHMM(dayEndMinutes)}, window=${((dayEndMinutes - dayStartMinutes) / 60).toFixed(1)}h, cursor=${formatTimeHHMM(scheduler.getCurrentTime())}`);
    for (const a of prioritizedActivities) {
      console.log(`[Pipeline V2]   → "${a.name}" (${a.duration || 60}min, score=${a.score.toFixed(1)}, mustSee=${!!a.mustSee})`);
    }

    // 4a. Insert deferred check-in (arrival day only)
    if (isFirstDay && (scheduler as any)._deferredCheckin) {
      const deferred = (scheduler as any)._deferredCheckin;
      if (deferred.hasAfternoonWindow && prioritizedActivities.length > 0) {
        // Defer check-in: insert as a flexible item AFTER the first 1-2 activities
        // This creates the flow: arrival → activity 1 → [activity 2] → check-in → dinner
        scheduler.addItem({
          id: `checkin-${balancedDay.dayNumber}`,
          title: `Check-in ${deferred.hotel.name}`,
          type: 'checkin',
          duration: 30,
          minStartTime: deferred.time,
          maxEndTime: parseTime(dayDate, '18:30'),
          data: deferred.hotel,
        });
      } else {
        // Late arrival or no activities: insert check-in as fixed item
        const checkinData = {
          id: `checkin-${balancedDay.dayNumber}`,
          title: `Check-in ${deferred.hotel.name}`,
          type: 'checkin',
          startTime: deferred.time,
          endTime: new Date(deferred.time.getTime() + 30 * 60 * 1000),
          data: deferred.hotel,
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
    }

    // 4a-bis. Post-check-in activity fitness reordering
    // When the scheduler cursor is past 16:00 (late arrival / post-check-in),
    // re-sort remaining activities by time-of-day fitness instead of pure geo order.
    // This prevents scheduling a 2h museum visit at 17:00 when a promenade would be better.
    if (isFirstDay && prioritizedActivities.length > 1) {
      const cursorAfterCheckin = scheduler.getCurrentTime();
      const cursorHourAfterCheckin = cursorAfterCheckin.getHours() + cursorAfterCheckin.getMinutes() / 60;
      if (cursorHourAfterCheckin >= 16) {
        // Separate must-sees (they keep priority) from non-must-sees
        const mustSees = prioritizedActivities.filter(a => a.mustSee);
        const nonMustSees = prioritizedActivities.filter(a => !a.mustSee);

        // Sort non-must-sees by late-afternoon fitness (descending)
        nonMustSees.sort((a, b) => {
          const fitnessA = getTimeOfDayFitness(a, cursorHourAfterCheckin);
          const fitnessB = getTimeOfDayFitness(b, cursorHourAfterCheckin);
          return fitnessB - fitnessA;
        });

        // Also sort must-sees by fitness (they all get scheduled, but in better order)
        mustSees.sort((a, b) => {
          const fitnessA = getTimeOfDayFitness(a, cursorHourAfterCheckin);
          const fitnessB = getTimeOfDayFitness(b, cursorHourAfterCheckin);
          return fitnessB - fitnessA;
        });

        // Rebuild: interleave must-sees first, then non-must-sees
        prioritizedActivities.length = 0;
        prioritizedActivities.push(...mustSees, ...nonMustSees);
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: post-check-in fitness reorder (cursor=${cursorHourAfterCheckin.toFixed(1)}h): ${prioritizedActivities.map(a => `"${a.name}"(${getTimeOfDayFitness(a, cursorHourAfterCheckin).toFixed(2)})`).join(', ')}`);
      }
    }

    // 4a-ter. Last-day convergence toward departure station
    // On the last day with return transport, sort activities so the itinerary converges
    // toward the departure point (station/airport). Activities furthest from the station
    // are scheduled first, closest ones last. This creates a natural flow toward departure.
    if (isLastDay && (hasReturnTransport || returnFlight) && prioritizedActivities.length > 1) {
      // Use destination city center as proxy for departure station (stations are typically central)
      const departureLat = data.destCoords.lat;
      const departureLng = data.destCoords.lng;
      if (departureLat && departureLng) {
        // Sort: furthest from station first → closest last (converge toward station)
        prioritizedActivities.sort((a, b) => {
          const distA = calculateDistance(a.latitude || 0, a.longitude || 0, departureLat, departureLng);
          const distB = calculateDistance(b.latitude || 0, b.longitude || 0, departureLat, departureLng);
          return distB - distA; // descending = furthest first
        });
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: last-day convergence sort toward (${departureLat.toFixed(4)}, ${departureLng.toFixed(4)}): ${prioritizedActivities.map(a => `"${a.name}"(${calculateDistance(a.latitude || 0, a.longitude || 0, departureLat, departureLng).toFixed(2)}km)`).join(' → ')}`);
      }
    }

    // 4b. Restaurant re-optimization after geoOptimize
    // After activity reordering, a restaurant assigned near the old cluster centroid
    // may now be far from the nearest activity. Search the FULL restaurant pool
    // for a better option near the actual neighbor activity.
    // Hard max: city-profile aware proximity limits.
    const MEAL_REOPT_LIMITS: Record<string, number> = {
      breakfast: Math.max(0.5, Math.min(0.9, breakfastRestaurantMaxKm)),
      lunch: mealRestaurantMaxKm,
      dinner: mealRestaurantMaxKm,
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
      if (meal.fallbackMode === 'self_catered' && hotelSupportsKitchen) return;
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
            if (dist > RESTAURANT_ABSOLUTE_MAX_KM) continue;
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
          const nearbyResults = await searchRestaurantsNearbyWithFallback(
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

    // Breakfast: ALWAYS optimize near hotel (not near first activity)
    if (breakfast && hotel && !hotel.breakfastIncluded && !skipBreakfast) {
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
        const breakfastSelfCatered = breakfast?.fallbackMode === 'self_catered' && hotelSupportsKitchen;
        const bkfTitle = breakfastSelfCatered
          ? 'Petit-déjeuner — Cuisine maison (option budget)'
          : hotel
            ? 'Petit-déjeuner à l\'hôtel'
            : 'Petit-déjeuner — Café/Boulangerie à proximité';
        const bkfData = breakfastSelfCatered
          ? {
              name: 'Cuisine maison',
              description: 'Option budget: petit-déjeuner maison',
              latitude: hotel?.latitude || data.destCoords.lat,
              longitude: hotel?.longitude || data.destCoords.lng,
              estimatedCost: 6,
              qualityFlags: ['budget_self_catered_meal'],
            }
          : hotel
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

      // FALLBACK: Ensure a breakfast exists on last day
      const existingLastDayBreakfast = scheduler.getItems().some(i =>
        i.id.includes('breakfast') || (i.type === 'restaurant' && i.slot && i.slot.start.getHours() < 10)
      );
      if (!existingLastDayBreakfast) {
        const fallbackBkfStart = parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:00`);
        scheduler.insertFixedItem({
          id: `fallback-breakfast-${balancedDay.dayNumber}`,
          title: hotel ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner — Café/Boulangerie',
          type: 'restaurant',
          startTime: fallbackBkfStart,
          endTime: new Date(fallbackBkfStart.getTime() + 30 * 60 * 1000),
          data: {
            name: hotel?.name || 'Café/Boulangerie',
            description: 'Petit-déjeuner',
            latitude: hotel?.latitude || data.destCoords.lat,
            longitude: hotel?.longitude || data.destCoords.lng,
            estimatedCost: hotel ? 0 : 8,
          },
        });
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber} (last): fallback breakfast inserted`);
      }

      // 4d. Insert checkout AFTER breakfast on last day
      // This guarantees the sequence: breakfast → checkout → activities
      if (hotel && lastDayLatestCheckoutTime) {
        const bkfEndMs = bkfStart.getTime() + 45 * 60 * 1000; // breakfast ~45min
        const checkoutStart = new Date(bkfEndMs + 15 * 60 * 1000); // 15min buffer after breakfast
        // Cap checkout start to not exceed the latest allowed checkout
        const cappedCheckoutStart = checkoutStart > lastDayLatestCheckoutTime
          ? new Date(lastDayLatestCheckoutTime.getTime() - 15 * 60 * 1000)
          : checkoutStart;
        const checkoutEnd = new Date(cappedCheckoutStart.getTime() + 15 * 60 * 1000);
        scheduler.insertFixedItem({
          id: `checkout-${balancedDay.dayNumber}`,
          title: `Check-out ${hotel.name}`,
          type: 'checkout',
          startTime: cappedCheckoutStart,
          endTime: checkoutEnd > lastDayLatestCheckoutTime ? lastDayLatestCheckoutTime : checkoutEnd,
          data: hotel,
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
      const breakfastSelfCatered = breakfast?.fallbackMode === 'self_catered' && hotelSupportsKitchen;
      if (breakfastSelfCatered) {
        bkfTitle = 'Petit-déjeuner — Cuisine maison (option budget)';
        bkfData = {
          name: 'Cuisine maison',
          description: 'Option budget: petit-déjeuner maison',
          latitude: hotel?.latitude || data.destCoords.lat,
          longitude: hotel?.longitude || data.destCoords.lng,
          estimatedCost: 6,
          qualityFlags: ['budget_self_catered_meal'],
        };
      } else if (hotel) {
        const estimatedBreakfastCost = hotel.breakfastIncluded
          ? 0
          : Math.max(8, Math.round((preferences.groupSize || 2) * 6));
        bkfTitle = 'Petit-déjeuner à l\'hôtel';
        bkfData = {
          name: hotel.name || 'Hôtel',
          description: hotel.breakfastIncluded ? 'Petit-déjeuner inclus' : 'Petit-déjeuner à l\'hôtel',
          latitude: hotel.latitude,
          longitude: hotel.longitude,
          estimatedCost: estimatedBreakfastCost,
        };
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

    // FALLBACK: If no breakfast was inserted despite conditions being met, add a generic one
    if (!isLastDay && !skipBreakfast && dayStartHour <= 10) {
      const existingBreakfast = scheduler.getItems().some(i =>
        i.id.includes('breakfast') || (i.type === 'restaurant' && i.slot && i.slot.start.getHours() < 10)
      );
      if (!existingBreakfast) {
        const bkfStartTime = parseTime(dayDate, `${String(Math.max(7, dayStartHour)).padStart(2, '0')}:30`);
        scheduler.addItem({
          id: `fallback-breakfast-${balancedDay.dayNumber}`,
          title: hotel ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner — Café/Boulangerie',
          type: 'restaurant',
          duration: 30,
          minStartTime: bkfStartTime,
          maxEndTime: parseTime(dayDate, '10:00'),
          data: {
            name: hotel?.name || 'Café/Boulangerie',
            description: 'Petit-déjeuner',
            latitude: hotel?.latitude || data.destCoords.lat,
            longitude: hotel?.longitude || data.destCoords.lng,
            estimatedCost: hotel ? 0 : 8,
          },
        });
        console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: fallback breakfast inserted (no meal assignment found)`);
      }
    }

    // 5b. Check if any activity on this day includes a meal (cooking class, food tour, etc.)
    // Determine WHICH meal it replaces based on position in the day:
    // - Activities in the first half of the day → replace lunch
    // - Activities in the second half → replace dinner
    // - If only 1-2 activities total, a meal-inclusive one replaces the nearest meal
    let skipLunchForMealActivity = false;
    let skipDinnerForMealActivity = false;
    const mealInclusiveActivities = prioritizedActivities.filter(act => (act as any).includesMeal === true);
    if (mealInclusiveActivities.length > 0) {
      const totalActs = prioritizedActivities.length;
      for (const mia of mealInclusiveActivities) {
        const idx = prioritizedActivities.indexOf(mia);
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
    let pendingDayTripReturn:
      | {
          id: string;
          title: string;
          durationMin: number;
          data: {
            description: string;
            locationName: string;
            latitude: number;
            longitude: number;
          };
          earliestStart: Date;
        }
      | null = null;

    const initialCursor = scheduler.getCurrentTime();
    const initialHour = initialCursor.getHours() + initialCursor.getMinutes() / 60;

    // If cursor starts between 11:30 and 14:30, insert lunch NOW before activities
    if (!skipLunch && !skipLunchForMealActivity && lunch?.restaurant && initialHour >= 11.5 && initialHour < 14.5 && prioritizedActivities.length > 0) {
      const lunchData = { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] };
      const inserted = tryInsertMealUsingGeoSlot({
        scheduler,
        dayDate,
        id: `meal-${balancedDay.dayNumber}-lunch`,
        title: `Déjeuner — ${lunch.restaurant.name}`,
        duration: 60,
        data: lunchData,
        windowStartStr: '12:00',
        windowEndStr: '14:30',
        idealTimeStr: '13:00',
        context: {
          mealCoords: extractGeoPointFromUnknown(lunchData),
          nextAnchor: extractGeoPointFromUnknown(prioritizedActivities[0]),
          earliestStart: scheduler.getCurrentTime(),
        },
      });
      if (inserted) {
        lunchInserted = true;
      } else {
        const fallback = scheduler.addItem({
          id: `meal-${balancedDay.dayNumber}-lunch`,
          title: `Déjeuner — ${lunch.restaurant.name}`,
          type: 'restaurant',
          duration: 60,
          minStartTime: parseTime(dayDate, '12:00'),
          maxEndTime: parseTime(dayDate, '14:30'),
          data: lunchData,
        });
        if (fallback) lunchInserted = true;
      }
    }

    // 7. Interleave activities with lunch and dinner at appropriate positions
    for (let i = 0; i < prioritizedActivities.length; i++) {
      const activity = prioritizedActivities[i];
      const prev = getLatestScheduledGeoPoint(scheduler) || (i === 0 ? hotel : prioritizedActivities[i - 1]);
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
        const lunchData = { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] };
        const inserted = tryInsertMealUsingGeoSlot({
          scheduler,
          dayDate,
          id: `meal-${balancedDay.dayNumber}-lunch`,
          title: `Déjeuner — ${lunch.restaurant.name}`,
          duration: 60,
          data: lunchData,
          windowStartStr: '12:00',
          windowEndStr: '14:30',
          idealTimeStr: '13:00',
          context: {
            mealCoords: extractGeoPointFromUnknown(lunchData),
            prevAnchor: extractGeoPointFromUnknown(getLatestScheduledGeoPoint(scheduler)),
            nextAnchor: extractGeoPointFromUnknown(activity),
            earliestStart: scheduler.getCurrentTime(),
          },
        });
        if (inserted) {
          lunchInserted = true;
        } else {
          const fallback = scheduler.addItem({
            id: `meal-${balancedDay.dayNumber}-lunch`,
            title: `Déjeuner — ${lunch.restaurant.name}`,
            type: 'restaurant',
            duration: 60,
            minStartTime: parseTime(dayDate, '12:00'),
            maxEndTime: parseTime(dayDate, '14:30'),
            data: lunchData,
          });
          if (fallback) lunchInserted = true;
        }
      }

      // Check if it's time for dinner (cursor between 18:30 and 21:00)
      const cursorTime2 = scheduler.getCurrentTime();
      const cursorHour2 = cursorTime2.getHours() + cursorTime2.getMinutes() / 60;
      const pendingMustSee = prioritizedActivities.slice(i).some((candidate) => candidate.mustSee);

      if (!dinnerInserted && !skipDinner && !skipDinnerForMealActivity && dinner?.restaurant && cursorHour2 >= 18.5 && cursorHour2 < 21 && !pendingMustSee) {
        const dinnerData = { ...dinner.restaurant, _alternatives: dinner.restaurantAlternatives || [] };
        const inserted = tryInsertMealUsingGeoSlot({
          scheduler,
          dayDate,
          id: `meal-${balancedDay.dayNumber}-dinner`,
          title: `Dîner — ${dinner.restaurant.name}`,
          duration: 75,
          data: dinnerData,
          windowStartStr: '19:00',
          windowEndStr: '22:00',
          idealTimeStr: '20:00',
          context: {
            mealCoords: extractGeoPointFromUnknown(dinnerData),
            prevAnchor: extractGeoPointFromUnknown(getLatestScheduledGeoPoint(scheduler)),
            nextAnchor: extractGeoPointFromUnknown(activity),
            earliestStart: scheduler.getCurrentTime(),
          },
        });
        if (inserted) {
          dinnerInserted = true;
        } else {
          const fallback = scheduler.addItem({
            id: `meal-${balancedDay.dayNumber}-dinner`,
            title: `Dîner — ${dinner.restaurant.name}`,
            type: 'restaurant',
            duration: 75,
            minStartTime: parseTime(dayDate, '19:00'),
            maxEndTime: parseTime(dayDate, '22:00'),
            data: dinnerData,
          });
          if (fallback) dinnerInserted = true;
        }
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

      // After day-trip activity, queue explicit return travel to hotel.
      // We insert it later (after lunch slot placement) to avoid contradictory
      // schedules where "Retour" appears before lunch at the day-trip location.
      if (balancedDay.isDayTrip && hotel && i === prioritizedActivities.length - 1) {
        const distKm = calculateDistance(
          activity.latitude, activity.longitude,
          hotel.latitude, hotel.longitude
        );
        const returnTravelMin = Math.round((distKm / 50) * 60);
        if (returnTravelMin > 15) {
          const latestScheduled = scheduler.getItems()
            .filter((scheduledItem) => scheduledItem.type === 'activity')
            .reduce((max, scheduledItem) => Math.max(max, scheduledItem.slot.end.getTime()), scheduler.getCurrentTime().getTime());

          pendingDayTripReturn = {
            id: `daytrip-return-${balancedDay.dayNumber}`,
            title: `Retour vers ${preferences.destination}`,
            durationMin: returnTravelMin,
            earliestStart: new Date(latestScheduled),
            data: {
              description: `Retour depuis ${activity.name}`,
              locationName: hotel.name,
              latitude: hotel.latitude,
              longitude: hotel.longitude,
            },
          };
        }
      }
    }

    // 7b. Insert free time slot only on explicitly relaxed dense days.
    // Avoid adding automatic idle blocks on otherwise healthy schedules.
    const activityItems = scheduler.getItems().filter((item) => item.type === 'activity');
    const scheduledActivityCount = activityItems.length;
    const scheduledActivityMinutes = activityItems.reduce(
      (sum, item) => sum + Math.max(0, Math.round((item.slot.end.getTime() - item.slot.start.getTime()) / 60000)),
      0
    );
    const shouldInsertFreeTime = Boolean(
      balancedDay.restBreak
      && !isLastDay
      && (scheduledActivityCount >= 5 || scheduledActivityMinutes >= 420)
    );
    if (shouldInsertFreeTime) {
      const currentHour = scheduler.getCurrentTime().getHours();
      // Only insert if cursor is in the 13h-17h window (afternoon)
      if (currentHour >= 13 && currentHour < 17) {
        const freeTimeAnchor = getLatestScheduledGeoPoint(scheduler);
        const freeTimeResult = scheduler.addItem({
          id: `free-time-${balancedDay.dayNumber}`,
          title: 'Temps libre',
          type: 'free_time',
          duration: 45,
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
          console.log(`[Pipeline V2] Day ${balancedDay.dayNumber}: Inserted free time slot (${scheduledActivityCount} activities, ${scheduledActivityMinutes}min, restBreak=${balancedDay.restBreak})`);
        }
      }
    }

    // 8. Insert any remaining meals after all activities
    // Uses insertFixedItem to bypass the cursor (which is now past the lunch window).
    // findBestMealSlot() scans gaps between existing items to find the best time.
    if (!lunchInserted && !skipLunch && !skipLunchForMealActivity) {
      const lunchDuration = lunch?.restaurant ? 60 : 45;
      const lunchFallbackAnchor = getLatestScheduledGeoPoint(scheduler);
      const lunchSelfCatered = lunch?.fallbackMode === 'self_catered' && hotelSupportsKitchen;
      const lunchData = lunch?.restaurant
        ? { ...lunch.restaurant, _alternatives: lunch.restaurantAlternatives || [] }
        : lunchSelfCatered
          ? {
              name: 'Cuisine maison',
              description: 'Option budget: repas maison / courses locales',
              latitude: lunchFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
              longitude: lunchFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
              estimatedCost: 8,
              qualityFlags: ['budget_self_catered_meal'],
            }
          : {
              name: 'Restaurant à proximité',
              description: 'Déjeuner',
              latitude: lunchFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
              longitude: lunchFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
              estimatedCost: 15,
            };
      const lunchTitle = lunch?.restaurant
        ? `Déjeuner — ${lunch.restaurant.name}`
        : lunchSelfCatered
          ? 'Déjeuner — Cuisine maison (option budget)'
          : 'Déjeuner — Restaurant à proximité';
      const lunchId = lunch?.restaurant
        ? `meal-${balancedDay.dayNumber}-lunch`
        : lunchSelfCatered
          ? `self-cooked-lunch-${balancedDay.dayNumber}`
          : `self-lunch-${balancedDay.dayNumber}`;

      const slot = findBestMealSlot(
        scheduler,
        dayDate,
        '12:00',
        '15:00',
        lunchDuration,
        '13:00',
        {
          mealCoords: extractGeoPointFromUnknown(lunchData),
        }
      );
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

    if (pendingDayTripReturn) {
      const scheduledNow = scheduler.getItems();
      const lunchIds = new Set([
        `meal-${balancedDay.dayNumber}-lunch`,
        `self-cooked-lunch-${balancedDay.dayNumber}`,
        `self-lunch-${balancedDay.dayNumber}`,
      ]);
      const lunchEnd = scheduledNow
        .filter((scheduledItem) => lunchIds.has(scheduledItem.id))
        .reduce((max, scheduledItem) => Math.max(max, scheduledItem.slot.end.getTime()), 0);

      const longhaulStartMs = returnTransportData?.startTime?.getTime();
      const longhaulBufferMs = 10 * 60 * 1000;
      const desiredEndBeforeLonghaul = longhaulStartMs ? (longhaulStartMs - longhaulBufferMs) : null;

      const baseStartMs = Math.max(
        pendingDayTripReturn.earliestStart.getTime(),
        lunchEnd
      );
      let returnStartMs = baseStartMs;

      if (desiredEndBeforeLonghaul !== null) {
        const latestStart = desiredEndBeforeLonghaul - pendingDayTripReturn.durationMin * 60 * 1000;
        if (latestStart > returnStartMs) {
          returnStartMs = latestStart;
        }
      }

      const returnStart = new Date(returnStartMs);
      const returnEnd = new Date(returnStart.getTime() + pendingDayTripReturn.durationMin * 60 * 1000);

      const canFitBeforeLonghaul = desiredEndBeforeLonghaul === null || returnEnd.getTime() <= desiredEndBeforeLonghaul;
      if (canFitBeforeLonghaul) {
        const inserted = scheduler.insertFixedItem({
          id: pendingDayTripReturn.id,
          title: pendingDayTripReturn.title,
          type: 'transport',
          startTime: returnStart,
          endTime: returnEnd,
          data: pendingDayTripReturn.data,
        });

        if (!inserted) {
          scheduler.advanceTo(returnStart);
          scheduler.addItem({
            id: pendingDayTripReturn.id,
            title: pendingDayTripReturn.title,
            type: 'transport',
            duration: pendingDayTripReturn.durationMin,
            travelTime: 0,
            data: pendingDayTripReturn.data,
          });
        }
      } else {
        console.warn(
          `[Pipeline V2] Day ${balancedDay.dayNumber}: skipped explicit day-trip return; no safe slot before longhaul departure`
        );
      }
    }

    if (!dinnerInserted && !skipDinner && !skipDinnerForMealActivity) {
      const dinnerDuration = dinner?.restaurant ? 75 : 60;
      const dinnerFallbackAnchor = getLatestScheduledGeoPoint(scheduler);
      const dinnerSelfCatered = dinner?.fallbackMode === 'self_catered' && hotelSupportsKitchen;
      const dinnerData = dinner?.restaurant
        ? { ...dinner.restaurant, _alternatives: dinner.restaurantAlternatives || [] }
        : dinnerSelfCatered
          ? {
              name: 'Cuisine maison',
              description: 'Option budget: dîner maison / courses locales',
              latitude: dinnerFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
              longitude: dinnerFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
              estimatedCost: 10,
              qualityFlags: ['budget_self_catered_meal'],
            }
          : {
              name: 'Restaurant à proximité',
              description: 'Dîner',
              latitude: dinnerFallbackAnchor?.latitude || hotel?.latitude || data.destCoords.lat,
              longitude: dinnerFallbackAnchor?.longitude || hotel?.longitude || data.destCoords.lng,
              estimatedCost: 20,
            };
      const dinnerTitle = dinner?.restaurant
        ? `Dîner — ${dinner.restaurant.name}`
        : dinnerSelfCatered
          ? 'Dîner — Cuisine maison (option budget)'
          : 'Dîner — Restaurant à proximité';
      const dinnerId = dinner?.restaurant
        ? `meal-${balancedDay.dayNumber}-dinner`
        : dinnerSelfCatered
          ? `self-cooked-dinner-${balancedDay.dayNumber}`
          : `self-dinner-${balancedDay.dayNumber}`;

      const slot = findBestMealSlot(
        scheduler,
        dayDate,
        '19:00',
        '22:00',
        dinnerDuration,
        '20:00',
        {
          mealCoords: extractGeoPointFromUnknown(dinnerData),
        }
      );
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
    if (returnAirportPrepData) {
      scheduler.insertFixedItem(returnAirportPrepData);
    }
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
      const resolvedTransportRole = item.type === 'transport'
        ? (itemData.transportRole === 'longhaul' ? 'longhaul' : 'inter_item')
        : undefined;
      const normalizedCoords = normalizeItemCoordinates(item.title, itemData, item.type, preferences.destination);

      // FIX F: For restaurants, always rebuild title from current itemData.name (not stale item.title)
      // This fixes mismatch when reoptMealFromPool() swapped the restaurant after scheduler item was created
      const isRestaurant = item.type === 'restaurant';
      const currentRestaurantName = isRestaurant ? itemData.name : null;
      const rebuiltTitle = isRestaurant && currentRestaurantName
        ? `${extractMealLabel(item.title)} — ${currentRestaurantName}`
        : item.title;

      // Generate Google Maps "search by name" URL (more reliable than GPS coordinates)
      // For restaurants, always use current restaurant name (not stale item.title)
      // For transports, use actual station name from transitLegs (not emoji-prefixed title)
      let placeName: string | undefined;
      if (item.type === 'transport') {
        if (itemData.transitLegs?.length > 0) {
          // Train with legs: use arrival station name
          const lastLeg = itemData.transitLegs[itemData.transitLegs.length - 1];
          placeName = lastLeg.to; // e.g. "Milano Porta Garibaldi"
        } else if (itemData.locationName && !itemData.locationName.startsWith('🧭')) {
          // Bus/car: use locationName (e.g. "Lyon → Milan")
          // Extract destination part after "→" if present
          const arrowIdx = itemData.locationName.indexOf('→');
          placeName = arrowIdx >= 0
            ? (itemData.locationName.slice(arrowIdx + 1).trim() + ' bus station')
            : itemData.locationName;
        } else {
          // Fallback: use destination city with transport mode
          const mode = getTransportModeFromItemData(itemData) || 'transit';
          placeName = `${preferences.destination} ${mode === 'bus' ? 'bus station' : 'train station'}`;
        }
      } else if (isRestaurant && currentRestaurantName) {
        placeName = currentRestaurantName;
      } else {
        placeName = itemData.name || item.title;
      }
      const placeCity = preferences.destination || '';
      const googleMapsPlaceUrl = placeName
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName + ', ' + placeCity)}`
        : undefined;

      const restaurantImageUrl = item.type === 'restaurant'
        ? getRestaurantPrimaryGooglePhoto(itemData)
        : undefined;

      const rawBookingUrl = item.type === 'transport'
        ? (resolvedTransportRole === 'longhaul' ? itemData.bookingUrl : undefined)
        : (itemData.bookingUrl || itemData.googleMapsUrl
          || (item.type === 'restaurant' && (itemData.name || item.title)
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((itemData.name || item.title) + ', ' + preferences.destination)}`
            : undefined));
      const bookingIsViator = typeof rawBookingUrl === 'string' && rawBookingUrl.includes('viator.com');

      const officialTicketing = item.type === 'activity'
        ? resolveOfficialTicketing({
            name: itemData.name || item.title,
            title: item.title,
            description: itemData.description,
            bookingUrl: rawBookingUrl,
          }, preferences.destination)
        : null;

      const officialBookingUrl = item.type === 'activity'
        ? (itemData.officialBookingUrl || officialTicketing?.officialUrl || (!bookingIsViator ? rawBookingUrl : undefined))
        : undefined;

      const candidateViatorUrl = item.type === 'activity'
        ? (itemData.viatorUrl || (bookingIsViator ? rawBookingUrl : undefined))
        : undefined;

      const viatorAssessment = item.type === 'activity' && candidateViatorUrl
        ? scoreViatorPlusValue({
            title: itemData.viatorTitle || itemData.name || item.title,
            description: itemData.description,
            rating: itemData.viatorRating || itemData.rating,
            reviewCount: itemData.viatorReviewCount || itemData.reviewCount,
            price: itemData.viatorPrice || itemData.estimatedCost,
            freeCancellation: Boolean(itemData.freeCancellation),
            instantConfirmation: Boolean(itemData.instantConfirmation),
          })
        : null;
      const monumentLikeActivity = item.type === 'activity'
        ? isMonumentLikeActivityName(itemData.name || item.title)
        : false;
      // Lower threshold for monuments WITH an official ticketing URL — both buttons
      // should show (official + Viator "guided option") when Viator adds real value.
      const viatorScoreThreshold = monumentLikeActivity && officialBookingUrl ? 2 : 3;
      const keepViator = !candidateViatorUrl
        ? false
        : (!monumentLikeActivity || (viatorAssessment?.score || 0) >= viatorScoreThreshold);
      let resolvedViatorUrl = keepViator ? candidateViatorUrl : undefined;

      // B1: Append date to Viator URL
      if (resolvedViatorUrl && dayDate) {
        const dateStr = formatDateForUrl(dayDate);
        if (dateStr) {
          const separator = resolvedViatorUrl.includes('?') ? '&' : '?';
          resolvedViatorUrl = `${resolvedViatorUrl}${separator}date=${dateStr}`;
        }
      }

      const mergedQualityFlags = Array.from(new Set([
        ...((itemData.qualityFlags || []) as string[]),
        ...(candidateViatorUrl && !keepViator ? ['viator_filtered_low_plus_value'] : []),
      ]));
      const finalBookingUrl = item.type === 'activity'
        ? (officialBookingUrl || (!bookingIsViator ? rawBookingUrl : undefined) || resolvedViatorUrl)
        : rawBookingUrl;

      return {
        id: item.id || uuidv4(),
        dayNumber: balancedDay.dayNumber,
        startTime: formatTimeHHMM(item.slot.start),
        endTime: formatTimeHHMM(item.slot.end),
        type: item.type as TripItem['type'],
        title: rebuiltTitle,
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
        bookingUrl: finalBookingUrl,
        officialBookingUrl,
        viatorUrl: resolvedViatorUrl,
        googleMapsPlaceUrl,
        restaurant: item.type === 'restaurant' ? itemData : undefined,
        restaurantAlternatives: item.type === 'restaurant' && itemData._alternatives?.length > 0
          ? itemData._alternatives
          : undefined,
        parking: item.type === 'parking' ? itemData : undefined,
        accommodation: (item.type === 'checkin' || item.type === 'checkout') ? itemData : undefined,
        // B3: Add hotel search links on check-in items
        hotelSearchLinks: item.type === 'checkin'
          ? generateHotelSearchLinks(
              preferences.destination,
              preferences.startDate,
              new Date(preferences.startDate.getTime() + preferences.durationDays * 24 * 60 * 60 * 1000),
              preferences.groupSize || 2
            )
          : undefined,
        flight: item.type === 'flight' ? itemData : undefined,
        // Flight-specific links (aviasalesUrl and googleFlightsUrl)
        aviasalesUrl: item.type === 'flight' && itemData.departureCity && itemData.arrivalCity
          ? generateFlightLink(
              { origin: itemData.departureCity, destination: itemData.arrivalCity },
              { date: formatDateForUrl(itemData.departureTime), passengers: preferences.groupSize || 1 }
            )
          : (item.type === 'transport' && itemData.aviasalesUrl) || undefined,
        omioFlightUrl: item.type === 'flight' && itemData.departureCity && itemData.arrivalCity
          ? generateFlightOmioLink(
              itemData.departureCity,
              itemData.arrivalCity,
              formatDateForUrl(itemData.departureTime)
            )
          : (item.type === 'transport' && itemData.omioFlightUrl) || undefined,
        googleFlightsUrl: item.type === 'flight' && itemData.departureCity && itemData.arrivalCity
          ? generateGoogleFlightsLink(
              itemData.departureCity,
              itemData.arrivalCity,
              formatDateForUrl(itemData.departureTime),
              undefined,
              preferences.groupSize || 1
            )
          : (item.type === 'transport' && itemData.googleFlightsUrl) || undefined,
        // Transport-specific fields (train/bus legs, price range)
        mealType: item.type === 'restaurant'
          ? (itemData.mealType || inferMealTypeFromTitle(rebuiltTitle))
          : undefined,
        transitLegs: itemData.transitLegs,
        transitDataSource: itemData.transitDataSource,
        priceRange: itemData.priceRange,
        transportMode: resolvedTransportMode,
        transportRole: resolvedTransportRole,
        transportDirection: itemData.transportDirection,
        transportTimeSource: itemData.transportTimeSource,
        dataReliability: itemData.dataReliability || 'verified',
        geoSource: itemData.geoSource,
        geoConfidence: itemData.geoConfidence,
        qualityFlags: mergedQualityFlags.length > 0 ? mergedQualityFlags : undefined,
        imageUrl: restaurantImageUrl
          || (item.type !== 'restaurant' ? (itemData.photos?.[0] || itemData.imageUrl || itemData.photoUrl) : undefined)
          || (item.type === 'flight' ? TRANSPORT_IMAGES.flight : undefined)
          || (item.type === 'transport' ? getTransportImage({ ...itemData, transportMode: resolvedTransportMode }) : undefined),
        // Viator flags (activities only)
        freeCancellation: item.type === 'activity' ? itemData.freeCancellation : undefined,
        instantConfirmation: item.type === 'activity' ? itemData.instantConfirmation : undefined,
        mustSee: item.type === 'activity' ? Boolean(itemData.mustSee) : undefined,
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

  // 11b. POST-PROCESS: Remove duplicate longhaul transport items
  // If step7 inserted proper transport AND step4/LLM also had transport, we may have duplicates
  for (const day of days) {
    const longhaulItems = day.items.filter(item => item.type === 'transport' && item.transportRole === 'longhaul');
    if (longhaulItems.length > 1) {
      console.warn(`[Pipeline V2] Day ${day.dayNumber}: ${longhaulItems.length} longhaul transports detected — keeping only the first one`);
      const keepId = longhaulItems[0].id;
      day.items = day.items.filter(item => !(item.type === 'transport' && item.transportRole === 'longhaul' && item.id !== keepId));
      day.items = day.items.map((item, idx) => ({ ...item, orderIndex: idx }));
    }
  }

  // 11c. POST-PROCESS: Ensure last day transport goes TO origin, not FROM origin
  const lastDay = days[days.length - 1];
  if (lastDay) {
    for (const item of lastDay.items) {
      if (item.type === 'transport' && item.transportRole === 'longhaul') {
        const title = item.title || '';
        // If the transport title contains "→ {destination}" instead of "→ {origin}", it's wrong
        const originNorm = preferences.origin.toLowerCase();
        const destNorm = preferences.destination.toLowerCase();
        if (title.toLowerCase().includes(destNorm) && !title.toLowerCase().includes(originNorm)) {
          console.warn(`[Pipeline V2] Day ${lastDay.dayNumber}: return transport title "${title}" points to destination — fixing`);
          item.title = title.replace(new RegExp(destNorm, 'i'), preferences.origin);
        }
      }
    }
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
          if (isBudgetSelfCateredItem(item)) continue;
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
        if (isBudgetSelfCateredItem(item)) continue;
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

        // FIX 4: Hard reject — on non-day-trip days, if restaurant is >8km from hotel/destination,
        // always flag for swap (prevents Versailles restaurants on Paris days)
        if (!day.isDayTrip) {
          const dayAnchorForSwap = hotel
            ? { lat: hotel.latitude!, lng: hotel.longitude! }
            : data.destCoords;
          const distFromDayAnchor = calculateDistance(
            dayAnchorForSwap.lat, dayAnchorForSwap.lng,
            item.latitude, item.longitude
          );
          if (distFromDayAnchor > 8) {
            const mealTypeGuess: 'breakfast' | 'lunch' | 'dinner' = item.startTime < '11:00' ? 'breakfast'
              : item.startTime < '15:00' ? 'lunch'
              : 'dinner';
            swapCandidates.push({ day, itemIdx: i, refLat: dayAnchorForSwap.lat, refLng: dayAnchorForSwap.lng, currentDist: distFromDayAnchor, mealType: mealTypeGuess });
            console.log(`[Pipeline V2] Restaurant "${item.title}" on day ${day.dayNumber} is ${distFromDayAnchor.toFixed(1)}km from day anchor — forced swap candidate`);
            continue;
          }
        }

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
          item.googleMapsPlaceUrl = bestR.googleMapsUrl
            || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bestR.name}, ${preferences.destination}`)}`;
          item.restaurant = bestR;
          item.restaurantAlternatives = []; // Clear stale alts — section 13b will refill
          // Restaurant changed: clear previous image so we don't keep a stale photo.
          item.imageUrl = undefined;
          item.distanceFromPrevious = bestDist;
          item.timeFromPrevious = Math.max(5, roundToNearestFive(estimateTravel(
            { latitude: refLat, longitude: refLng },
            { latitude: bestR.latitude, longitude: bestR.longitude },
            directionsCache
          )));
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
          searchRestaurantsNearbyWithFallback(
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
          item.googleMapsPlaceUrl = bestR.googleMapsUrl
            || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bestR.name}, ${preferences.destination}`)}`;
          item.restaurant = bestR;
          item.restaurantAlternatives = []; // Clear stale alts — section 13b will refill
          // Restaurant changed: clear previous image so we don't keep a stale photo.
          item.imageUrl = undefined;
          item.distanceFromPrevious = bestDist;
          item.timeFromPrevious = Math.max(5, roundToNearestFive(estimateTravel(
            { latitude: c.refLat, longitude: c.refLng },
            { latitude: bestR.latitude, longitude: bestR.longitude },
            directionsCache
          )));
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
            const apiResults = await searchRestaurantsNearbyWithFallback(
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
          const assigned = newAlts.slice(0, TARGET_ALTS);
          item.restaurantAlternatives = assigned;
          // Mark assigned alternatives as used so they are not reused for other meal slots.
          for (const alt of assigned) {
            if (alt.id) globalUsedIds.add(alt.id);
            if (alt.name) globalUsedNames.add(alt.name);
          }
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
              'imageUrl', 'bookingUrl', 'officialBookingUrl', 'viatorUrl', 'rating',
              'googleMapsPlaceUrl', 'freeCancellation', 'instantConfirmation',
              'dataReliability', 'geoSource', 'geoConfidence', 'qualityFlags',
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

  const gapFillCandidatePool = buildGapFillActivityPool(clusters, data);

  // 13f. Compress large intra-day idle gaps without touching fixed transport/check-in slots.
  try {
    const compressedCount = compressIntraDayGaps(days, directionsCache);
    if (compressedCount > 0) {
      console.log(`[Pipeline V2] Section 13f: compressed ${compressedCount} large intra-day gap segment(s)`);
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13f failed (non-critical):', error);
  }

  // 13g. Hard-cap restaurant proximity (city-profile aware),
  // with pool/api replacement and fallback diagnostics.
  try {
    const outlierFixStats = await fixRestaurantOutliers(
      days,
      restaurantGeoPool || [],
      preferences.destination,
      {
        breakfastMaxKm: breakfastRestaurantMaxKm,
        mealMaxKm: mealRestaurantMaxKm,
        hotelCoords: hotel && hasValidCoords(hotel)
          ? { latitude: hotel.latitude, longitude: hotel.longitude }
          : undefined,
      }
    );
    if (outlierFixStats.replaced > 0 || outlierFixStats.flaggedFallback > 0) {
      console.log(
        `[Pipeline V2] Section 13g: restaurant outliers fixed=${outlierFixStats.replaced}, fallback-flagged=${outlierFixStats.flaggedFallback}`
      );
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13g failed (non-critical):', error);
  }

  // 13h. Rebalance load between adjacent days by moving optional activities only.
  try {
    const moveCount = rebalanceAdjacentDayLoad(days);
    if (moveCount > 0) {
      console.log(`[Pipeline V2] Section 13h: moved ${moveCount} optional activity(ies) across adjacent days`);
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13h failed (non-critical):', error);
  }

  // 13i. Geo-strict intra-day cleanup: prune optional outliers that create zigzags.
  // Run BEFORE gap-fill so that gap-fill can backfill any gaps created by pruning.
  try {
    const prunedCount = pruneIntraDayZigzagsStrict(days, directionsCache);
    if (prunedCount > 0) {
      console.log(`[Pipeline V2] Section 13i: pruned ${prunedCount} optional activity(ies) to reduce intra-day zigzags`);
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13i failed (non-critical):', error);
  }

  // 13ha. Fill large idle gaps with nearby worthwhile optional activities.
  // Runs after zigzag pruning to also backfill gaps created by the pruner.
  try {
    const filledCount = fillLargeIntraDayGapsWithNearbyActivities(
      days,
      gapFillCandidatePool,
      preferences.destination,
      directionsCache
    );
    if (filledCount > 0) {
      console.log(`[Pipeline V2] Section 13ha: inserted ${filledCount} gap-fill activity(ies)`);
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13ha failed (non-critical):', error);
  }

  // 13hb. Safety net: detect days with catastrophic gaps (>= 180 min) and force a second
  // gap-fill pass with relaxed constraints for those specific days.
  const catastrophicGapDays = days.filter((day) => {
    if (day.isDayTrip) return false;
    const isArrivalOrDeparture = day.dayNumber === 1 || day.dayNumber === days.length;
    if (isArrivalOrDeparture) return false;
    // Removed activityCount gate: a day with 3 short activities can still have 4h+ gaps
    return computeLargestGapMinutes(day) >= 150; // Lowered from 180 to 150 min
  });
  if (catastrophicGapDays.length > 0) {
    console.warn(`[Pipeline V2] ⚠ ${catastrophicGapDays.length} full day(s) still have gaps >= 3h after gap-fill. Running emergency fill...`);
    try {
      // Build relaxed pool with less strict filtering for large gaps
      const relaxedGapFillPool = buildRelaxedGapFillActivityPool(clusters, data);
      console.log(`[Pipeline V2] Section 13hb: built relaxed pool with ${relaxedGapFillPool.length} candidates (vs ${gapFillCandidatePool.length} in standard pool)`);

      const emergencyFilled = fillLargeIntraDayGapsWithNearbyActivities(
        catastrophicGapDays,
        relaxedGapFillPool,
        preferences.destination,
        directionsCache
      );
      if (emergencyFilled > 0) {
        console.log(`[Pipeline V2] Section 13hb: emergency gap-fill inserted ${emergencyFilled} activity(ies)`);
      }
    } catch (error) {
      console.warn('[Pipeline V2] Section 13hb emergency gap-fill failed (non-critical):', error);
    }
  }

  // 13hc. Sparse Day Rescue — safety net for days with < 3 activities (non-boundary).
  // This runs after standard + emergency gap-fill. If a full day STILL has too few activities,
  // build an aggressive ad-hoc pool from ALL data sources and insert up to 3 activities.
  try {
    const sparseDays = days.filter((day) => {
      if (day.isDayTrip) return false;
      const isArrivalOrDeparture = day.dayNumber === 1 || day.dayNumber === days.length;
      if (isArrivalOrDeparture) return false;
      const activityCount = day.items.filter((i) => i.type === 'activity').length;
      return activityCount < 3;
    });

    if (sparseDays.length > 0) {
      console.warn(`[Pipeline V2] ⚠ ${sparseDays.length} full day(s) have < 3 activities. Running Sparse Day Rescue...`);

      // Build aggressive pool from ALL raw sources (relaxed eligibility)
      const rescuePool = buildRelaxedGapFillActivityPool(clusters, data);

      // Global dedup: track all currently scheduled activities (name+GPS)
      const globalScheduledForRescue: Array<{ id: string; name: string; latitude: number; longitude: number }> =
        days.flatMap((day) =>
          day.items
            .filter((item) => item.type === 'activity')
            .map((item) => ({ id: item.id, name: item.title, latitude: item.latitude, longitude: item.longitude }))
        );
      const globalInsertedRescueIds = new Set<string>();

      for (const day of sparseDays) {
        const activityCount = () => day.items.filter((i) => i.type === 'activity').length;
        const MAX_RESCUE_INSERTIONS = 4;
        let rescueInserted = 0;

        // Compute the centroid of existing activities on this day
        const dayActivities = day.items.filter((i) => i.type === 'activity' && i.latitude && i.longitude);
        const centroidLat = dayActivities.length > 0
          ? dayActivities.reduce((s, a) => s + a.latitude, 0) / dayActivities.length
          : 0;
        const centroidLng = dayActivities.length > 0
          ? dayActivities.reduce((s, a) => s + a.longitude, 0) / dayActivities.length
          : 0;

        const dayDate = day.date instanceof Date ? day.date : new Date(day.date);
        const dayScheduledIds = new Set(day.items.filter((i) => i.type === 'activity').map((i) => i.id));

        // Score candidates: prefer high-scored, close to centroid, not duplicate
        const scoredCandidates = rescuePool
          .filter((c) => {
            if (dayScheduledIds.has(c.id)) return false;
            if (globalInsertedRescueIds.has(c.id)) return false;
            if (!c.latitude || !c.longitude) return false;
            // Skip food/nightlife/shopping
            const actType = (c.type || '').toLowerCase();
            if (['gastronomy', 'nightlife', 'shopping'].includes(actType)) return false;
            // Distance from centroid <= 4km
            if (centroidLat !== 0 && centroidLng !== 0) {
              const dist = calculateDistance(c.latitude, c.longitude, centroidLat, centroidLng);
              if (dist > 4) return false;
            }
            // Dedup check
            if (globalScheduledForRescue.some((existing) =>
              isDuplicateActivityCandidate(c, existing)
            )) return false;
            // Opening hours check
            if (!isActivityOpenOnDay(c, dayDate)) return false;
            return true;
          })
          .map((c) => {
            const dist = centroidLat !== 0 && centroidLng !== 0
              ? calculateDistance(c.latitude, c.longitude, centroidLat, centroidLng)
              : 0;
            return { candidate: c, dist, rescueScore: (c.score || 0) - dist * 15 };
          })
          .sort((a, b) => b.rescueScore - a.rescueScore)
          .slice(0, 20);

        for (const { candidate, dist } of scoredCandidates) {
          if (activityCount() >= 3 || rescueInserted >= MAX_RESCUE_INSERTIONS) break;

          // Find the largest gap in the day and try to insert
          const sorted = sortItemsByTime(day.items);
          let bestGapStart = 0;
          let bestGapEnd = 0;
          let bestGapSize = 0;

          for (let i = 0; i < sorted.length - 1; i++) {
            const gStart = parseHHMMToMinutes(sorted[i].endTime);
            const gEnd = parseHHMMToMinutes(sorted[i + 1].startTime);
            if (gEnd - gStart > bestGapSize) {
              bestGapSize = gEnd - gStart;
              bestGapStart = gStart;
              bestGapEnd = gEnd;
            }
          }

          const candidateDuration = Math.min(120, Math.max(45, candidate.duration || 60));
          if (bestGapSize < candidateDuration + 20) continue;

          const startMin = ceilToNearest15Minutes(bestGapStart + 10);
          const endMin = ceilToNearest15Minutes(Math.min(bestGapEnd - 10, startMin + candidateDuration));
          if (endMin - startMin < 45) continue;

          // Verify opening hours at the chosen time
          const startLabel = formatMinutesToHHMM(startMin);
          const endLabel = formatMinutesToHHMM(endMin);
          if (!isOpenAtTime(candidate, dayDate, startLabel, endLabel)) continue;

          const newItem = createGapFillTripItem(candidate, day.dayNumber, startMin, endMin, preferences.destination);
          // Tag as sparse_day_rescue for tracking
          if (newItem.qualityFlags) {
            newItem.qualityFlags = [...newItem.qualityFlags, 'sparse_day_rescue'];
          } else {
            (newItem as any).qualityFlags = ['gap_fill_activity', 'sparse_day_rescue'];
          }

          day.items = sortItemsByTime([...day.items, newItem]).map((item, index) => ({ ...item, orderIndex: index }));
          refreshRouteMetadataAfterMutations([day], directionsCache);

          dayScheduledIds.add(candidate.id);
          globalInsertedRescueIds.add(candidate.id);
          globalScheduledForRescue.push({
            id: candidate.id || '',
            name: candidate.name || '',
            latitude: candidate.latitude,
            longitude: candidate.longitude,
          });
          rescueInserted++;

          console.log(
            `[Pipeline V2] Sparse Day Rescue: Day ${day.dayNumber} inserted "${candidate.name}" `
            + `(${endMin - startMin}min, dist=${dist.toFixed(2)}km from centroid, ${activityCount()} activities now)`
          );
        }
      }
    }
  } catch (error) {
    console.warn('[Pipeline V2] Section 13hc (Sparse Day Rescue) failed (non-critical):', error);
  }

  // ── Must-see recovery pass ──────────────────────────────────────────────────
  // After all gap-fill passes, ensure every must-see activity from the scored
  // pool appears in the final schedule. For each missing must-see:
  //   1. Find the day with the largest available gap and insert it there.
  //   2. If no day has a gap large enough: evict the lowest-scored non-must-see
  //      activity across all days and replace it with the must-see item.
  // This runs after 13hb so it also backfills gaps exposed by the pruner.
  try {
    // Build a score lookup map from the gap-fill candidate pool (has must-see flags + scores).
    const poolScoreById = new Map<string, number>();
    for (const candidate of gapFillCandidatePool) {
      if (candidate.id) poolScoreById.set(candidate.id, candidate.score || 0);
    }

    // Collect all must-see candidates from the pool.
    const mustSeeCandidates = gapFillCandidatePool.filter((c) => c.mustSee && c.id);

    // Build set of IDs AND a list with name+GPS for similarity matching across all days.
    const scheduledMustSeeIds = new Set<string>();
    const scheduledActivitiesList: Array<{ id: string; name: string; latitude: number; longitude: number }> = [];
    for (const day of days) {
      for (const item of day.items) {
        if (item.id) scheduledMustSeeIds.add(item.id);
        if (item.type === 'activity' && item.latitude && item.longitude) {
          scheduledActivitiesList.push({
            id: item.id,
            name: item.title || '',
            latitude: item.latitude,
            longitude: item.longitude,
          });
        }
      }
    }

    // Filter missing must-sees: check BOTH exact ID AND name-similarity dedup.
    // This prevents re-inserting landmarks that are already scheduled under a
    // different ID from another data source (e.g., "Galleria Vittorio Emanuele II"
    // from SerpAPI vs. Overpass with different IDs).
    const missingMustSees = mustSeeCandidates.filter((c) => {
      if (scheduledMustSeeIds.has(c.id)) return false;
      // Also check name-similarity against all scheduled activities
      if (c.latitude && c.longitude) {
        const isDup = scheduledActivitiesList.some((scheduled) =>
          isDuplicateActivityCandidate(
            { id: c.id, name: c.name || '', latitude: c.latitude!, longitude: c.longitude! },
            { id: scheduled.id, name: scheduled.name, latitude: scheduled.latitude, longitude: scheduled.longitude }
          )
        );
        if (isDup) {
          console.log(`[Pipeline V2] Must-see recovery: skipping "${c.name}" — name-similar to already-scheduled activity`);
          return false;
        }
      }
      return true;
    });

    if (missingMustSees.length > 0) {
      console.warn(`[Pipeline V2] Must-see recovery: ${missingMustSees.length} must-see(s) missing from schedule — attempting recovery`);

      for (const mustSeeCandidate of missingMustSees) {
        const candidateDuration = mustSeeCandidate.duration || 60;

        // Find the day with the largest remaining gap that can fit this candidate.
        let bestDay: TripDay | null = null;
        let bestDayGap = 0;
        let bestInsertStartMin = 0;
        let bestInsertEndMin = 0;

        for (const day of days) {
          if (day.isDayTrip) continue;
          const sorted = sortItemsByTime(day.items);
          for (let i = 0; i < sorted.length - 1; i++) {
            const prev = sorted[i];
            const next = sorted[i + 1];
            const gapStart = parseHHMMToMinutes(prev.endTime);
            const gapEnd = parseHHMMToMinutes(next.startTime);
            const gapMinutes = gapEnd - gapStart;
            if (gapMinutes >= candidateDuration + 20) {
              // Enough room — prefer the day with the largest gap for balance.
              if (gapMinutes > bestDayGap) {
                bestDayGap = gapMinutes;
                bestDay = day;
                bestInsertStartMin = ceilToNearest15Minutes(gapStart + 10);
                bestInsertEndMin = Math.min(gapEnd - 10, bestInsertStartMin + candidateDuration);
              }
            }
          }
        }

        if (bestDay) {
          const newItem = createGapFillTripItem(
            mustSeeCandidate,
            bestDay.dayNumber,
            bestInsertStartMin,
            bestInsertEndMin,
            preferences.destination
          );
          bestDay.items = sortItemsByTime([...bestDay.items, newItem]).map((item, index) => ({ ...item, orderIndex: index }));
          refreshRouteMetadataAfterMutations([bestDay], directionsCache);
          scheduledMustSeeIds.add(mustSeeCandidate.id);
          if (mustSeeCandidate.latitude && mustSeeCandidate.longitude) {
            scheduledActivitiesList.push({ id: mustSeeCandidate.id, name: mustSeeCandidate.name || '', latitude: mustSeeCandidate.latitude, longitude: mustSeeCandidate.longitude });
          }
          console.log(`[Pipeline V2] Must-see recovery: inserted "${mustSeeCandidate.name}" into day ${bestDay.dayNumber} (gap=${bestDayGap}min)`);
        } else {
          // No gap found — evict the lowest-scored non-must-see activity across all days.
          let evictDay: TripDay | null = null;
          let evictItem: TripItem | null = null;
          let evictScore = Infinity;

          for (const day of days) {
            if (day.isDayTrip) continue;
            for (const item of day.items) {
              if (item.type !== 'activity') continue;
              if (item.mustSee) continue;
              const itemScore = poolScoreById.get(item.id) ?? 0;
              if (itemScore < evictScore) {
                evictScore = itemScore;
                evictItem = item;
                evictDay = day;
              }
            }
          }

          if (evictDay && evictItem) {
            // Replace the evicted item with the must-see, but check for overlaps first.
            const startMin = ceilToNearest15Minutes(parseHHMMToMinutes(evictItem.startTime));
            const itemsAfterEvict = evictDay.items.filter((i) => i.id !== evictItem!.id);
            const sortedAfterEvict = sortItemsByTime(itemsAfterEvict);

            // Find the real available gap after eviction
            const nextItem = sortedAfterEvict.find((i) => parseHHMMToMinutes(i.startTime) > startMin);
            const gapEnd = nextItem ? parseHHMMToMinutes(nextItem.startTime) : 23 * 60;
            const maxAvailableDuration = gapEnd - startMin - 15; // 15min buffer
            const slotDuration = Math.min(
              Math.max(candidateDuration, parseHHMMToMinutes(evictItem.endTime) - startMin),
              Math.max(45, maxAvailableDuration)
            );

            if (slotDuration >= 45) {
              const newItem = createGapFillTripItem(
                mustSeeCandidate,
                evictDay.dayNumber,
                startMin,
                startMin + slotDuration,
                preferences.destination
              );
              evictDay.items = sortItemsByTime([...itemsAfterEvict, newItem]).map((item, index) => ({ ...item, orderIndex: index }));
              refreshRouteMetadataAfterMutations([evictDay], directionsCache);
              scheduledMustSeeIds.add(mustSeeCandidate.id);
              if (mustSeeCandidate.latitude && mustSeeCandidate.longitude) {
                scheduledActivitiesList.push({ id: mustSeeCandidate.id, name: mustSeeCandidate.name || '', latitude: mustSeeCandidate.latitude, longitude: mustSeeCandidate.longitude });
              }
              console.log(`[Pipeline V2] Must-see recovery: evicted "${evictItem.title}" (score=${evictScore.toFixed(1)}) and replaced with must-see "${mustSeeCandidate.name}" on day ${evictDay.dayNumber} (${slotDuration}min, gap=${maxAvailableDuration + 15}min)`);
            } else {
              console.warn(`[Pipeline V2] Must-see recovery: gap too small (${maxAvailableDuration + 15}min) after evicting "${evictItem.title}" — cannot place "${mustSeeCandidate.name}"`);
            }
          } else {
            console.warn(`[Pipeline V2] Must-see recovery: could not place "${mustSeeCandidate.name}" — no eviction candidate found`);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Pipeline V2] Must-see recovery pass failed (non-critical):', error);
  }

  // 13f. Final route metadata coherence pass after all swaps/re-orders.
  refreshRouteMetadataAfterMutations(days, directionsCache);

  // 13g. Final cross-day dedup: catch any duplicates introduced by gap-fill or must-see recovery.
  // Keeps the FIRST occurrence (earlier day) and removes later duplicates.
  {
    const globalSeenActivities: Array<{ id: string; name: string; latitude: number; longitude: number }> = [];
    for (const day of days) {
      const before = day.items.length;
      day.items = day.items.filter(item => {
        if (item.type !== 'activity') return true;
        const candidate = { id: item.id, name: item.title, latitude: item.latitude, longitude: item.longitude };
        const isDup = globalSeenActivities.some(existing =>
          isDuplicateActivityCandidate(candidate, existing)
        );
        if (isDup) {
          console.log(`[Pipeline V2] Final cross-day dedup: removed "${item.title}" from Day ${day.dayNumber}`);
          return false;
        }
        globalSeenActivities.push(candidate);
        return true;
      });
      if (day.items.length < before) {
        day.items = day.items.map((item, idx) => ({ ...item, orderIndex: idx }));
      }
    }
  }

  // Recompute inter-item route metadata after the last cross-day dedup pass.
  refreshRouteMetadataAfterMutations(days, directionsCache);
  refreshScheduleDiagnostics(days);

  // 13. Build cost breakdown
  const costBreakdown = computeCostBreakdown(days, effectiveFlights, hotel, preferences, transport, selectedParking);

  // 13b. Hotel booking URL enrichment moved to PRE-LOOP section (before main loop)
  // so checkin/checkout items pick up enriched URLs during assembly.

  const accommodationOptions = selectTopHotelsByBarycenter(
    clusters,
    data.bookingHotels || [],
    preferences.budgetLevel,
    data.budgetStrategy?.accommodationBudgetPerNight,
    preferences.durationDays,
    { destination: preferences.destination },
    3
  );
  if (hotel && !accommodationOptions.some((option) => option.id === hotel.id)) {
    accommodationOptions.unshift(hotel);
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
    outboundFlight: outboundFlight || undefined,
    returnFlight: returnFlight || undefined,
    accommodation: hotel || undefined,
    parking: selectedParking || undefined,
    accommodationOptions: accommodationOptions.slice(0, 5),
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
    // Start with a mode-specific station lead.
    const departureLeadMinutes = getGroundDepartureLeadMinutes(transport.mode);
    return {
      start: new Date(realDep.getTime() - departureLeadMinutes * 60 * 1000),
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
 * Detect public spaces that are always open (bridges, squares, parks, monuments, etc.).
 * Google Places often returns `null` opening hours for these, which would incorrectly
 * flag them as "closed". This whitelist bypasses the opening hours check entirely.
 */
function isAlwaysOpenPublicSpace(activity: ScoredActivity): boolean {
  const name = (activity.name || '').toLowerCase();
  const ALWAYS_OPEN_KEYWORDS = [
    'piazza', 'plaza', 'place', 'square', 'platz', 'náměstí', 'namesti', 'tér',
    'bridge', 'pont', 'puente', 'brücke', 'most', 'ponte',
    'park', 'jardin', 'garden', 'garten', 'parc',
    'fountain', 'fontaine', 'fontana', 'fuente',
    'promenade', 'boulevard', 'esplanade', 'paseo',
    'viewpoint', 'belvedere', 'mirador', 'belvédère',
    'quai', 'waterfront', 'lungomare', 'boardwalk',
    'wall', 'mur ', 'muralla', 'mauer',
    'gate', 'porte', 'porta', 'tor ', 'puerta',
    'column', 'colonne', 'obelisk', 'obélisque',
    'statue', 'monument',
  ];
  return ALWAYS_OPEN_KEYWORDS.some(kw => name.includes(kw));
}

/**
 * Check if an activity is open on a specific day.
 * Returns false only if we have per-day data and the day is explicitly null (closed).
 * Returns true for unknown hours (default — err on side of scheduling).
 */
function isActivityOpenOnDay(activity: ScoredActivity, dayDate: Date): boolean {
  if (isAlwaysOpenPublicSpace(activity)) return true; // Public spaces never close
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
  // Public spaces (bridges, squares, parks, etc.) are always accessible
  if (isAlwaysOpenPublicSpace(activity)) return true;

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
      // B2: Add directions link from hotel to first activity
      firstMovableItem.directionsFromPrevious = buildDirectionsUrl(
        hotelItem.latitude, hotelItem.longitude,
        firstMovableItem.latitude, firstMovableItem.longitude,
        firstMovableItem.transportToPrevious || 'transit'
      );
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
      // B2: Add directions link between consecutive items
      curr.directionsFromPrevious = buildDirectionsUrl(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude,
        curr.transportToPrevious || 'transit'
      );
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
    // FIX F: Deduplicate cuisineTypes (often "restaurant de hamburgers, restaurant de hamburgers")
    const uniqueCuisines = [...new Set(itemData.cuisineTypes)].slice(0, 3).join(', ');
    if (itemData.specialties?.length > 0) {
      return cut(`${uniqueCuisines} · ${itemData.specialties[0]}`);
    }
    return cut(uniqueCuisines);
  }

  // 4. Fallback to tips (often populated by Viator, attractions.ts curated data)
  if (itemData.tips && typeof itemData.tips === 'string' && !looksLikeAddress(itemData.tips)) {
    return cut(itemData.tips);
  }

  // 5. Empty is better than an address
  return '';
}

type MealSlotContext = {
  mealCoords?: GeoPoint;
  prevAnchor?: GeoPoint;
  nextAnchor?: GeoPoint;
  earliestStart?: Date;
};

type MealGapCandidate = {
  start: Date;
  end: Date;
  size: number;
  prevItem?: ScheduleItem;
  nextItem?: ScheduleItem;
};

function hasFiniteGeoPoint(point?: Partial<GeoPoint> | null): point is GeoPoint {
  return !!point
    && typeof point.latitude === 'number'
    && typeof point.longitude === 'number'
    && Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude !== 0
    && point.longitude !== 0;
}

function extractGeoPointFromUnknown(value: any): GeoPoint | undefined {
  if (!hasFiniteGeoPoint(value)) return undefined;
  return { latitude: value.latitude, longitude: value.longitude };
}

function extractGeoPointFromScheduleItem(item?: ScheduleItem): GeoPoint | undefined {
  if (!item) return undefined;
  return extractGeoPointFromUnknown(item.data);
}

function distanceKmBetweenPoints(from?: GeoPoint, to?: GeoPoint): number | null {
  if (!from || !to) return null;
  return calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
}

function computeTurnAngleDeg(previous: GeoPoint, current: GeoPoint, next: GeoPoint): number | null {
  const v1x = current.longitude - previous.longitude;
  const v1y = current.latitude - previous.latitude;
  const v2x = next.longitude - current.longitude;
  const v2y = next.latitude - current.latitude;
  const norm1 = Math.hypot(v1x, v1y);
  const norm2 = Math.hypot(v2x, v2y);
  if (norm1 < 1e-6 || norm2 < 1e-6) return null;
  const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (norm1 * norm2)));
  return Math.acos(cosTheta) * (180 / Math.PI);
}

function computeMealDetourKm(
  previous: GeoPoint | undefined,
  meal: GeoPoint | undefined,
  next: GeoPoint | undefined
): number {
  if (!meal) return 0;
  const prevToMeal = distanceKmBetweenPoints(previous, meal);
  const mealToNext = distanceKmBetweenPoints(meal, next);
  const prevToNext = distanceKmBetweenPoints(previous, next);

  if (prevToMeal != null && mealToNext != null && prevToNext != null) {
    return Math.max(0, prevToMeal + mealToNext - prevToNext);
  }
  if (prevToMeal != null) return prevToMeal;
  if (mealToNext != null) return mealToNext;
  return 0;
}

function computeMealZigzagPenalty(
  previous: GeoPoint | undefined,
  meal: GeoPoint | undefined,
  next: GeoPoint | undefined
): number {
  if (!previous || !meal || !next) return 0;
  const angle = computeTurnAngleDeg(previous, meal, next);
  if (angle == null || angle <= MEAL_SLOT_ZIGZAG_ANGLE_THRESHOLD) return 0;
  return MEAL_SLOT_ZIGZAG_PENALTY;
}

function scoreMealGap(
  gap: MealGapCandidate,
  duration: number,
  idealTime: Date,
  context: MealSlotContext
): { start: Date; end: Date; score: number } | null {
  if (gap.size < duration) return null;

  const latestStartMs = gap.end.getTime() - duration * 60000;
  if (latestStartMs < gap.start.getTime()) return null;
  const startMs = Math.max(gap.start.getTime(), Math.min(idealTime.getTime(), latestStartMs));
  const slotStart = new Date(startMs);
  const slotEnd = new Date(startMs + duration * 60000);
  const timePenaltyMin = Math.abs((slotStart.getTime() - idealTime.getTime()) / 60000);

  const prevAnchor = context.prevAnchor || extractGeoPointFromScheduleItem(gap.prevItem);
  const nextAnchor = context.nextAnchor || extractGeoPointFromScheduleItem(gap.nextItem);
  const detourKm = computeMealDetourKm(prevAnchor, context.mealCoords, nextAnchor);
  const zigzagPenalty = computeMealZigzagPenalty(prevAnchor, context.mealCoords, nextAnchor);
  const slotScore = timePenaltyMin + detourKm * MEAL_SLOT_DETOUR_WEIGHT + zigzagPenalty;

  return { start: slotStart, end: slotEnd, score: slotScore };
}

export function findBestMealSlot(
  scheduler: DayScheduler,
  dayDate: Date,
  windowStartStr: string,
  windowEndStr: string,
  duration: number,
  idealTimeStr: string,
  context: MealSlotContext = {}
): { start: Date; end: Date } | null {
  const windowStart = parseTime(dayDate, windowStartStr);
  const windowEnd = parseTime(dayDate, windowEndStr);
  const effectiveWindowStart = context.earliestStart
    ? new Date(Math.max(windowStart.getTime(), context.earliestStart.getTime()))
    : windowStart;
  if (effectiveWindowStart >= windowEnd) return null;

  const allItems = scheduler.getItems()
    .sort((a, b) => a.slot.start.getTime() - b.slot.start.getTime());
  const items = allItems
    .filter((item) => item.slot.end > effectiveWindowStart && item.slot.start < windowEnd);

  const gaps: MealGapCandidate[] = [];
  let gapStart = effectiveWindowStart;
  let prevItem = [...allItems]
    .filter((item) => item.slot.end <= effectiveWindowStart)
    .sort((a, b) => b.slot.end.getTime() - a.slot.end.getTime())[0];

  for (const item of items) {
    if (item.slot.start > gapStart) {
      const gapSize = (item.slot.start.getTime() - gapStart.getTime()) / 60000;
      if (gapSize >= duration) {
        gaps.push({
          start: new Date(gapStart),
          end: new Date(item.slot.start),
          size: gapSize,
          prevItem,
          nextItem: item,
        });
      }
    }
    gapStart = new Date(Math.max(gapStart.getTime(), item.slot.end.getTime()));
    prevItem = item;
  }

  if (gapStart < windowEnd) {
    const gapSize = (windowEnd.getTime() - gapStart.getTime()) / 60000;
    if (gapSize >= duration) {
      gaps.push({
        start: new Date(gapStart),
        end: new Date(windowEnd),
        size: gapSize,
        prevItem,
      });
    }
  }

  if (gaps.length === 0) return null;

  const idealTime = parseTime(dayDate, idealTimeStr);
  const scoredCandidates = gaps
    .map((gap) => scoreMealGap(gap, duration, idealTime, context))
    .filter((candidate): candidate is { start: Date; end: Date; score: number } => candidate !== null)
    .sort((a, b) => a.score - b.score);
  const bestCandidate = scoredCandidates[0];
  if (!bestCandidate) return null;

  return { start: bestCandidate.start, end: bestCandidate.end };
}

function tryInsertMealUsingGeoSlot(params: {
  scheduler: DayScheduler;
  dayDate: Date;
  id: string;
  title: string;
  duration: number;
  data: any;
  windowStartStr: string;
  windowEndStr: string;
  idealTimeStr: string;
  context?: MealSlotContext;
}): boolean {
  const slot = findBestMealSlot(
    params.scheduler,
    params.dayDate,
    params.windowStartStr,
    params.windowEndStr,
    params.duration,
    params.idealTimeStr,
    params.context || {}
  );
  if (!slot) return false;
  return !!params.scheduler.insertFixedItem({
    id: params.id,
    title: params.title,
    type: 'restaurant',
    startTime: slot.start,
    endTime: slot.end,
    data: params.data,
  });
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

/** Round minutes-since-midnight UP to the nearest 15min boundary (for clean display times). */
function ceilToNearest15Minutes(minutes: number): number {
  const remainder = minutes % 15;
  return remainder === 0 ? minutes : minutes + (15 - remainder);
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

function isBudgetSelfCateredItem(item: TripItem): boolean {
  const flags = Array.isArray(item.qualityFlags) ? item.qualityFlags : [];
  if (flags.includes('budget_self_catered_meal')) return true;
  return (item.title || '').toLowerCase().includes('cuisine maison');
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

  // Annotate first outside item with hotel departure info (no separate transport item)
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

    // Store hotel departure info on the first item (for map routing)
    const firstOutsideIdx = result.findIndex(item => item.id === firstOutside.id);
    if (firstOutsideIdx !== -1) {
      result[firstOutsideIdx] = {
        ...result[firstOutsideIdx],
        distanceFromPrevious: Math.round(directDistanceKm * 100) / 100,
        timeFromPrevious: estimatedDuration,
        transportToPrevious: inferredMode,
      };
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

  // Hotel return: no separate item needed (map will handle route back to hotel)

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
    'bookingUrl', 'officialBookingUrl', 'viatorUrl', 'viatorTitle', 'viatorImageUrl', 'viatorRating',
    'viatorReviewCount', 'viatorDuration', 'viatorPrice', 'aviasalesUrl',
    'omioFlightUrl', 'googleMapsUrl', 'googleMapsPlaceUrl', 'restaurant',
    'restaurantAlternatives', 'accommodation', 'flight', 'flightAlternatives',
    'transitInfo', 'transitLegs', 'transitDataSource', 'priceRange',
    'transportMode', 'transportRole', 'transportDirection', 'transportTimeSource',
    'mealType', 'dataReliability', 'geoSource', 'geoConfidence', 'qualityFlags', 'imageUrl',
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

type DayGeoShape = {
  activityCount: number;
  totalLegKm: number;
  maxLegKm: number;
  radiusKm: number;
};

function getDayGeoActivities(items: TripItem[]): TripItem[] {
  return sortItemsByTime(items).filter((item) =>
    item.type === 'activity'
    && !!item.latitude
    && !!item.longitude
    && item.latitude !== 0
    && item.longitude !== 0
  );
}

function computeDayGeoShape(items: TripItem[]): DayGeoShape {
  const activities = getDayGeoActivities(items);
  if (activities.length === 0) {
    return { activityCount: 0, totalLegKm: 0, maxLegKm: 0, radiusKm: 0 };
  }

  const centroid = {
    lat: activities.reduce((sum, item) => sum + item.latitude, 0) / activities.length,
    lng: activities.reduce((sum, item) => sum + item.longitude, 0) / activities.length,
  };
  let radiusKm = 0;
  let totalLegKm = 0;
  let maxLegKm = 0;

  for (let i = 0; i < activities.length; i++) {
    const distToCentroid = calculateDistance(
      activities[i].latitude,
      activities[i].longitude,
      centroid.lat,
      centroid.lng
    );
    if (distToCentroid > radiusKm) radiusKm = distToCentroid;

    if (i === 0) continue;
    const legKm = calculateDistance(
      activities[i - 1].latitude,
      activities[i - 1].longitude,
      activities[i].latitude,
      activities[i].longitude
    );
    totalLegKm += legKm;
    if (legKm > maxLegKm) maxLegKm = legKm;
  }

  return { activityCount: activities.length, totalLegKm, maxLegKm, radiusKm };
}

function targetGeoShapeAcceptable(before: DayGeoShape, after: DayGeoShape): boolean {
  if (before.activityCount >= 2) {
    if (after.radiusKm > before.radiusKm + ADJACENT_GEO_TARGET_RADIUS_TOLERANCE_KM) return false;
    if (after.maxLegKm > before.maxLegKm + ADJACENT_GEO_TARGET_MAX_LEG_TOLERANCE_KM) return false;
    return true;
  }

  // Sparse day: keep absolute caps to prevent creating a new stretched route.
  return after.radiusKm <= 4.2 && after.maxLegKm <= 4.5;
}

function isGeoSafeOutlierSwap(
  sourceDay: TripDay,
  sourceItem: TripItem,
  targetDay: TripDay,
  targetItem: TripItem
): boolean {
  if (sourceItem.mustSee || targetItem.mustSee) return false;
  if (!sourceItem.latitude || !sourceItem.longitude || !targetItem.latitude || !targetItem.longitude) return false;

  const sourceBefore = computeDayGeoShape(sourceDay.items);
  const targetBefore = computeDayGeoShape(targetDay.items);

  const sourceAfterItems = sourceDay.items.map((item) =>
    item.id === sourceItem.id
      ? { ...item, latitude: targetItem.latitude, longitude: targetItem.longitude }
      : item
  );
  const targetAfterItems = targetDay.items.map((item) =>
    item.id === targetItem.id
      ? { ...item, latitude: sourceItem.latitude, longitude: sourceItem.longitude }
      : item
  );

  const sourceAfter = computeDayGeoShape(sourceAfterItems);
  const targetAfter = computeDayGeoShape(targetAfterItems);
  const netGainKm =
    (sourceBefore.totalLegKm + targetBefore.totalLegKm)
    - (sourceAfter.totalLegKm + targetAfter.totalLegKm);

  if (netGainKm <= ADJACENT_GEO_NET_GAIN_MIN_KM) return false;
  if (!targetGeoShapeAcceptable(targetBefore, targetAfter)) return false;
  return true;
}

function isGeoSafeAdjacentMove(
  sourceDay: TripDay,
  targetDay: TripDay,
  candidate: TripItem,
  targetStartTime: string,
  targetEndTime: string
): boolean {
  if (candidate.mustSee) return false;
  if (!candidate.latitude || !candidate.longitude) return false;

  const sourceBefore = computeDayGeoShape(sourceDay.items);
  const targetBefore = computeDayGeoShape(targetDay.items);

  const sourceAfterItems = sourceDay.items.filter((item) => item.id !== candidate.id);
  const movedCandidate: TripItem = {
    ...candidate,
    dayNumber: targetDay.dayNumber,
    startTime: targetStartTime,
    endTime: targetEndTime,
  };
  const targetAfterItems = [...targetDay.items, movedCandidate];

  const sourceAfter = computeDayGeoShape(sourceAfterItems);
  const targetAfter = computeDayGeoShape(targetAfterItems);
  const netGainKm =
    (sourceBefore.totalLegKm + targetBefore.totalLegKm)
    - (sourceAfter.totalLegKm + targetAfter.totalLegKm);

  if (netGainKm <= ADJACENT_GEO_NET_GAIN_MIN_KM) return false;
  if (!targetGeoShapeAcceptable(targetBefore, targetAfter)) return false;
  return true;
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
      && !item.mustSee
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
          && !item.mustSee
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

          if (improvement <= ADJACENT_GEO_NET_GAIN_MIN_KM) continue;
          if (!isGeoSafeOutlierSwap(sourceDay, sourceItem, targetDay, targetItem)) continue;
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

function isFixedScheduleItem(item: TripItem): boolean {
  if (item.type === 'checkin' || item.type === 'checkout' || item.type === 'flight') return true;
  if (item.type === 'transport' && (
    item.transportRole === 'longhaul'
    || item.transportRole === 'hotel_depart'
    || item.transportRole === 'hotel_return'
  )) {
    return true;
  }
  return false;
}

function getItemDurationMinutes(item: TripItem): number {
  const start = parseHHMMToMinutes(item.startTime);
  const end = parseHHMMToMinutes(item.endTime);
  const fromSlot = end - start;
  if (fromSlot > 0) return fromSlot;
  if (item.duration && item.duration > 0) return item.duration;
  if (item.type === 'restaurant') return 60;
  if (item.type === 'activity') return 90;
  return 30;
}

function getTransitionMinutesForItems(from: TripItem, to: TripItem, cache?: DirectionsCache): number {
  const estimated = estimateTravel(from, to, cache);
  const minFloor = from.type === 'restaurant' || to.type === 'restaurant' ? 10 : 15;
  return Math.max(minFloor, Math.min(45, roundToNearestFive(estimated)));
}

function isOptionalActivityItem(item: TripItem): boolean {
  return item.type === 'activity' && !item.mustSee && !isFixedScheduleItem(item);
}

function getRestaurantMealWindow(item: TripItem): { startMin: number; endMin: number } | null {
  if (item.type !== 'restaurant') return null;
  const label = extractMealLabel(item.title || '');
  if (label === 'Petit-déjeuner') return { startMin: 7 * 60, endMin: 10 * 60 };
  if (label === 'Déjeuner') return { startMin: 12 * 60, endMin: 15 * 60 };
  if (label === 'Dîner') return { startMin: 19 * 60, endMin: 22 * 60 };
  return null;
}

function isCandidateGeoCompatible(prev: TripItem, candidate: TripItem, next: TripItem): boolean {
  if (!prev.latitude || !prev.longitude || !candidate.latitude || !candidate.longitude || !next.latitude || !next.longitude) {
    return true;
  }
  const dPrev = calculateDistance(prev.latitude, prev.longitude, candidate.latitude, candidate.longitude);
  const dNext = calculateDistance(candidate.latitude, candidate.longitude, next.latitude, next.longitude);
  return dPrev <= GEO_STRICT_LOCAL_LEG_MAX_KM && dNext <= GEO_STRICT_LOCAL_LEG_MAX_KM;
}

function distanceBetweenTripItemsKm(from?: TripItem, to?: TripItem): number | null {
  if (!from || !to) return null;
  if (!from.latitude || !from.longitude || !to.latitude || !to.longitude) return null;
  return calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
}

function countTurnsInTripItemSequence(items: TripItem[]): number {
  const points = items
    .filter((item) =>
      !!item.latitude
      && !!item.longitude
      && item.latitude !== 0
      && item.longitude !== 0
    )
    .map((item) => ({ latitude: item.latitude, longitude: item.longitude }));
  if (points.length < 3) return 0;

  let turns = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const angle = computeTurnAngleDeg(points[i - 1], points[i], points[i + 1]);
    if (angle != null && angle >= MEAL_SLOT_ZIGZAG_ANGLE_THRESHOLD) turns += 1;
  }
  return turns;
}

function countLocalTurnsInWindow(items: TripItem[], startIndex: number, endIndex: number): number {
  const start = Math.max(0, startIndex);
  const end = Math.min(items.length - 1, endIndex);
  if (start > end) return 0;
  return countTurnsInTripItemSequence(items.slice(start, end + 1));
}

function evaluateGeoSafetyForGapMove(items: TripItem[], gapIndex: number, candidateIndex: number): boolean {
  const prev = items[gapIndex];
  const next = items[gapIndex + 1];
  const candidate = items[candidateIndex];
  if (!prev || !next || !candidate) return false;

  const sourcePrev = items[candidateIndex - 1];
  const sourceNext = items[candidateIndex + 1];

  const targetBefore = distanceBetweenTripItemsKm(prev, next);
  const targetAfterPrev = distanceBetweenTripItemsKm(prev, candidate);
  const targetAfterNext = distanceBetweenTripItemsKm(candidate, next);
  const sourceBeforePrev = distanceBetweenTripItemsKm(sourcePrev, candidate);
  const sourceBeforeNext = distanceBetweenTripItemsKm(candidate, sourceNext);
  const sourceAfterBypass = distanceBetweenTripItemsKm(sourcePrev, sourceNext);

  if (targetAfterPrev != null && targetAfterPrev > GEO_STRICT_LOCAL_LEG_MAX_KM) return false;
  if (targetAfterNext != null && targetAfterNext > GEO_STRICT_LOCAL_LEG_MAX_KM) return false;
  if (sourceAfterBypass != null && sourceAfterBypass > GEO_STRICT_LOCAL_LEG_MAX_KM) return false;

  let beforeKm = 0;
  let afterKm = 0;
  let hasComparableCost = false;
  for (const dist of [targetBefore, sourceBeforePrev, sourceBeforeNext]) {
    if (dist == null) continue;
    beforeKm += dist;
    hasComparableCost = true;
  }
  for (const dist of [targetAfterPrev, targetAfterNext, sourceAfterBypass]) {
    if (dist == null) continue;
    afterKm += dist;
    hasComparableCost = true;
  }
  if (hasComparableCost && afterKm > beforeKm + GEO_STRICT_LOCAL_MOVE_TOLERANCE_KM) return false;

  const windowStart = Math.max(0, Math.min(gapIndex, candidateIndex) - 2);
  const windowEnd = Math.min(items.length - 1, Math.max(gapIndex + 1, candidateIndex + 1) + 2);
  const turnsBefore = countLocalTurnsInWindow(items, windowStart, windowEnd);

  const simulated = [...items];
  const [moving] = simulated.splice(candidateIndex, 1);
  simulated.splice(gapIndex + 1, 0, moving);
  const turnsAfter = countLocalTurnsInWindow(simulated, windowStart, windowEnd);
  if (turnsAfter > turnsBefore) return false;

  return true;
}

export function tryMoveOptionalActivityIntoGap(
  items: TripItem[],
  gapIndex: number,
  cache?: DirectionsCache
): boolean {
  const prev = items[gapIndex];
  const next = items[gapIndex + 1];
  if (!prev || !next) return false;

  const prevEnd = parseHHMMToMinutes(prev.endTime);
  const nextStart = parseHHMMToMinutes(next.startTime);
  if (nextStart - prevEnd <= MAX_INTRA_DAY_GAP_MIN) return false;

  for (let idx = gapIndex + 2; idx < items.length; idx++) {
    const candidate = items[idx];
    if (!isOptionalActivityItem(candidate)) continue;
    if (!isCandidateGeoCompatible(prev, candidate, next)) continue;
    if (!evaluateGeoSafetyForGapMove(items, gapIndex, idx)) continue;

    const candidateDuration = getItemDurationMinutes(candidate);
    const startMin = prevEnd + getTransitionMinutesForItems(prev, candidate, cache);
    const latestStart = nextStart - getTransitionMinutesForItems(candidate, next, cache) - candidateDuration;
    if (latestStart < startMin) continue;

    candidate.startTime = formatMinutesToHHMM(startMin);
    candidate.endTime = formatMinutesToHHMM(startMin + candidateDuration);
    return true;
  }

  return false;
}

export function compressIntraDayGaps(days: TripDay[], cache?: DirectionsCache): number {
  let adjustedSegments = 0;

  for (const day of days) {
    let guard = 0;
    let changed = true;

    while (changed && guard < 20) {
      guard++;
      changed = false;
      const sorted = sortItemsByTime(day.items);

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (isFixedScheduleItem(prev) || isFixedScheduleItem(curr)) continue;

        const prevEnd = parseHHMMToMinutes(prev.endTime);
        const currStart = parseHHMMToMinutes(curr.startTime);
        const gap = currStart - prevEnd;
        if (gap <= MAX_INTRA_DAY_GAP_MIN) continue;

        const currDuration = getItemDurationMinutes(curr);
        const earliestStart = prevEnd + getTransitionMinutesForItems(prev, curr, cache);
        let minAllowedStart = earliestStart;
        let latestStart = currStart;
        if (i < sorted.length - 1) {
          const next = sorted[i + 1];
          const nextStart = parseHHMMToMinutes(next.startTime);
          const transitionToNext = getTransitionMinutesForItems(curr, next, cache);
          latestStart = Math.min(latestStart, nextStart - transitionToNext - currDuration);
        }

        const mealWindow = getRestaurantMealWindow(curr);
        if (mealWindow) {
          minAllowedStart = Math.max(minAllowedStart, mealWindow.startMin);
          latestStart = Math.min(latestStart, mealWindow.endMin - currDuration);
        }

        if (minAllowedStart <= latestStart && minAllowedStart < currStart) {
          curr.startTime = formatMinutesToHHMM(minAllowedStart);
          curr.endTime = formatMinutesToHHMM(minAllowedStart + currDuration);
          adjustedSegments++;
          changed = true;
          break;
        }

        if (tryMoveOptionalActivityIntoGap(sorted, i - 1, cache)) {
          adjustedSegments++;
          changed = true;
          break;
        }
      }

      day.items = sortItemsByTime(sorted).map((item, idx) => ({ ...item, orderIndex: idx }));
    }
  }

  return adjustedSegments;
}

function stripMealPrefix(title: string): string {
  return title.replace(/^(Petit-déjeuner|Déjeuner|Dîner)\s+—\s+/, '').trim();
}

function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeActivityCandidateName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * Returns a 0-1 fitness score for scheduling an activity at a given hour.
 * Generalizable: based on activity keywords/type, not specific places.
 * Higher = better fit for that time of day.
 */
function getTimeOfDayFitness(activity: ScoredActivity, hourOfDay: number): number {
  const name = (activity.name || '').toLowerCase();
  const desc = (activity.description || '').toLowerCase();
  const text = `${name} ${desc}`;
  const actType = (activity.type || '').toLowerCase();

  // Classify activity by keywords
  const isMuseum = actType === 'culture' && /\b(mus[eé]|museum|gallery|galerie|exposition|exhibit)\b/i.test(text);
  const isOutdoorWalk = /\b(promenade|walk|quartier|neighborhood|quarter|march[eé]|stroll|flâner|balade)\b/i.test(text)
    || actType === 'neighborhood';
  const isParkOrViewpoint = /\b(park|parc|jardin|garden|viewpoint|vue|panoram|belv[eé]d[èe]re|esplanade|champ)\b/i.test(text)
    || actType === 'nature';
  const isMarket = /\b(march[eé]|market|flea|brocante|puces)\b/i.test(text);
  const isReligious = /\b(church|[eé]glise|cath[eé]dral|basilique|basilica|chapel|chapelle|mosqu[eé]|synagogue|temple|abbaye|abbey)\b/i.test(text);
  const isMonument = /\b(tower|tour|arc|monument|palace|palais|château|castle|fort)\b/i.test(text);

  if (isMuseum) {
    // Museums: best in morning, acceptable early afternoon, poor after 17h
    if (hourOfDay >= 9 && hourOfDay < 13) return 0.95;
    if (hourOfDay >= 13 && hourOfDay < 15) return 0.8;
    if (hourOfDay >= 15 && hourOfDay < 17) return 0.6;
    if (hourOfDay >= 17) return 0.25;
    return 0.5;
  }

  if (isMarket) {
    // Markets: morning only
    if (hourOfDay >= 8 && hourOfDay < 13) return 0.95;
    if (hourOfDay >= 13 && hourOfDay < 14) return 0.5;
    return 0.2;
  }

  if (isParkOrViewpoint) {
    // Parks/viewpoints: great in late afternoon (golden hour)
    if (hourOfDay >= 16 && hourOfDay < 20) return 0.95;
    if (hourOfDay >= 10 && hourOfDay < 16) return 0.7;
    return 0.4;
  }

  if (isOutdoorWalk) {
    // Walking/neighborhood exploration: good anytime but best in afternoon
    if (hourOfDay >= 15 && hourOfDay < 20) return 0.9;
    if (hourOfDay >= 10 && hourOfDay < 15) return 0.7;
    return 0.5;
  }

  if (isReligious) {
    // Religious sites: best in morning
    if (hourOfDay >= 9 && hourOfDay < 12) return 0.9;
    if (hourOfDay >= 12 && hourOfDay < 17) return 0.65;
    return 0.35;
  }

  if (isMonument) {
    // Monuments/towers: flexible, slightly better in afternoon for views
    if (hourOfDay >= 14 && hourOfDay < 20) return 0.85;
    if (hourOfDay >= 9 && hourOfDay < 14) return 0.75;
    return 0.5;
  }

  // Default: neutral fitness
  return 0.6;
}

function isWorthwhileGapFillActivity(activity: ScoredActivity): boolean {
  // Block food/drink/shopping/nightlife by ActivityType
  const actType = (activity.type || '').toLowerCase();
  if (['gastronomy', 'nightlife', 'shopping'].includes(actType)) return false;

  const text = normalizeActivityCandidateName(`${activity.name || ''} ${activity.description || ''}`);
  if (text && containsAnyKeyword(text, GAP_FILL_LOW_VALUE_KEYWORDS)) return false;
  if (text && containsAnyKeyword(text, GAP_FILL_FOOD_ESTABLISHMENT_KEYWORDS)) return false;

  // Accept all attraction-like types (including Google Places mapped types like 'museum', 'park', 'attraction')
  if (['culture', 'nature', 'museum', 'park', 'gallery', 'religious',
       'zoo', 'attraction', 'amusement_park', 'market'].includes(actType)) return true;
  // Stadiums are excluded: exterior-only, can't visit without event ticket
  if (!text) return false;

  return containsAnyKeyword(text, GAP_FILL_WORTHWHILE_KEYWORDS);
}

function hasWeakGapFillQualityFlags(activity: ScoredActivity): boolean {
  const flags = Array.isArray(activity.qualityFlags) ? activity.qualityFlags : [];
  if (flags.length === 0) return false;
  return flags.some((flag) => {
    const normalized = String(flag || '').toLowerCase();
    return GAP_FILL_WEAK_QUALITY_FLAG_FRAGMENTS.some((fragment) => normalized.includes(fragment));
  });
}

function passesGapFillReliabilityGate(activity: ScoredActivity): boolean {
  if (activity.mustSee) return true;
  if (activity.businessStatus === 'CLOSED_PERMANENTLY') return false;
  if (activity.dataReliability === 'generated') return false;
  if (activity.geoConfidence === 'low') return false;
  if (hasWeakGapFillQualityFlags(activity)) return false;

  const rating = activity.rating || 0;
  const reviewCount = activity.reviewCount || 0;

  if (rating > 0 && rating < 3.9) return false;
  if (reviewCount === 0 && rating > 0 && rating < 4.2) return false;
  if (reviewCount > 0 && reviewCount < 20 && rating < 4.4) return false;
  if (reviewCount >= 20 && reviewCount < 80 && rating < 4.2) return false;

  return true;
}

function isGapFillCandidateEligible(activity: ScoredActivity): boolean {
  if (!activity.latitude || !activity.longitude || activity.latitude === 0 || activity.longitude === 0) return false;

  // Reject activities with absurdly short names (e.g. "mètre", "eau", "air")
  // or names that match known non-POI patterns
  const actName = (activity.name || '').trim();
  if (actName.length > 0 && actName.length < 4 && !activity.mustSee) return false;

  // Reject single common words that are clearly not places
  if (isGarbageActivity(activity)) return false;

  if (!passesGapFillReliabilityGate(activity)) return false;
  if (activity.mustSee) return true;
  return isWorthwhileGapFillActivity(activity);
}

function toScoredGapFillCandidate(
  activity: Attraction,
  source: ScoredActivity['source'],
  destCoords: { lat: number; lng: number }
): ScoredActivity | null {
  if (!activity || !activity.latitude || !activity.longitude || activity.latitude === 0 || activity.longitude === 0) {
    return null;
  }
  if (activity.businessStatus === 'CLOSED_PERMANENTLY') return null;

  const distanceToCityCenter = calculateDistance(
    activity.latitude,
    activity.longitude,
    destCoords.lat,
    destCoords.lng
  );
  if (distanceToCityCenter > 22) return null;

  const reviewCount = activity.reviewCount || 0;
  const rating = activity.rating || 0;
  const defaultScore = rating * 18 + Math.log10(reviewCount + 1) * 6 + (activity.mustSee ? 20 : 0);
  const score = Number.isFinite((activity as any).score) ? Number((activity as any).score) : defaultScore;

  return {
    ...activity,
    source,
    score,
    reviewCount,
  };
}

function buildGapFillActivityPool(
  clusters: ActivityCluster[],
  data: FetchedData
): ScoredActivity[] {
  const candidatesByKey = new Map<string, ScoredActivity>();
  const register = (candidate: ScoredActivity | null) => {
    if (!candidate) return;
    if (!isGapFillCandidateEligible(candidate)) return;

    const nameKey = normalizeActivityCandidateName(candidate.name || candidate.id || '');
    if (!nameKey) return;
    const key = `${nameKey}|${candidate.latitude.toFixed(4)}|${candidate.longitude.toFixed(4)}`;

    const existing = candidatesByKey.get(key);
    if (!existing || (candidate.score || 0) > (existing.score || 0)) {
      candidatesByKey.set(key, candidate);
    }
  };

  for (const cluster of clusters) {
    for (const activity of cluster.activities) {
      register(activity);
    }
  }

  const rawSources: Array<{ activities: Attraction[]; source: ScoredActivity['source'] }> = [
    { activities: data.googlePlacesAttractions || [], source: 'google_places' },
    { activities: data.serpApiAttractions || [], source: 'serpapi' },
    { activities: data.overpassAttractions || [], source: 'overpass' },
    { activities: data.mustSeeAttractions || [], source: 'mustsee' },
  ];

  for (const sourceChunk of rawSources) {
    for (const activity of sourceChunk.activities) {
      register(toScoredGapFillCandidate(activity, sourceChunk.source, data.destCoords));
    }
  }

  return [...candidatesByKey.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 160);
}

/**
 * Relaxed eligibility check for emergency gap-fill on large gaps (>= 180min).
 * Skips the strict "worthwhile" keyword filter and just requires basic quality.
 */
function isGapFillCandidateEligibleRelaxed(activity: ScoredActivity): boolean {
  if (!activity.latitude || !activity.longitude || activity.latitude === 0 || activity.longitude === 0) return false;

  const actName = (activity.name || '').trim();
  if (actName.length > 0 && actName.length < 4 && !activity.mustSee) return false;

  if (isGarbageActivity(activity)) return false;

  if (activity.businessStatus === 'CLOSED_PERMANENTLY') return false;
  if (activity.dataReliability === 'generated') return false;
  if (activity.geoConfidence === 'low') return false;

  // For relaxed mode: just require minimum score and reject food/shopping/nightlife
  if ((activity.score || 0) < 10) return false;

  const actType = (activity.type || '').toLowerCase();
  if (['gastronomy', 'nightlife', 'shopping'].includes(actType)) return false;

  const nameNormalized = normalizeActivityCandidateName(`${activity.name || ''} ${activity.description || ''}`);
  if (nameNormalized && containsAnyKeyword(nameNormalized, GAP_FILL_FOOD_ESTABLISHMENT_KEYWORDS)) return false;
  if (nameNormalized && containsAnyKeyword(nameNormalized, GAP_FILL_LOW_VALUE_KEYWORDS)) return false;

  return true;
}

/**
 * Build a relaxed gap-fill pool for emergency use when standard pool is insufficient.
 * Uses relaxed eligibility criteria (no strict keyword filter).
 */
function buildRelaxedGapFillActivityPool(
  clusters: ActivityCluster[],
  data: FetchedData
): ScoredActivity[] {
  const candidatesByKey = new Map<string, ScoredActivity>();
  const register = (candidate: ScoredActivity | null) => {
    if (!candidate) return;
    if (!isGapFillCandidateEligibleRelaxed(candidate)) return;

    const nameKey = normalizeActivityCandidateName(candidate.name || candidate.id || '');
    if (!nameKey) return;
    const key = `${nameKey}|${candidate.latitude.toFixed(4)}|${candidate.longitude.toFixed(4)}`;

    const existing = candidatesByKey.get(key);
    if (!existing || (candidate.score || 0) > (existing.score || 0)) {
      candidatesByKey.set(key, candidate);
    }
  };

  for (const cluster of clusters) {
    for (const activity of cluster.activities) {
      register(activity);
    }
  }

  const rawSources: Array<{ activities: Attraction[]; source: ScoredActivity['source'] }> = [
    { activities: data.googlePlacesAttractions || [], source: 'google_places' },
    { activities: data.serpApiAttractions || [], source: 'serpapi' },
    { activities: data.overpassAttractions || [], source: 'overpass' },
    { activities: data.mustSeeAttractions || [], source: 'mustsee' },
  ];

  for (const sourceChunk of rawSources) {
    for (const activity of sourceChunk.activities) {
      register(toScoredGapFillCandidate(activity, sourceChunk.source, data.destCoords));
    }
  }

  return [...candidatesByKey.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 200);
}

const WALK_ACTIVITY_KEYWORDS = [
  'walk', 'promenade', 'canal walk', 'stroll', 'passeggiata',
  'balade', 'randonnee urbaine', 'marche',
];

function isWalkActivity(name: string): boolean {
  const lower = (name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return WALK_ACTIVITY_KEYWORDS.some(k => lower.includes(k));
}

function createGapFillTripItem(
  candidate: ScoredActivity,
  dayNumber: number,
  startMin: number,
  endMin: number,
  destination: string
): TripItem {
  const candidateName = candidate.name || 'Activité complémentaire';
  const placeQuery = `${candidateName}, ${destination}`;
  const slotDuration = Math.max(30, endMin - startMin);

  return {
    id: candidate.id,
    dayNumber,
    startTime: formatMinutesToHHMM(startMin),
    endTime: formatMinutesToHHMM(endMin),
    type: 'activity',
    title: candidateName,
    description: candidate.description || candidateName,
    locationName: candidateName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    orderIndex: 0,
    estimatedCost: candidate.estimatedCost || 0,
    duration: slotDuration,
    rating: candidate.rating,
    bookingUrl: isWalkActivity(candidateName)
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeQuery)}&travelmode=walking`
      : (candidate.bookingUrl || candidate.officialBookingUrl || candidate.googleMapsUrl),
    officialBookingUrl: candidate.officialBookingUrl,
    viatorUrl: candidate.viatorUrl,
    googleMapsPlaceUrl:
      candidate.googleMapsUrl
      || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeQuery)}`,
    dataReliability: candidate.dataReliability || 'estimated',
    mustSee: Boolean(candidate.mustSee),
    qualityFlags: ['gap_fill_activity'],
  };
}

function getDynamicGapFillCap(largestGapMinutes: number): number {
  if (largestGapMinutes >= 240) return 8;
  if (largestGapMinutes >= 180) return 7;
  return GAP_FILL_MAX_INSERTIONS_PER_DAY;
}

export function fillLargeIntraDayGapsWithNearbyActivities(
  days: TripDay[],
  candidatePool: ScoredActivity[],
  destination: string,
  cache?: DirectionsCache
): number {
  let totalInserted = 0;

  // Global tracking: prevents inserting the same candidate on 2 different days via gap-fill.
  const globalInsertedIds = new Set<string>();

  // Global dedup list: name+GPS similarity check across ALL days (prevents cross-day duplicates).
  const scheduledActivitiesList: Array<{ id: string; name: string; latitude: number; longitude: number }> =
    days.flatMap((day) =>
      day.items
        .filter((item) => item.type === 'activity')
        .map((item) => ({
          id: item.id,
          name: item.title,
          latitude: item.latitude,
          longitude: item.longitude,
        }))
    );

  for (const day of days) {
    if (day.isDayTrip) continue;
    let insertedForDay = 0;
    let safetyGuard = 0;
    const dayDate = day.date instanceof Date ? day.date : new Date(day.date);

    // Per-day scheduled IDs: only activities ALREADY on THIS day are blocked.
    // This allows activities from other days' clusters to be considered as gap-fill candidates.
    const dayScheduledIds = new Set(
      day.items.filter((item) => item.type === 'activity').map((item) => item.id)
    );

    let largestGap = computeLargestGapMinutes(day);
    while (insertedForDay < getDynamicGapFillCap(largestGap) && safetyGuard < 8) {
      safetyGuard++;
      const sortedItems = sortItemsByTime(day.items);
      let bestPlacement: {
        candidate: ScoredActivity;
        startMin: number;
        endMin: number;
        score: number;
        detourKm: number;
      } | null = null;

      for (let i = 0; i < sortedItems.length - 1; i++) {
        const prev = sortedItems[i];
        const next = sortedItems[i + 1];
        const gapStart = parseHHMMToMinutes(prev.endTime);
        const gapEnd = parseHHMMToMinutes(next.startTime);
        const gapMinutes = gapEnd - gapStart;
        if (gapMinutes < GAP_FILL_MIN_GAP_MIN) continue;
        if (!hasValidCoords(prev) || !hasValidCoords(next)) continue;

        for (const candidate of candidatePool) {
          if (!isGapFillCandidateEligible(candidate)) continue;
          if (dayScheduledIds.has(candidate.id)) continue;           // Already on this day
          if (globalInsertedIds.has(candidate.id)) continue;         // Already inserted on another day by gap-fill
          if (scheduledActivitiesList.some(existing =>
            isDuplicateActivityCandidate(candidate, existing))) continue;
          if (!isActivityOpenOnDay(candidate, dayDate)) continue;

          const travelPrev = roundToNearestFive(estimateTravel(prev, candidate, cache));
          const travelNext = roundToNearestFive(estimateTravel(candidate, next, cache));
          const startMin = ceilToNearest15Minutes(gapStart + travelPrev);
          const availableDuration = gapEnd - travelNext - startMin;
          if (availableDuration < GAP_FILL_MIN_DURATION_MIN) continue;

          const minDuration = Math.max(
            GAP_FILL_MIN_DURATION_MIN,
            Math.min(120, getMinDuration(candidate.name || '', candidate.type || ''))
          );
          const baseDuration = Math.max(minDuration, Math.min(120, candidate.duration || 60));
          const chosenDuration = Math.min(baseDuration, availableDuration);
          if (chosenDuration < minDuration) continue;
          const endMin = ceilToNearest15Minutes(startMin + chosenDuration);

          const startLabel = formatMinutesToHHMM(startMin);
          const endLabel = formatMinutesToHHMM(endMin);
          if (!isOpenAtTime(candidate, dayDate, startLabel, endLabel)) continue;

          const prevLegKm = calculateDistance(prev.latitude, prev.longitude, candidate.latitude, candidate.longitude);
          const nextLegKm = calculateDistance(candidate.latitude, candidate.longitude, next.latitude, next.longitude);

          // Scale constraints based on gap severity: larger gaps allow more geographic flexibility
          const effectiveMaxDetourKm = gapMinutes >= 240 ? 3.5 : gapMinutes >= 180 ? 2.5 : GAP_FILL_MAX_DETOUR_KM;
          const effectiveMaxLegKm = gapMinutes >= 240 ? 5.0 : gapMinutes >= 180 ? 4.5 : GEO_STRICT_LOCAL_LEG_MAX_KM;
          if (prevLegKm > effectiveMaxLegKm || nextLegKm > effectiveMaxLegKm) continue;

          const directKm = calculateDistance(prev.latitude, prev.longitude, next.latitude, next.longitude);
          const detourKm = prevLegKm + nextLegKm - directKm;
          if (detourKm > effectiveMaxDetourKm) continue;

          const angle = computeTurnAngleDeg(
            { latitude: prev.latitude, longitude: prev.longitude },
            { latitude: candidate.latitude, longitude: candidate.longitude },
            { latitude: next.latitude, longitude: next.longitude }
          );
          if (angle != null && angle >= MEAL_SLOT_ZIGZAG_ANGLE_THRESHOLD + 10) continue;

          const qualityBonus = isWorthwhileGapFillActivity(candidate) ? 16 : 0;
          const mustSeeBonus = candidate.mustSee ? 12 : 0;
          const reviewSignalBonus = candidate.reviewCount
            ? Math.min(12, Math.log10(candidate.reviewCount + 1) * 4)
            : 0;
          const ratingBonus = (candidate.rating || 0) * 2;
          const score =
            (candidate.score || 0)
            + qualityBonus
            + mustSeeBonus
            + reviewSignalBonus
            + ratingBonus
            - detourKm * 28
            - (angle != null ? Math.max(0, angle - 90) * 0.2 : 0);

          if (!bestPlacement || score > bestPlacement.score) {
            bestPlacement = { candidate, startMin, endMin, score, detourKm };
          }
        }
      }

      if (!bestPlacement) break;

      const newItem = createGapFillTripItem(
        bestPlacement.candidate,
        day.dayNumber,
        bestPlacement.startMin,
        bestPlacement.endMin,
        destination
      );

      day.items = sortItemsByTime([...day.items, newItem]).map((item, index) => ({ ...item, orderIndex: index }));
      refreshRouteMetadataAfterMutations([day], cache);

      dayScheduledIds.add(bestPlacement.candidate.id);
      globalInsertedIds.add(bestPlacement.candidate.id);
      scheduledActivitiesList.push({
        id: bestPlacement.candidate.id || '',
        name: bestPlacement.candidate.name || '',
        latitude: bestPlacement.candidate.latitude,
        longitude: bestPlacement.candidate.longitude,
      });
      insertedForDay += 1;
      totalInserted += 1;

      // Recompute the largest gap after insertion; stop early if gaps are now small enough.
      largestGap = computeLargestGapMinutes(day);

      console.log(
        `[Pipeline V2] Gap fill: Day ${day.dayNumber} inserted "${bestPlacement.candidate.name}" `
        + `(${bestPlacement.endMin - bestPlacement.startMin}min, detour=${bestPlacement.detourKm.toFixed(2)}km, remainingGap=${largestGap}min)`
      );

      if (largestGap < GAP_FILL_MIN_GAP_MIN) break;
    }
  }

  return totalInserted;
}

function getRestaurantMealType(item: TripItem): 'breakfast' | 'lunch' | 'dinner' {
  const title = item.title || '';
  if (title.includes('Petit-déjeuner')) return 'breakfast';
  if (title.includes('Déjeuner')) return 'lunch';
  return 'dinner';
}

// AnchorPoint, hasValidCoords, restaurantAnchorPoints, minDistanceToAnchorsKm
// are now imported from ./utils/restaurant-proximity

function applyRestaurantCandidateToItem(
  item: TripItem,
  candidate: Restaurant,
  source: TripItem['selectionSource'],
  destination: string
): void {
  const mealLabel = extractMealLabel(item.title);
  const baseRestaurant: Restaurant = { ...candidate };
  enforceGoogleRestaurantPhotoPolicy(baseRestaurant);

  item.title = `${mealLabel} — ${baseRestaurant.name}`;
  item.locationName = baseRestaurant.address || baseRestaurant.name;
  item.latitude = baseRestaurant.latitude || item.latitude;
  item.longitude = baseRestaurant.longitude || item.longitude;
  item.rating = baseRestaurant.rating ?? item.rating;
  item.estimatedCost = baseRestaurant.priceLevel ? baseRestaurant.priceLevel * 15 : item.estimatedCost;
  item.bookingUrl = baseRestaurant.googleMapsUrl || baseRestaurant.website || item.bookingUrl;
  item.googleMapsPlaceUrl = baseRestaurant.googleMapsUrl
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${baseRestaurant.name}, ${destination}`)}`;
  if (baseRestaurant.latitude && baseRestaurant.longitude) {
    item.googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${baseRestaurant.latitude},${baseRestaurant.longitude}`;
  }
  item.restaurant = baseRestaurant;
  item.imageUrl = baseRestaurant.photos?.[0];
  item.selectionSource = source;
  item.dataReliability = source === 'fallback' ? 'estimated' : 'verified';
}

function rankRestaurantCandidate(
  candidate: Restaurant,
  anchors: AnchorPoint[],
  usedNames: Set<string>,
  currentRestaurantId: string | undefined,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  maxDistanceKm: number
): { restaurant: Restaurant; distance: number } | null {
  if (!candidate.latitude || !candidate.longitude) return null;
  if (currentRestaurantId && candidate.id === currentRestaurantId) return null;
  if (!isAppropriateForMeal(candidate, mealType)) return null;
  if (mealType === 'breakfast' && !isBreakfastSpecialized(candidate)) return null;

  const normalizedName = normalizeRestaurantName(candidate.name || '');
  if (!normalizedName || usedNames.has(normalizedName)) return null;

  const distances = anchors.map((anchor) => calculateDistance(candidate.latitude!, candidate.longitude!, anchor.latitude, anchor.longitude));
  const distance = distances.length > 0 ? Math.min(...distances) : Infinity;
  if (!Number.isFinite(distance) || distance > maxDistanceKm) return null;

  // Absolute hard cap: no restaurant beyond 5km regardless of profile
  if (distance > RESTAURANT_ABSOLUTE_MAX_KM) return null;

  return { restaurant: candidate, distance };
}

type RestaurantFixStats = { replaced: number; flaggedFallback: number };

/**
 * Extract normalized cuisine types from a restaurant.
 * Used for cuisine diversity tracking in restaurant selection.
 */
function extractCuisineTypes(restaurant: Restaurant | undefined): Set<string> {
  const cuisines = new Set<string>();
  if (!restaurant?.cuisineTypes) return cuisines;
  for (const ct of restaurant.cuisineTypes) {
    cuisines.add(ct.toLowerCase().trim());
  }
  return cuisines;
}

/**
 * Check if a restaurant has any cuisine that's NOT in the existing cuisines set.
 * Returns true if the restaurant introduces at least one new cuisine family.
 */
function hasNewCuisineFamily(restaurant: Restaurant | undefined, existingCuisines: Set<string>): boolean {
  if (!restaurant?.cuisineTypes || restaurant.cuisineTypes.length === 0) return false;
  for (const ct of restaurant.cuisineTypes) {
    const normalized = ct.toLowerCase().trim();
    if (!existingCuisines.has(normalized)) return true;
  }
  return false;
}

/**
 * Add all cuisines from a restaurant to the existing cuisines set (mutates the set).
 */
function addCuisinesToSet(restaurant: Restaurant | undefined, cuisinesSet: Set<string>): void {
  if (!restaurant?.cuisineTypes) return;
  for (const ct of restaurant.cuisineTypes) {
    cuisinesSet.add(ct.toLowerCase().trim());
  }
}

export async function fixRestaurantOutliers(
  days: TripDay[],
  altPool: Restaurant[],
  destination: string,
  options: {
    allowApiFallback?: boolean;
    breakfastMaxKm?: number;
    mealMaxKm?: number;
    hotelCoords?: AnchorPoint;
  } = {}
): Promise<RestaurantFixStats> {
  const allowApiFallback = options.allowApiFallback ?? true;
  const breakfastMaxKm = options.breakfastMaxKm || DEFAULT_BREAKFAST_RESTAURANT_MAX_KM;
  const mealMaxKm = options.mealMaxKm || DEFAULT_MEAL_RESTAURANT_MAX_KM;
  const defaultHotelAnchor = options.hotelCoords && hasValidCoords(options.hotelCoords)
    ? options.hotelCoords
    : undefined;
  const stats: RestaurantFixStats = { replaced: 0, flaggedFallback: 0 };
  let apiCalls = 0;
  const MAX_API_CALLS = 8;

  // Collect existing cuisine types across all trip days for diversity tracking
  const existingCuisines = new Set<string>();
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant' && item.restaurant) {
        const cuisines = extractCuisineTypes(item.restaurant);
        cuisines.forEach(c => existingCuisines.add(c));
      }
    }
  }

  for (const day of days) {
    const sorted = sortItemsByTime(day.items);
    const usedNames = new Set<string>();
    let dayOutliers = 0;

    for (let idx = 0; idx < sorted.length; idx++) {
      const item = sorted[idx];
      if (item.type !== 'restaurant') continue;
      if (isBudgetSelfCateredItem(item)) continue;

      const mealType = getRestaurantMealType(item);
      const maxDistanceKm = mealType === 'breakfast' ? breakfastMaxKm : mealMaxKm;
      const anchors = restaurantAnchorPointsFromSorted(sorted, idx, mealType, defaultHotelAnchor);
      const currentName = normalizeRestaurantName(item.restaurant?.name || item.locationName || stripMealPrefix(item.title));
      const duplicateInDay = currentName.length > 0 && usedNames.has(currentName);
      const currentDistanceKm = minDistanceToAnchorsKm(item, anchors);
      const absoluteDistanceOutlier = Number.isFinite(currentDistanceKm) && currentDistanceKm > RESTAURANT_ABSOLUTE_MAX_KM;
      const isOutlier =
        (Number.isFinite(currentDistanceKm) && currentDistanceKm > maxDistanceKm)
        || absoluteDistanceOutlier;

      if (!duplicateInDay && !isOutlier) {
        if (currentName) usedNames.add(currentName);
        if (!item.selectionSource) item.selectionSource = 'pool';
        continue;
      }

      let best: { restaurant: Restaurant; distance: number; source: TripItem['selectionSource'] } | null = null;
      const combinedPool = [
        ...(item.restaurantAlternatives || []),
        ...altPool,
      ];

      for (const candidate of combinedPool) {
        const ranked = rankRestaurantCandidate(
          candidate,
          anchors,
          usedNames,
          item.restaurant?.id,
          mealType,
          maxDistanceKm
        );
        if (!ranked) continue;

        // Check if this candidate introduces a new cuisine family (diversity bonus)
        const candidateHasNewCuisine = hasNewCuisineFamily(ranked.restaurant, existingCuisines);

        if (!best) {
          best = { ...ranked, source: 'pool' };
        } else {
          const bestRestaurantHasNewCuisine = hasNewCuisineFamily(best.restaurant, existingCuisines);
          const distanceSimilar = Math.abs(ranked.distance - best.distance) < 0.2; // within 200m

          // Prefer candidate if:
          // 1. It's closer by more than 200m, OR
          // 2. Similar distance and has new cuisine (diversity bonus), OR
          // 3. Similar distance, same cuisine novelty, but better rating
          if (ranked.distance < best.distance - 0.2) {
            best = { ...ranked, source: 'pool' };
          } else if (distanceSimilar && candidateHasNewCuisine && !bestRestaurantHasNewCuisine) {
            best = { ...ranked, source: 'pool' };
          } else if (distanceSimilar && candidateHasNewCuisine === bestRestaurantHasNewCuisine && (ranked.restaurant.rating || 0) > (best.restaurant.rating || 0)) {
            best = { ...ranked, source: 'pool' };
          }
        }
      }

      if (!best && allowApiFallback && anchors.length > 0 && apiCalls < MAX_API_CALLS) {
        apiCalls++;
        try {
          const anchor = anchors[0];
          const apiCandidates = await searchRestaurantsNearbyWithFallback(
            { lat: anchor.latitude, lng: anchor.longitude },
            destination,
            { mealType, maxDistance: Math.round(maxDistanceKm * 1000), limit: 8 }
          );
          for (const apiCandidate of apiCandidates) {
            const ranked = rankRestaurantCandidate(
              apiCandidate,
              anchors,
              usedNames,
              item.restaurant?.id,
              mealType,
              maxDistanceKm
            );
            if (!ranked) continue;

            // Check if this candidate introduces a new cuisine family (diversity bonus)
            const candidateHasNewCuisine = hasNewCuisineFamily(ranked.restaurant, existingCuisines);

            if (!best) {
              best = { ...ranked, source: 'api' };
            } else {
              const bestRestaurantHasNewCuisine = hasNewCuisineFamily(best.restaurant, existingCuisines);
              const distanceSimilar = Math.abs(ranked.distance - best.distance) < 0.2; // within 200m

              // Same logic as pool selection: prefer closer, then diversity, then rating
              if (ranked.distance < best.distance - 0.2) {
                best = { ...ranked, source: 'api' };
              } else if (distanceSimilar && candidateHasNewCuisine && !bestRestaurantHasNewCuisine) {
                best = { ...ranked, source: 'api' };
              } else if (distanceSimilar && candidateHasNewCuisine === bestRestaurantHasNewCuisine && (ranked.restaurant.rating || 0) > (best.restaurant.rating || 0)) {
                best = { ...ranked, source: 'api' };
              }
            }
          }
          if (apiCandidates.length > 0) {
            altPool.push(...apiCandidates);
          }
        } catch {
          // Non-blocking: keep fallback below.
        }
      }

      if (best) {
        applyRestaurantCandidateToItem(item, best.restaurant, best.source, destination);
        usedNames.add(normalizeRestaurantName(best.restaurant.name || item.locationName || ''));
        // Track newly added cuisines for ongoing diversity scoring
        addCuisinesToSet(best.restaurant, existingCuisines);
        stats.replaced++;
        continue;
      }

      item.selectionSource = 'fallback';
      item.dataReliability = 'estimated';
      item.description = item.description
        ? `${item.description} · Restaurant conservé faute d'alternative proche`
        : "Restaurant conservé faute d'alternative proche";
      if (currentName) usedNames.add(currentName);
      dayOutliers++;
      stats.flaggedFallback++;
    }

    day.items = sortItemsByTime(sorted).map((item, orderIndex) => ({ ...item, orderIndex }));
    day.scheduleDiagnostics = {
      ...(day.scheduleDiagnostics || {}),
      outlierRestaurantsCount: dayOutliers,
      loadRebalanced: day.scheduleDiagnostics?.loadRebalanced || false,
    };
  }

  return stats;
}

function computeDayLoadMinutes(day: TripDay): number {
  const activityMinutes = day.items
    .filter((item) => item.type === 'activity')
    .reduce((sum, item) => sum + getItemDurationMinutes(item), 0);
  const mealMinutes = day.items
    .filter((item) => item.type === 'restaurant')
    .reduce((sum, item) => sum + Math.max(30, getItemDurationMinutes(item)), 0);
  const travelMinutes = typeof day.geoDiagnostics?.totalTravelMin === 'number'
    ? day.geoDiagnostics.totalTravelMin
    : day.items.reduce((sum, item) => sum + (item.timeFromPrevious || 0), 0);
  return activityMinutes + mealMinutes + travelMinutes;
}

function computeActivityCount(day: TripDay): number {
  return day.items.filter((item) => item.type === 'activity').length;
}

function findBestRebalanceCandidate(source: TripDay, target: TripDay): TripItem | null {
  const sourceCentroid = computeDayActivityCentroid(source);
  const targetCentroid = computeDayActivityCentroid(target);
  if (!sourceCentroid || !targetCentroid) return null;

  const candidates = source.items
    .filter((item) => isOptionalActivityItem(item) && hasValidCoords(item))
    .map((item) => {
      const toSource = calculateDistance(item.latitude, item.longitude, sourceCentroid.lat, sourceCentroid.lng);
      const toTarget = calculateDistance(item.latitude, item.longitude, targetCentroid.lat, targetCentroid.lng);
      return { item, gain: toSource - toTarget };
    })
    .filter((entry) => entry.gain > ADJACENT_GEO_NET_GAIN_MIN_KM)
    .sort((a, b) => b.gain - a.gain);

  return candidates[0]?.item || null;
}

function findSlotForMovedActivity(day: TripDay, durationMin: number, preferredStartMin: number): number | null {
  const sorted = sortItemsByTime(day.items);
  const windowStart = 8 * 60;
  const windowEnd = 20 * 60;
  const candidates: number[] = [];

  let cursor = windowStart;
  for (const item of sorted) {
    const start = parseHHMMToMinutes(item.startTime);
    const end = parseHHMMToMinutes(item.endTime);
    if (start - cursor >= durationMin + 10) {
      const latest = start - durationMin;
      const proposed = Math.max(cursor, Math.min(preferredStartMin, latest));
      candidates.push(proposed);
    }
    cursor = Math.max(cursor, end);
  }

  if (windowEnd - cursor >= durationMin + 10) {
    const latest = windowEnd - durationMin;
    const proposed = Math.max(cursor, Math.min(preferredStartMin, latest));
    candidates.push(proposed);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a - preferredStartMin) - Math.abs(b - preferredStartMin));
  return candidates[0];
}

function moveOptionalActivity(source: TripDay, target: TripDay): boolean {
  const sourceActivities = computeActivityCount(source);
  const targetActivities = computeActivityCount(target);
  if (sourceActivities - targetActivities < 2) return false;
  if (computeDayLoadMinutes(source) < ADJACENT_LOAD_REBALANCE_THRESHOLD_MIN) return false;

  const candidate = findBestRebalanceCandidate(source, target);
  if (!candidate) return false;

  const duration = getItemDurationMinutes(candidate);
  const preferredStart = parseHHMMToMinutes(candidate.startTime);
  const slot = findSlotForMovedActivity(target, duration, preferredStart);
  if (slot == null) return false;
  const movedStart = formatMinutesToHHMM(slot);
  const movedEnd = formatMinutesToHHMM(slot + duration);
  if (!isGeoSafeAdjacentMove(source, target, candidate, movedStart, movedEnd)) return false;

  source.items = source.items.filter((item) => item.id !== candidate.id);
  const moved: TripItem = {
    ...candidate,
    dayNumber: target.dayNumber,
    startTime: movedStart,
    endTime: movedEnd,
  };
  target.items.push(moved);

  source.items = sortItemsByTime(source.items).map((item, idx) => ({ ...item, orderIndex: idx }));
  target.items = sortItemsByTime(target.items).map((item, idx) => ({ ...item, orderIndex: idx }));

  source.scheduleDiagnostics = {
    ...(source.scheduleDiagnostics || {}),
    loadRebalanced: true,
  };
  target.scheduleDiagnostics = {
    ...(target.scheduleDiagnostics || {}),
    loadRebalanced: true,
  };
  return true;
}

export function rebalanceAdjacentDayLoad(days: TripDay[]): number {
  let moved = 0;
  let changed = true;
  let guard = 0;

  while (changed && guard < 8) {
    guard++;
    changed = false;

    for (let i = 0; i < days.length - 1; i++) {
      const left = days[i];
      const right = days[i + 1];
      const leftCount = computeActivityCount(left);
      const rightCount = computeActivityCount(right);

      let didMove = false;
      if (leftCount - rightCount >= 2) {
        didMove = moveOptionalActivity(left, right);
      } else if (rightCount - leftCount >= 2) {
        didMove = moveOptionalActivity(right, left);
      }

      if (didMove) {
        moved++;
        changed = true;
      }
    }
  }

  return moved;
}

function isHotelMealForGeoRoute(item: TripItem): boolean {
  if (item.type !== 'restaurant') return false;
  const normalizedTitle = (item.title || '')
    .toLowerCase()
    .replace(/’/g, '\'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalizedTitle.includes("a l'hotel") || normalizedTitle.includes('at hotel');
}

function isGeoStrictRouteItem(item: TripItem): boolean {
  if (isFixedScheduleItem(item)) return false;
  if (item.type === 'transport' || item.type === 'parking') return false;
  if (isHotelMealForGeoRoute(item)) return false;
  return !!item.latitude && !!item.longitude && item.latitude !== 0 && item.longitude !== 0;
}

function computeMstLowerBoundKmFromPoints(points: GeoPoint[]): number {
  if (points.length <= 1) return 0;
  const visited = new Array<boolean>(points.length).fill(false);
  const bestEdge = new Array<number>(points.length).fill(Number.POSITIVE_INFINITY);
  bestEdge[0] = 0;
  let total = 0;

  for (let step = 0; step < points.length; step++) {
    let bestIndex = -1;
    let bestValue = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      if (!visited[i] && bestEdge[i] < bestValue) {
        bestValue = bestEdge[i];
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    visited[bestIndex] = true;
    total += bestValue;

    for (let i = 0; i < points.length; i++) {
      if (visited[i]) continue;
      const dist = calculateDistance(
        points[bestIndex].latitude,
        points[bestIndex].longitude,
        points[i].latitude,
        points[i].longitude
      );
      if (dist < bestEdge[i]) bestEdge[i] = dist;
    }
  }

  return total;
}

function computeGeoStrictRouteMetrics(items: TripItem[]): {
  zigzagTurns: number;
  totalLegKm: number;
  mstLowerBoundKm: number;
  routeInefficiencyRatio: number;
  routeIsNonTrivial: boolean;
} {
  const routeItems = sortItemsByTime(items).filter(isGeoStrictRouteItem);
  const points = routeItems.map((item) => ({ latitude: item.latitude, longitude: item.longitude }));

  let totalLegKm = 0;
  for (let i = 1; i < points.length; i++) {
    totalLegKm += calculateDistance(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
  }

  let zigzagTurns = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const angle = computeTurnAngleDeg(points[i - 1], points[i], points[i + 1]);
    if (angle != null && angle >= MEAL_SLOT_ZIGZAG_ANGLE_THRESHOLD) zigzagTurns += 1;
  }

  const mstLowerBoundKm = computeMstLowerBoundKmFromPoints(points);
  const routeInefficiencyRatio = mstLowerBoundKm > 0.05
    ? totalLegKm / mstLowerBoundKm
    : 1;
  const routeIsNonTrivial = points.length >= 4 && totalLegKm > 1.5 && mstLowerBoundKm > 0.5;

  return {
    zigzagTurns,
    totalLegKm,
    mstLowerBoundKm,
    routeInefficiencyRatio,
    routeIsNonTrivial,
  };
}

export function pruneIntraDayZigzagsStrict(days: TripDay[], cache?: DirectionsCache): number {
  let totalPruned = 0;

  for (const day of days) {
    if (day.isDayTrip) continue;
    let dayPruned = 0;

    while (dayPruned < GEO_STRICT_MAX_PRUNED_OPTIONALS_PER_DAY) {
      const currentMetrics = computeGeoStrictRouteMetrics(day.items);
      const needsPrune =
        currentMetrics.zigzagTurns >= GEO_STRICT_ZIGZAG_THRESHOLD
        || (currentMetrics.routeIsNonTrivial && currentMetrics.routeInefficiencyRatio > GEO_STRICT_INEFFICIENCY_RATIO_THRESHOLD);
      if (!needsPrune) break;

      const candidates = day.items.filter((item) => isOptionalActivityItem(item));
      if (candidates.length === 0) break;

      let bestCandidate: { id: string; score: number } | null = null;
      for (const candidate of candidates) {
        const simulatedItems = day.items.filter((item) => item.id !== candidate.id);
        const simulatedMetrics = computeGeoStrictRouteMetrics(simulatedItems);
        const zigzagGain = currentMetrics.zigzagTurns - simulatedMetrics.zigzagTurns;
        const ratioGain = currentMetrics.routeInefficiencyRatio - simulatedMetrics.routeInefficiencyRatio;
        const legGain = currentMetrics.totalLegKm - simulatedMetrics.totalLegKm;
        if (zigzagGain <= 0 && ratioGain <= 0 && legGain <= 0) continue;

        const score = zigzagGain * 120 + Math.max(0, ratioGain) * 40 + Math.max(0, legGain) * 5;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { id: candidate.id, score };
        }
      }

      if (!bestCandidate) break;

      day.items = sortItemsByTime(day.items.filter((item) => item.id !== bestCandidate.id))
        .map((item, orderIndex) => ({ ...item, orderIndex }));
      refreshRouteMetadataAfterMutations([day], cache);
      dayPruned += 1;
      totalPruned += 1;
    }

    if (dayPruned > 0) {
      console.log(`[Pipeline V2] Geo strict prune: Day ${day.dayNumber} removed ${dayPruned} optional activity(ies)`);
      day.scheduleDiagnostics = {
        ...(day.scheduleDiagnostics || {}),
        geoCleanupApplied: true,
        geoPrunedActivitiesCount: (day.scheduleDiagnostics?.geoPrunedActivitiesCount || 0) + dayPruned,
      };
    }
  }

  return totalPruned;
}

function computeLargestGapMinutes(day: TripDay): number {
  const sorted = sortItemsByTime(day.items);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = parseHHMMToMinutes(sorted[i - 1].endTime);
    const currStart = parseHHMMToMinutes(sorted[i].startTime);
    maxGap = Math.max(maxGap, currStart - prevEnd);
  }
  return Math.max(0, maxGap);
}

function refreshScheduleDiagnostics(days: TripDay[]): void {
  for (const day of days) {
    day.scheduleDiagnostics = {
      largestGapMin: computeLargestGapMinutes(day),
      outlierRestaurantsCount: day.scheduleDiagnostics?.outlierRestaurantsCount || 0,
      loadRebalanced: day.scheduleDiagnostics?.loadRebalanced || false,
      geoCleanupApplied: day.scheduleDiagnostics?.geoCleanupApplied || false,
      geoPrunedActivitiesCount: day.scheduleDiagnostics?.geoPrunedActivitiesCount || 0,
    };
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
      case 'parking':
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
  groundTransport?: TransportOptionSummary | null,
  parking?: { totalPrice?: number } | null
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
  let parkingCost = 0;
  for (const day of days) {
    for (const item of day.items) {
      if (item.type === 'restaurant') foodCost += (item.estimatedCost || 0);
      if (item.type === 'activity') activitiesCost += (item.estimatedCost || 0);
      if (item.type === 'parking') parkingCost += (item.estimatedCost || 0);
    }
  }
  if (parkingCost <= 0 && parking?.totalPrice) {
    parkingCost = parking.totalPrice;
  }

  const total = flightCost + accommodationCost + foodCost + activitiesCost + transportCost + parkingCost;

  return {
    total: Math.round(total),
    breakdown: {
      flights: Math.round(flightCost),
      accommodation: Math.round(accommodationCost),
      food: Math.round(foodCost),
      activities: Math.round(activitiesCost),
      transport: Math.round(transportCost),
      parking: Math.round(parkingCost),
      other: 0,
    },
  };
}
