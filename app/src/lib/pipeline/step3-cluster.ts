/**
 * Pipeline V2 — Step 3: Geographic Clustering
 *
 * Groups nearby activities into day-sized clusters using agglomerative
 * hierarchical clustering (average-linkage). Guarantees that nearby
 * activities end up in the same cluster.
 * Pure function, zero API calls.
 */

import type { ScoredActivity, ActivityCluster } from './types';
import { calculateDistance } from '../services/geocoding';

/**
 * Cluster activities into `numDays` groups by geographic proximity.
 * Uses agglomerative hierarchical clustering with average-linkage distance.
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
  // But for SHORT trips (≤3 days), don't allocate a day-trip day — it would steal the only full day.
  // Instead, far activities compete on score and likely get dropped.
  const dayTripActivities: ScoredActivity[] = [];
  const cityActivities: ScoredActivity[] = [];

  const allowDayTrips = numDays > 3; // Only dedicate a day-trip day for 4+ day trips

  for (const a of activities) {
    const dist = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
    if (dist > 30 && allowDayTrips) {
      dayTripActivities.push(a);
    } else {
      cityActivities.push(a);
    }
  }

  // How many days for city vs day-trips?
  const dayTripDays = dayTripActivities.length > 0 ? 1 : 0;
  const cityDays = Math.max(1, numDays - dayTripDays);

  // Hierarchical clustering on city activities
  const clusters = hierarchicalClustering(cityActivities, cityDays);

  // Add day-trip cluster if needed
  if (dayTripActivities.length > 0) {
    clusters.push(buildCluster(clusters.length + 1, dayTripActivities));
  }

  // Balance cluster sizes (but protect day-trip clusters from receiving city activities)
  const dayTripClusterIdx = dayTripActivities.length > 0 ? clusters.length - 1 : -1;
  balanceClusterSizes(clusters, Math.ceil(activities.length / numDays) + 1, dayTripClusterIdx);

  // Optimize visit order within each cluster (nearest-neighbor + 2-opt)
  for (const cluster of clusters) {
    cluster.activities = optimizeVisitOrder(cluster.activities);
  }

  // Reorder clusters by geographic proximity (nearest-neighbor from city center)
  // Also handles day-trip cluster placement (middle of the trip)
  reorderClustersByProximity(clusters, cityCenter, dayTripClusterIdx);

  // Renumber days after reordering
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  return clusters;
}

/**
 * Agglomerative hierarchical clustering with average-linkage distance.
 *
 * Algorithm:
 * 1. Start: each activity is its own cluster (N clusters)
 * 2. Precompute pairwise distance matrix
 * 3. Merge the two closest clusters (average-linkage: mean distance between all member pairs)
 * 4. Repeat until K clusters remain
 *
 * Average-linkage chosen because:
 * - Single-linkage → long chains (La Rambla 2km → everything merges)
 * - Complete-linkage → too compact (splits natural walking routes)
 * - Average → balanced, produces walkable day-clusters
 *
 * Performance: O(N^3) for N=15-30 → < 1ms
 */
