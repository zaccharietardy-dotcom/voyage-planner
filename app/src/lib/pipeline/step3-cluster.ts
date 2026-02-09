/**
 * Pipeline V2 — Step 3: Geographic Clustering
 *
 * Groups nearby activities into day-sized clusters using K-means.
 * Pure function, zero API calls.
 */

import type { ScoredActivity, ActivityCluster } from './types';
import { calculateDistance } from '../services/geocoding';

/**
 * Cluster activities into `numDays` groups by geographic proximity.
 * Uses K-means with K-means++ initialization.
 */
export function clusterActivities(
  activities: ScoredActivity[],
  numDays: number,
  cityCenter: { lat: number; lng: number }
): ActivityCluster[] {
  if (activities.length === 0) return [];
  if (numDays <= 1 || activities.length <= 4) {
    // Single day or very few activities: one cluster
    return [buildCluster(1, activities)];
  }

  // Separate day-trip activities (>30km from center)
  const dayTripActivities: ScoredActivity[] = [];
  const cityActivities: ScoredActivity[] = [];

  for (const a of activities) {
    const dist = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
    if (dist > 30) {
      dayTripActivities.push(a);
    } else {
      cityActivities.push(a);
    }
  }

  // How many days for city vs day-trips?
  const dayTripDays = dayTripActivities.length > 0 ? 1 : 0;
  const cityDays = Math.max(1, numDays - dayTripDays);

  // K-means on city activities
  const clusters = kMeansClustering(cityActivities, cityDays, cityCenter);

  // Add day-trip cluster if needed
  if (dayTripActivities.length > 0) {
    clusters.push(buildCluster(clusters.length + 1, dayTripActivities));
  }

  // Balance cluster sizes (but protect day-trip clusters from receiving city activities)
  const dayTripClusterIdx = dayTripActivities.length > 0 ? clusters.length - 1 : -1;
  balanceClusterSizes(clusters, Math.ceil(activities.length / numDays) + 1, dayTripClusterIdx);

  // Optimize visit order within each cluster (nearest-neighbor)
  for (const cluster of clusters) {
    cluster.activities = optimizeVisitOrder(cluster.activities);
  }

  // Renumber days: put day-trip cluster in the middle (not first or last day)
  if (dayTripClusterIdx >= 0 && clusters.length >= 3) {
    const dayTripCluster = clusters.splice(dayTripClusterIdx, 1)[0];
    const middleIdx = Math.floor(clusters.length / 2);
    clusters.splice(middleIdx, 0, dayTripCluster);
  }
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  return clusters;
}

/**
 * K-means clustering with K-means++ initialization.
 */
function kMeansClustering(
  activities: ScoredActivity[],
  K: number,
  cityCenter: { lat: number; lng: number }
): ActivityCluster[] {
  if (activities.length === 0) return [];
  if (K <= 1) return [buildCluster(1, activities)];

  // K-means++ initialization
  let centroids = initCentroidsKMeansPP(activities, K);

  let assignments: number[] = new Array(activities.length).fill(0);
  const MAX_ITERATIONS = 20;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Assignment step: each activity to nearest centroid
    let changed = false;
    for (let i = 0; i < activities.length; i++) {
      const a = activities[i];
      let bestK = 0;
      let bestDist = Infinity;
      for (let k = 0; k < centroids.length; k++) {
        const d = calculateDistance(a.latitude, a.longitude, centroids[k].lat, centroids[k].lng);
        if (d < bestDist) {
          bestDist = d;
          bestK = k;
        }
      }
      if (assignments[i] !== bestK) {
        assignments[i] = bestK;
        changed = true;
      }
    }

    if (!changed) break;

    // Update step: recompute centroids
    centroids = centroids.map((c, k) => {
      const members = activities.filter((_, i) => assignments[i] === k);
      if (members.length === 0) return c; // Keep old centroid if empty
      return {
        lat: members.reduce((s, a) => s + a.latitude, 0) / members.length,
        lng: members.reduce((s, a) => s + a.longitude, 0) / members.length,
      };
    });
  }

  // Build clusters from assignments
  const clusterMap = new Map<number, ScoredActivity[]>();
  for (let i = 0; i < activities.length; i++) {
    const k = assignments[i];
    if (!clusterMap.has(k)) clusterMap.set(k, []);
    clusterMap.get(k)!.push(activities[i]);
  }

  return Array.from(clusterMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([k, members], idx) => buildCluster(idx + 1, members));
}

/**
 * K-means++ centroid initialization: spread out initial centroids.
 */
