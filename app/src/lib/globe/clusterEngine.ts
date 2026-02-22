import type { ClusterLevel, PhotoCluster, GlobePhotoPoint } from './types';

// Continent bounding boxes (approximate)
const CONTINENTS: { name: string; latMin: number; latMax: number; lngMin: number; lngMax: number }[] = [
  { name: 'Europe', latMin: 35, latMax: 72, lngMin: -25, lngMax: 45 },
  { name: 'Asie', latMin: -10, latMax: 75, lngMin: 45, lngMax: 180 },
  { name: 'Afrique', latMin: -35, latMax: 37, lngMin: -25, lngMax: 55 },
  { name: 'Am\u00e9rique du Nord', latMin: 15, latMax: 85, lngMin: -170, lngMax: -50 },
  { name: 'Am\u00e9rique du Sud', latMin: -56, latMax: 15, lngMin: -82, lngMax: -34 },
  { name: 'Oc\u00e9anie', latMin: -50, latMax: 0, lngMin: 110, lngMax: 180 },
  { name: 'Antarctique', latMin: -90, latMax: -60, lngMin: -180, lngMax: 180 },
];

function findContinent(lat: number, lng: number): string {
  for (const c of CONTINENTS) {
    if (lat >= c.latMin && lat <= c.latMax && lng >= c.lngMin && lng <= c.lngMax) {
      return c.name;
    }
  }
  // Fallback: closest continent by lat/lng midpoint
  let closest = CONTINENTS[0].name;
  let minDist = Infinity;
  for (const c of CONTINENTS) {
    const midLat = (c.latMin + c.latMax) / 2;
    const midLng = (c.lngMin + c.lngMax) / 2;
    const d = Math.sqrt((lat - midLat) ** 2 + (lng - midLng) ** 2);
    if (d < minDist) {
      minDist = d;
      closest = c.name;
    }
  }
  return closest;
}

function centroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const sumLat = points.reduce((s, p) => s + p.lat, 0);
  const sumLng = points.reduce((s, p) => s + p.lng, 0);
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

function pickBestPhotos(points: GlobePhotoPoint[], max: number): string[] {
  return points
    .filter((p) => p.imageUrl && p.imageUrl.length > 0)
    .slice(0, max)
    .map((p) => p.imageUrl);
}

function extractCountry(destination: string): string {
  const parts = destination.split(',').map((s) => s.trim());
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
}

interface TripInput {
  id: string;
  destination: string;
  country?: string;
  ownerId?: string;
  points: GlobePhotoPoint[];
}

