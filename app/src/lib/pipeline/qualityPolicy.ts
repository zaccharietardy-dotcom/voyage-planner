import { calculateDistance } from '../services/geocoding';
import type { ActivityCluster, ScoredActivity } from './types';

export type QualityCityProfileId = 'dense_urban' | 'urban_standard' | 'metro_spread';

export interface QualityCityProfile {
  id: QualityCityProfileId;
  hotelTargetKm: number;
  hotelHardCapKm: number;
  breakfastMaxKm: number;
  restaurantMaxKm: number;
}

const QUALITY_PROFILES: Record<QualityCityProfileId, QualityCityProfile> = {
  dense_urban: {
    id: 'dense_urban',
    hotelTargetKm: 0.8,
    hotelHardCapKm: 1.2,
    breakfastMaxKm: 0.8,
    restaurantMaxKm: 0.8,
  },
  urban_standard: {
    id: 'urban_standard',
    hotelTargetKm: 1.2,
    hotelHardCapKm: 2.0,
    breakfastMaxKm: 1.0,
    restaurantMaxKm: 1.0,
  },
  metro_spread: {
    id: 'metro_spread',
    hotelTargetKm: 1.8,
    hotelHardCapKm: 3.0,
    breakfastMaxKm: 1.4,
    restaurantMaxKm: 1.5,
  },
};

const CITY_PROFILE_OVERRIDES: Array<{ pattern: RegExp; profile: QualityCityProfileId }> = [
  { pattern: /\bparis\b/i, profile: 'dense_urban' },
  { pattern: /\btokyo\b/i, profile: 'dense_urban' },
  { pattern: /\blondon\b/i, profile: 'dense_urban' },
  { pattern: /\bbarcelona\b/i, profile: 'dense_urban' },
  { pattern: /\bamsterdam\b/i, profile: 'dense_urban' },
  { pattern: /\brome\b/i, profile: 'urban_standard' },
  { pattern: /\bmilan\b/i, profile: 'urban_standard' },
  { pattern: /\bberlin\b/i, profile: 'urban_standard' },
  { pattern: /\bnew york\b/i, profile: 'urban_standard' },
  { pattern: /\blos angeles\b/i, profile: 'metro_spread' },
  { pattern: /\bdubai\b/i, profile: 'metro_spread' },
];

type GeoPoint = { lat: number; lng: number };

function getOverrideProfile(destination?: string): QualityCityProfile | null {
  if (!destination) return null;
  const normalized = destination.trim().toLowerCase();
  for (const rule of CITY_PROFILE_OVERRIDES) {
    if (rule.pattern.test(normalized)) {
      return QUALITY_PROFILES[rule.profile];
    }
  }
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function collectPointsFromClusters(clusters?: ActivityCluster[]): GeoPoint[] {
  if (!clusters || clusters.length === 0) return [];
  return clusters
    .flatMap((cluster) => cluster.activities || [])
    .filter((activity) =>
      Number.isFinite(activity.latitude)
      && Number.isFinite(activity.longitude)
      && activity.latitude !== 0
      && activity.longitude !== 0
    )
    .map((activity) => ({ lat: activity.latitude, lng: activity.longitude }));
}

function collectPointsFromActivities(activities?: ScoredActivity[]): GeoPoint[] {
  if (!activities || activities.length === 0) return [];
  return activities
    .filter((activity) =>
      Number.isFinite(activity.latitude)
      && Number.isFinite(activity.longitude)
      && activity.latitude !== 0
      && activity.longitude !== 0
    )
    .map((activity) => ({ lat: activity.latitude, lng: activity.longitude }));
}

function inferProfileFromDispersion(points: GeoPoint[]): QualityCityProfile {
  if (points.length < 2) return QUALITY_PROFILES.urban_standard;

  const pairwiseDistances: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      pairwiseDistances.push(calculateDistance(points[i].lat, points[i].lng, points[j].lat, points[j].lng));
    }
  }

  pairwiseDistances.sort((a, b) => a - b);
  const median = percentile(pairwiseDistances, 0.5);
  const p75 = percentile(pairwiseDistances, 0.75);

  if (median <= 1.5 && p75 <= 4) return QUALITY_PROFILES.dense_urban;
  if (median <= 3.5 && p75 <= 8) return QUALITY_PROFILES.urban_standard;
  return QUALITY_PROFILES.metro_spread;
}

export function resolveQualityCityProfile(args: {
  destination?: string;
  clusters?: ActivityCluster[];
  activities?: ScoredActivity[];
}): QualityCityProfile {
  const override = getOverrideProfile(args.destination);
  if (override) return override;

  const pointsFromActivities = collectPointsFromActivities(args.activities);
  if (pointsFromActivities.length >= 2) {
    return inferProfileFromDispersion(pointsFromActivities);
  }

  const pointsFromClusters = collectPointsFromClusters(args.clusters);
  if (pointsFromClusters.length >= 2) {
    return inferProfileFromDispersion(pointsFromClusters);
  }

  return QUALITY_PROFILES.urban_standard;
}

export function getHotelHardCapKmForProfile(profile: QualityCityProfile, durationDays?: number): number {
  if (!durationDays || durationDays > 4) return profile.hotelHardCapKm;
  return Math.max(profile.hotelTargetKm + 0.2, profile.hotelHardCapKm - 0.15);
}

export function getRestaurantMaxDistanceKmForProfile(profile: QualityCityProfile, mealType: 'breakfast' | 'lunch' | 'dinner'): number {
  if (mealType === 'breakfast') return profile.breakfastMaxKm;
  return profile.restaurantMaxKm;
}