function initCentroidsKMeansPP(
  activities: ScoredActivity[],
  K: number
): { lat: number; lng: number }[] {
  const centroids: { lat: number; lng: number }[] = [];

  // Pick first centroid: the activity with highest score
  const first = activities[0]; // Already sorted by score
  centroids.push({ lat: first.latitude, lng: first.longitude });

  for (let k = 1; k < K; k++) {
    // For each activity, compute distance to nearest existing centroid
    let maxDist = -Infinity;
    let farthest = activities[0];

    for (const a of activities) {
      let minDist = Infinity;
      for (const c of centroids) {
        const d = calculateDistance(a.latitude, a.longitude, c.lat, c.lng);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDist) {
        maxDist = minDist;
        farthest = a;
      }
    }

    centroids.push({ lat: farthest.latitude, lng: farthest.longitude });
  }

  return centroids;
}

/**
 * Balance cluster sizes: move activities from oversized to undersized clusters.
 */
function balanceClusterSizes(clusters: ActivityCluster[], maxPerCluster: number, dayTripClusterIdx: number = -1): void {
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 10) {
    changed = false;
    iterations++;

    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      while (cluster.activities.length > maxPerCluster) {
        // Find the activity farthest from this cluster's centroid
        let farthestIdx = 0;
        let farthestDist = 0;

        for (let i = 0; i < cluster.activities.length; i++) {
          const a = cluster.activities[i];
          // Don't move must-sees
          if (a.mustSee) continue;
          const d = calculateDistance(a.latitude, a.longitude, cluster.centroid.lat, cluster.centroid.lng);
          if (d > farthestDist) {
            farthestDist = d;
            farthestIdx = i;
          }
        }

        // Find the smallest cluster to receive it
        // Never move city activities INTO the day-trip cluster
        const smallest = clusters
          .filter((c, idx) => c !== cluster && idx !== dayTripClusterIdx)
          .sort((a, b) => a.activities.length - b.activities.length)[0];

        if (!smallest) break;

        // Move the activity
        const [moved] = cluster.activities.splice(farthestIdx, 1);
        smallest.activities.push(moved);
        changed = true;

        // Recompute centroids
        recomputeCentroid(cluster);
        recomputeCentroid(smallest);
      }
    }
  }
}

/**
 * Optimize visit order within a cluster using nearest-neighbor heuristic.
 */
function optimizeVisitOrder(activities: ScoredActivity[]): ScoredActivity[] {
  if (activities.length <= 2) return activities;

  const ordered: ScoredActivity[] = [];
  const remaining = [...activities];

  // Start with the highest-scored activity
  ordered.push(remaining.shift()!);

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const d = calculateDistance(
        last.latitude, last.longitude,
        remaining[i].latitude, remaining[i].longitude
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    ordered.push(remaining.splice(nearestIdx, 1)[0]);
  }

  // 2-opt improvement
  return twoOptImprove(ordered);
}

/**
 * 2-opt local search to improve tour distance.
 */
function twoOptImprove(activities: ScoredActivity[]): ScoredActivity[] {
  if (activities.length <= 3) return activities;

  const route = [...activities];
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 2; i++) {
      for (let j = i + 2; j < route.length; j++) {
        const currentDist =
          segmentDist(route[i], route[i + 1]) + segmentDist(route[j], route[(j + 1) % route.length]);
        const newDist =
          segmentDist(route[i], route[j]) + segmentDist(route[i + 1], route[(j + 1) % route.length]);

        if (newDist < currentDist - 0.01) {
          // Reverse the segment between i+1 and j
          const segment = route.slice(i + 1, j + 1).reverse();
          route.splice(i + 1, segment.length, ...segment);
          improved = true;
        }
      }
    }
  }

  return route;
}

function segmentDist(a: ScoredActivity, b: ScoredActivity): number {
  return calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
}

function buildCluster(dayNumber: number, activities: ScoredActivity[]): ActivityCluster {
  const centroid = activities.length > 0
    ? {
        lat: activities.reduce((s, a) => s + a.latitude, 0) / activities.length,
        lng: activities.reduce((s, a) => s + a.longitude, 0) / activities.length,
      }
    : { lat: 0, lng: 0 };

  return {
    dayNumber,
    activities,
    centroid,
    totalIntraDistance: computeIntraDistance(activities),
  };
}

function recomputeCentroid(cluster: ActivityCluster): void {
  if (cluster.activities.length === 0) return;
  cluster.centroid = {
    lat: cluster.activities.reduce((s, a) => s + a.latitude, 0) / cluster.activities.length,
    lng: cluster.activities.reduce((s, a) => s + a.longitude, 0) / cluster.activities.length,
  };
  cluster.totalIntraDistance = computeIntraDistance(cluster.activities);
}

function computeIntraDistance(activities: ScoredActivity[]): number {
  let total = 0;
  for (let i = 0; i < activities.length - 1; i++) {
    total += calculateDistance(
      activities[i].latitude, activities[i].longitude,
      activities[i + 1].latitude, activities[i + 1].longitude
    );
  }
  return total;
}