function hierarchicalClustering(
  activities: ScoredActivity[],
  K: number
): ActivityCluster[] {
  if (activities.length === 0) return [];
  if (K <= 1) return [buildCluster(1, activities)];
  if (activities.length <= K) {
    // Fewer activities than clusters — one per cluster
    return activities.map((a, i) => buildCluster(i + 1, [a]));
  }

  // 1. Precompute pairwise distance matrix
  const N = activities.length;
  const distMatrix: number[][] = [];
  for (let i = 0; i < N; i++) {
    distMatrix[i] = [];
    for (let j = 0; j < N; j++) {
      if (i === j) {
        distMatrix[i][j] = 0;
      } else if (j < i) {
        distMatrix[i][j] = distMatrix[j][i]; // Symmetric
      } else {
        distMatrix[i][j] = calculateDistance(
          activities[i].latitude, activities[i].longitude,
          activities[j].latitude, activities[j].longitude
        );
      }
    }
  }

  // 2. Initialize: each activity is its own cluster (as indices)
  let clusterMembers: number[][] = activities.map((_, i) => [i]);

  // 3. Agglomerate until K clusters
  while (clusterMembers.length > K) {
    // Find the two closest clusters (average-linkage)
    let bestI = 0, bestJ = 1;
    let bestDist = Infinity;

    for (let i = 0; i < clusterMembers.length; i++) {
      for (let j = i + 1; j < clusterMembers.length; j++) {
        const d = averageLinkageDistance(clusterMembers[i], clusterMembers[j], distMatrix);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge cluster[bestJ] into cluster[bestI]
    clusterMembers[bestI] = [...clusterMembers[bestI], ...clusterMembers[bestJ]];
    clusterMembers.splice(bestJ, 1);
  }

  // 4. Build ActivityCluster[] from result
  return clusterMembers.map((memberIndices, idx) => {
    const members = memberIndices.map(i => activities[i]);
    return buildCluster(idx + 1, members);
  });
}

/**
 * Average-linkage distance: mean of all pairwise distances between two clusters.
 */
function averageLinkageDistance(
  clusterA: number[],
  clusterB: number[],
  distMatrix: number[][]
): number {
  let total = 0;
  for (const a of clusterA) {
    for (const b of clusterB) {
      total += distMatrix[a][b];
    }
  }
  return total / (clusterA.length * clusterB.length);
}

/**
 * Reorder city clusters using nearest-neighbor heuristic from startCoords.
 * Ensures Day 1's cluster is closest to the arrival point, and subsequent days
 * flow geographically (e.g., north → east → south instead of north → south → north).
 * Preserves day-trip cluster position (middle of the trip).
 */
function reorderClustersByProximity(
  clusters: ActivityCluster[],
  startCoords: { lat: number; lng: number },
  dayTripClusterIdx: number
): void {
  if (clusters.length <= 2) return;

  // Separate day-trip cluster (if any) — it gets placed in the middle later
  const dayTripCluster = dayTripClusterIdx >= 0 ? clusters[dayTripClusterIdx] : null;
  const cityClusterIndices = clusters
    .map((_, i) => i)
    .filter(i => i !== dayTripClusterIdx);

  if (cityClusterIndices.length <= 2) {
    // Not enough city clusters to reorder, but still handle day-trip placement
    if (dayTripCluster && clusters.length >= 3) {
      const dtIdx = clusters.indexOf(dayTripCluster);
      clusters.splice(dtIdx, 1);
      const middleIdx = Math.floor(clusters.length / 2);
      clusters.splice(middleIdx, 0, dayTripCluster);
    }
    return;
  }

  // Nearest-neighbor from startCoords
  const remaining = new Set(cityClusterIndices);
  const order: number[] = [];
  let curLat = startCoords.lat;
  let curLng = startCoords.lng;

  while (remaining.size > 0) {
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (const idx of remaining) {
      const c = clusters[idx];
      const d = calculateDistance(curLat, curLng, c.centroid.lat, c.centroid.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    }

    if (nearestIdx === -1) break;

    order.push(nearestIdx);
    remaining.delete(nearestIdx);
    curLat = clusters[nearestIdx].centroid.lat;
    curLng = clusters[nearestIdx].centroid.lng;
  }

  // Rebuild clusters array in the new order
  const reordered: ActivityCluster[] = order.map(i => clusters[i]);

  // Re-insert day-trip cluster in the middle
  if (dayTripCluster) {
    const middleIdx = Math.floor(reordered.length / 2);
    reordered.splice(middleIdx, 0, dayTripCluster);
  }

  // Replace clusters array contents in-place
  clusters.length = 0;
  for (const c of reordered) {
    clusters.push(c);
  }

  console.log(`[Pipeline V2] Clusters reordered by proximity: ${clusters.map((c, i) =>
    `Day ${i + 1}: centroid (${c.centroid.lat.toFixed(4)}, ${c.centroid.lng.toFixed(4)})`
  ).join(', ')}`);
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