export function buildClusterHierarchy(trips: TripInput[]): PhotoCluster[] {
  if (trips.length === 0) return [];

  const cityMap = new Map<string, PhotoCluster>();
  const countryMap = new Map<string, PhotoCluster>();
  const continentMap = new Map<string, PhotoCluster>();

  for (const trip of trips) {
    if (trip.points.length === 0) continue;

    const tripCenter = centroid(trip.points.map((p) => ({ lat: p.lat, lng: p.lng })));

    // Monument-level clusters (one per activity with photo)
    const monumentClusters: PhotoCluster[] = trip.points
      .filter((p) => p.imageUrl)
      .map((p) => ({
        id: `monument-${p.id}`,
        level: 'monument' as ClusterLevel,
        lat: p.lat,
        lng: p.lng,
        label: p.name,
        photoUrls: [p.imageUrl],
        tripCount: 1,
        activityCount: 1,
        children: [],
        tripIds: [trip.id],
      }));

    // Trip-level cluster
    const tripCluster: PhotoCluster = {
      id: `trip-${trip.id}`,
      level: 'trip',
      lat: tripCenter.lat,
      lng: tripCenter.lng,
      label: trip.destination || 'Voyage',
      photoUrls: pickBestPhotos(trip.points, 4),
      tripCount: 1,
      activityCount: trip.points.length,
      children: monumentClusters,
      tripIds: [trip.id],
    };

    // City-level grouping
    const cityKey = (trip.destination || 'Unknown').toLowerCase().trim();
    if (!cityMap.has(cityKey)) {
      cityMap.set(cityKey, {
        id: `city-${cityKey}`,
        level: 'city',
        lat: tripCenter.lat,
        lng: tripCenter.lng,
        label: trip.destination || 'Ville',
        photoUrls: [],
        tripCount: 0,
        activityCount: 0,
        children: [],
        tripIds: [],
      });
    }
    const city = cityMap.get(cityKey)!;
    city.children.push(tripCluster);
    city.tripCount += 1;
    city.activityCount += trip.points.length;
    city.tripIds.push(trip.id);

    // Country-level grouping
    const countryKey = (trip.country || extractCountry(trip.destination) || 'Unknown').toLowerCase().trim();
    if (!countryMap.has(countryKey)) {
      countryMap.set(countryKey, {
        id: `country-${countryKey}`,
        level: 'country',
        lat: 0,
        lng: 0,
        label: trip.country || extractCountry(trip.destination) || 'Pays',
        photoUrls: [],
        tripCount: 0,
        activityCount: 0,
        children: [],
        tripIds: [],
      });
    }

    // Continent-level grouping
    const continentName = findContinent(tripCenter.lat, tripCenter.lng);
    if (!continentMap.has(continentName)) {
      continentMap.set(continentName, {
        id: `continent-${continentName}`,
        level: 'continent',
        lat: 0,
        lng: 0,
        label: continentName,
        photoUrls: [],
        tripCount: 0,
        activityCount: 0,
        children: [],
        tripIds: [],
      });
    }
  }

  // Wire up city -> country -> continent
  for (const [, city] of cityMap) {
    const cityPoints = city.children.map((t) => ({ lat: t.lat, lng: t.lng }));
    const cc = centroid(cityPoints);
    city.lat = cc.lat;
    city.lng = cc.lng;
    city.photoUrls = city.children.flatMap((t) => t.photoUrls).slice(0, 4);

    const firstTrip = trips.find((t) => city.tripIds.includes(t.id));
    const countryKey = (firstTrip?.country || extractCountry(firstTrip?.destination || '') || 'Unknown').toLowerCase().trim();
    const country = countryMap.get(countryKey);
    if (country) {
      if (!country.children.some((c) => c.id === city.id)) {
        country.children.push(city);
        country.tripCount += city.tripCount;
        country.activityCount += city.activityCount;
        city.tripIds.forEach((id) => {
          if (!country.tripIds.includes(id)) country.tripIds.push(id);
        });
      }
    }
  }

  for (const [, country] of countryMap) {
    if (country.children.length === 0) continue;
    const countryPoints = country.children.map((c) => ({ lat: c.lat, lng: c.lng }));
    const cc = centroid(countryPoints);
    country.lat = cc.lat;
    country.lng = cc.lng;
    country.photoUrls = country.children.flatMap((c) => c.photoUrls).slice(0, 4);

    const continentName = findContinent(cc.lat, cc.lng);
    const continent = continentMap.get(continentName);
    if (continent) {
      if (!continent.children.some((c) => c.id === country.id)) {
        continent.children.push(country);
        continent.tripCount += country.tripCount;
        continent.activityCount += country.activityCount;
        country.tripIds.forEach((id) => {
          if (!continent.tripIds.includes(id)) continent.tripIds.push(id);
        });
      }
    }
  }

  // Finalize continents
  const result: PhotoCluster[] = [];
  for (const [, continent] of continentMap) {
    if (continent.children.length === 0) continue;
    const continentPoints = continent.children.map((c) => ({ lat: c.lat, lng: c.lng }));
    const cc = centroid(continentPoints);
    continent.lat = cc.lat;
    continent.lng = cc.lng;
    continent.photoUrls = continent.children.flatMap((c) => c.photoUrls).slice(0, 4);
    result.push(continent);
  }

  return result;
}

export function getVisibleClusters(hierarchy: PhotoCluster[], cameraHeight: number): PhotoCluster[] {
  if (hierarchy.length === 0) return [];

  if (cameraHeight > 5_000_000) return hierarchy;
  if (cameraHeight > 1_000_000) {
    return hierarchy.flatMap((c) => c.children.length > 0 ? c.children : [c]);
  }
  if (cameraHeight > 100_000) {
    return hierarchy
      .flatMap((c) => c.children)
      .flatMap((c) => c.children.length > 0 ? c.children : [c]);
  }
  if (cameraHeight > 10_000) {
    return hierarchy
      .flatMap((c) => c.children)
      .flatMap((c) => c.children)
      .flatMap((c) => c.children.length > 0 ? c.children : [c]);
  }
  return hierarchy
    .flatMap((c) => c.children)
    .flatMap((c) => c.children)
    .flatMap((c) => c.children)
    .flatMap((c) => c.children.length > 0 ? c.children : [c]);
}

export function getZoomHeightForLevel(level: ClusterLevel): number {
  switch (level) {
    case 'continent': return 3_000_000;
    case 'country': return 500_000;
    case 'city': return 50_000;
    case 'trip': return 5_000;
    case 'monument': return 1_000;
  }
}
