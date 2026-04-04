import type { Accommodation } from '../types/trip';
import type {
  ActivityCluster,
  FetchedData,
  PipelineMapCoordinate,
  PipelineMapMarker,
  PipelineMapMarkerKind,
  PipelineMapPolyline,
  PipelineMapSnapshot,
  ScoredActivity,
} from './types';

const FETCHED_ACTIVITY_LIMIT = 8;
const FETCHED_RESTAURANT_LIMIT = 3;
const FETCHED_HOTEL_LIMIT = 3;
const FETCHED_DAY_TRIP_LIMIT = 3;
const CLUSTERED_ACTIVITY_LIMIT_PER_DAY = 5;

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0);
}

function roundCoordinate(value: number): string {
  return value.toFixed(4);
}

function createMarker(params: {
  id: string;
  title: string;
  kind: PipelineMapMarkerKind;
  latitude: number;
  longitude: number;
  dayNumber?: number;
  score?: number;
}): PipelineMapMarker | null {
  if (!isValidCoordinate(params.latitude, params.longitude)) {
    return null;
  }

  return {
    id: params.id,
    title: params.title,
    kind: params.kind,
    latitude: params.latitude,
    longitude: params.longitude,
    dayNumber: params.dayNumber,
    score: params.score,
  };
}

function pushUniqueMarker(target: PipelineMapMarker[], marker: PipelineMapMarker | null): void {
  if (!marker) return;

  const key = [
    marker.kind,
    marker.title.trim().toLowerCase(),
    roundCoordinate(marker.latitude),
    roundCoordinate(marker.longitude),
    marker.dayNumber ?? 'x',
  ].join(':');

  const exists = target.some((entry) => [
    entry.kind,
    entry.title.trim().toLowerCase(),
    roundCoordinate(entry.latitude),
    roundCoordinate(entry.longitude),
    entry.dayNumber ?? 'x',
  ].join(':') === key);

  if (!exists) {
    target.push(marker);
  }
}

function buildCenter(
  markers: PipelineMapMarker[],
  fallback: { lat: number; lng: number },
): PipelineMapCoordinate {
  const points = markers.filter((marker) => marker.kind !== 'origin');

  if (points.length === 0) {
    return {
      latitude: fallback.lat,
      longitude: fallback.lng,
    };
  }

  return {
    latitude: points.reduce((sum, marker) => sum + marker.latitude, 0) / points.length,
    longitude: points.reduce((sum, marker) => sum + marker.longitude, 0) / points.length,
  };
}

function buildFetchedActivityCandidates(data: FetchedData): ScoredActivity[] {
  return [
    ...(data.mustSeeAttractions || []),
    ...(data.googlePlacesAttractions || []),
    ...(data.serpApiAttractions || []),
    ...(data.overpassAttractions || []),
    ...(data.viatorActivities || []),
  ] as ScoredActivity[];
}

function createPolyline(dayNumber: number, activities: ScoredActivity[]): PipelineMapPolyline | null {
  const coordinates = activities
    .filter((activity) => isValidCoordinate(activity.latitude, activity.longitude))
    .map((activity) => ({
      latitude: activity.latitude,
      longitude: activity.longitude,
    }));

  if (coordinates.length < 2) {
    return null;
  }

  return {
    id: `day-${dayNumber}`,
    kind: 'day_route',
    dayNumber,
    coordinates,
  };
}

