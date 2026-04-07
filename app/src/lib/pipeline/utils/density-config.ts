/**
 * Density-adaptive distance thresholds.
 *
 * All distance constraints in the pipeline are parameterized by destination density:
 * - dense: city center (Paris, Rome, Tokyo) — tight clustering, walking distance restaurants
 * - medium: suburban/small city (Nice, Bordeaux) — moderate distances
 * - spread: rural/regional (Bretagne, Toscane, Algarve) — large distances, car-dependent
 */

export type DensityCategory = 'dense' | 'medium' | 'spread';

export interface DensityThresholds {
  /** Max radius for clustering activities into a single day (km) */
  clusterTravelRadius: number;
  /** Hard cap on cluster radius (km) */
  clusterHardCap: number;
  /** Max distance for restaurant search/placement (km) */
  restaurantMaxDist: number;
  /** Tight restaurant search radius (first pass, km) */
  restaurantTightDist: number;
  /** Standard restaurant search radius (km) */
  restaurantStandardDist: number;
  /** Extended restaurant search radius (last pass, km) */
  restaurantExtendedDist: number;
  /** Max distance for non-must-see activity outlier filtering (km) */
  outlierMaxDist: number;
  /** P0.2 contract: max restaurant distance from meal anchor (km) */
  p02ContractDist: number;
  /** SerpAPI/Google Places search radius for restaurant enrichment (meters) */
  restaurantApiRadius: number;
}

const THRESHOLDS: Record<DensityCategory, DensityThresholds> = {
  dense: {
    clusterTravelRadius: 2.0,
    clusterHardCap: 5,
    restaurantMaxDist: 1.5,
    restaurantTightDist: 0.4,
    restaurantStandardDist: 0.8,
    restaurantExtendedDist: 1.5,
    outlierMaxDist: 50,
    p02ContractDist: 1.5,
    restaurantApiRadius: 1000,
  },
  medium: {
    clusterTravelRadius: 3.0,
    clusterHardCap: 8,
    restaurantMaxDist: 2.0,
    restaurantTightDist: 0.6,
    restaurantStandardDist: 1.2,
    restaurantExtendedDist: 2.5,
    outlierMaxDist: 80,
    p02ContractDist: 2.0,
    restaurantApiRadius: 2000,
  },
  spread: {
    clusterTravelRadius: 15.0,
    clusterHardCap: 30,
    restaurantMaxDist: 5.0,
    restaurantTightDist: 2.0,
    restaurantStandardDist: 3.5,
    restaurantExtendedDist: 5.0,
    outlierMaxDist: 150,
    p02ContractDist: 5.0,
    restaurantApiRadius: 5000,
  },
};

/**
 * Get distance thresholds for the given density category.
 * Optionally override clusterTravelRadius with an adaptive value based on p75.
 */
export function getDensityThresholds(
  category: DensityCategory,
  p75?: number,
): DensityThresholds {
  const base = { ...THRESHOLDS[category] };

  // For spread destinations, adapt cluster radius to actual activity spread
  if (category === 'spread' && p75 !== undefined && p75 > 0) {
    base.clusterTravelRadius = Math.max(10, Math.min(p75 / 2, 40));
    base.clusterHardCap = Math.max(15, Math.min(p75 / 1.5, 50));
  }

  return base;
}