export function buildFetchedMapSnapshot(data: FetchedData): PipelineMapSnapshot {
  const markers: PipelineMapMarker[] = [];

  pushUniqueMarker(markers, createMarker({
    id: 'origin',
    title: 'Départ',
    kind: 'origin',
    latitude: data.originCoords.lat,
    longitude: data.originCoords.lng,
  }));
  pushUniqueMarker(markers, createMarker({
    id: 'destination',
    title: 'Destination',
    kind: 'destination',
    latitude: data.destCoords.lat,
    longitude: data.destCoords.lng,
  }));

  buildFetchedActivityCandidates(data)
    .filter((activity) => isValidCoordinate(activity.latitude, activity.longitude))
    .slice(0, FETCHED_ACTIVITY_LIMIT)
    .forEach((activity) => {
      pushUniqueMarker(markers, createMarker({
        id: activity.id || activity.name,
        title: activity.name,
        kind: 'activity',
        latitude: activity.latitude,
        longitude: activity.longitude,
        score: activity.score,
      }));
    });

  [...(data.tripAdvisorRestaurants || []), ...(data.serpApiRestaurants || [])]
    .filter((restaurant) => isValidCoordinate(restaurant.latitude, restaurant.longitude))
    .slice(0, FETCHED_RESTAURANT_LIMIT)
    .forEach((restaurant) => {
      pushUniqueMarker(markers, createMarker({
        id: restaurant.id,
        title: restaurant.name,
        kind: 'restaurant',
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        score: restaurant.rating,
      }));
    });

  (data.bookingHotels || [])
    .filter((hotel) => isValidCoordinate(hotel.latitude, hotel.longitude))
    .slice(0, FETCHED_HOTEL_LIMIT)
    .forEach((hotel) => {
      pushUniqueMarker(markers, createMarker({
        id: hotel.id,
        title: hotel.name,
        kind: 'hotel',
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        score: hotel.rating,
      }));
    });

  (data.dayTripSuggestions || [])
    .filter((suggestion) => isValidCoordinate(suggestion.latitude, suggestion.longitude))
    .slice(0, FETCHED_DAY_TRIP_LIMIT)
    .forEach((suggestion) => {
      pushUniqueMarker(markers, createMarker({
        id: `day-trip-${suggestion.destination}`,
        title: suggestion.destination,
        kind: 'day_trip',
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
      }));
    });

  return {
    stage: 'fetched',
    center: buildCenter(markers, data.destCoords),
    markers,
  };
}

export function buildClusteredMapSnapshot(
  clusters: ActivityCluster[],
  hotel: Accommodation | null,
  data: FetchedData,
): PipelineMapSnapshot {
  const markers: PipelineMapMarker[] = [];
  const polylines: PipelineMapPolyline[] = [];

  pushUniqueMarker(markers, createMarker({
    id: 'origin',
    title: 'Départ',
    kind: 'origin',
    latitude: data.originCoords.lat,
    longitude: data.originCoords.lng,
  }));
  pushUniqueMarker(markers, createMarker({
    id: 'destination',
    title: 'Destination',
    kind: 'destination',
    latitude: data.destCoords.lat,
    longitude: data.destCoords.lng,
  }));

  if (hotel) {
    pushUniqueMarker(markers, createMarker({
      id: hotel.id,
      title: hotel.name,
      kind: 'hotel',
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      score: hotel.rating,
    }));
  }

  clusters.forEach((cluster) => {
    cluster.activities
      .filter((activity) => isValidCoordinate(activity.latitude, activity.longitude))
      .slice(0, CLUSTERED_ACTIVITY_LIMIT_PER_DAY)
      .forEach((activity) => {
        pushUniqueMarker(markers, createMarker({
          id: `${cluster.dayNumber}-${activity.id || activity.name}`,
          title: activity.name,
          kind: cluster.isDayTrip ? 'day_trip' : 'activity',
          latitude: activity.latitude,
          longitude: activity.longitude,
          dayNumber: cluster.dayNumber,
          score: activity.score,
        }));
      });

    if (cluster.isDayTrip && cluster.dayTripDestination) {
      pushUniqueMarker(markers, createMarker({
        id: `day-trip-cluster-${cluster.dayNumber}`,
        title: cluster.dayTripDestination,
        kind: 'day_trip',
        latitude: cluster.centroid.lat,
        longitude: cluster.centroid.lng,
        dayNumber: cluster.dayNumber,
      }));
    }

    const polyline = createPolyline(cluster.dayNumber, cluster.activities);
    if (polyline) {
      polylines.push(polyline);
    }
  });

  const fallbackCenter = hotel
    ? { lat: hotel.latitude, lng: hotel.longitude }
    : data.destCoords;

  return {
    stage: 'clustered',
    center: buildCenter(markers, fallbackCenter),
    markers,
    polylines: polylines.length > 0 ? polylines : undefined,
  };
}
