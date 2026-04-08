/**
 * Pipeline V2 — Step 3: Geographic Clustering
 *
 * Groups nearby activities into day-sized clusters using agglomerative
 * hierarchical clustering (average-linkage). Guarantees that nearby
 * activities end up in the same cluster.
 * Pure function, zero API calls.
 */

import type { ScoredActivity, ActivityCluster, CityDensityProfile } from './types';
import { getDensityThresholds } from './utils/density-config';
import { calculateDistance } from '../services/geocoding';
import { isActivityOpenOnDay, DAY_NAMES_EN } from './utils/opening-hours';

/**
 * Compute a density profile for the city based on the spread of activities.
 * Used to derive an adaptive maxClusterRadius that fits the city's geography.
 *
 * Dense cities (Amsterdam, Venice) → small radius (~0.7-1.0km)
 * Medium cities (Paris, Rome) → medium radius (~1.2-2.0km)
 * Spread cities (LA, Dubai) → large radius (~3-5km)
 */
export function computeCityDensityProfile(
  activities: ScoredActivity[],
  numDays: number
): CityDensityProfile {
  const valid = activities.filter(a => a.latitude && a.longitude);
  if (valid.length < 2) {
    return { p75PairwiseDistance: 2, medianPairwiseDistance: 1, maxClusterRadius: 2, densityCategory: 'medium', hardRadiusCap: 5, urbanLegBudgetKm: 3.5, dayTripThresholdKm: 15, swapRadiusFactor: 1.3 };
  }

  // Compute all pairwise distances
  const pairwise: number[] = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      pairwise.push(calculateDistance(
        valid[i].latitude, valid[i].longitude,
        valid[j].latitude, valid[j].longitude
      ));
    }
  }
  pairwise.sort((a, b) => a - b);

  const p75Idx = Math.floor(pairwise.length * 0.75);
  const medianIdx = Math.floor(pairwise.length * 0.5);
  const p75 = pairwise[p75Idx] || 2;
  const median = pairwise[medianIdx] || 1;

  // Detect spread cities: p75 > 10km means activities are spread far apart
  // (e.g. Tokyo ~60km diameter, LA ~80km, Bangkok ~30km)
  const isSpreadCity = p75 > 10;

  // Density-adaptive thresholds: urban stays tight, rural gets large radii
  const rawDensity = isSpreadCity ? 'spread' : (p75 > 4 ? 'medium' : 'dense');
  const dt = getDensityThresholds(rawDensity, p75);

  const hardRadiusCap = isSpreadCity
    ? dt.clusterHardCap
    : 5.0;

  const baseRadius = p75 / Math.max(1, numDays);
  const travelTimeRadius = dt.clusterTravelRadius;
  const maxClusterRadius = Math.max(0.5, Math.min(baseRadius, travelTimeRadius, hardRadiusCap));

  const densityCategory: CityDensityProfile['densityCategory'] =
    maxClusterRadius <= 0.8 ? 'dense' :
    maxClusterRadius <= 2.0 ? 'medium' :
    'spread';

  // Planner budgets derived from density category
  const BUDGETS: Record<CityDensityProfile['densityCategory'], { urbanLegBudgetKm: number; dayTripThresholdKm: number; swapRadiusFactor: number }> = {
    dense:  { urbanLegBudgetKm: 2,   dayTripThresholdKm: 10, swapRadiusFactor: 1.0 },
    medium: { urbanLegBudgetKm: 3.5, dayTripThresholdKm: 15, swapRadiusFactor: 1.3 },
    spread: { urbanLegBudgetKm: 6,   dayTripThresholdKm: 20, swapRadiusFactor: 1.8 },
  };
  const budgets = BUDGETS[densityCategory];

  console.log(`[Pipeline V2] City density profile: category=${densityCategory}, p75=${p75.toFixed(2)}km, median=${median.toFixed(2)}km, maxClusterRadius=${maxClusterRadius.toFixed(2)}km, hardRadiusCap=${hardRadiusCap.toFixed(2)}km${isSpreadCity ? ' (spread city)' : ''}`);

  return {
    p75PairwiseDistance: p75, medianPairwiseDistance: median, maxClusterRadius, densityCategory, hardRadiusCap,
    urbanLegBudgetKm: budgets.urbanLegBudgetKm,
    dayTripThresholdKm: budgets.dayTripThresholdKm,
    swapRadiusFactor: budgets.swapRadiusFactor,
  };
}

/**
 * Cluster activities into `numDays` groups by geographic proximity.
 * Uses agglomerative hierarchical clustering with average-linkage distance.
 * When a densityProfile is provided, enforces max cluster radius constraints.
 */
export function clusterActivities(
  activities: ScoredActivity[],
  numDays: number,
  cityCenter: { lat: number; lng: number },
  densityProfile?: CityDensityProfile,
  startDate?: string,
  timeWindows?: Array<{ dayNumber: number; activityStartTime: string; activityEndTime: string; hasDepartureTransport?: boolean }>,
  paceFactor?: number,
  dayTripData?: {
    dayTripActivities?: Record<string, import('../services/attractions').Attraction[]>;
    dayTripSuggestions?: import('../services/dayTripSuggestions').DayTripSuggestion[];
  }
): ActivityCluster[] {
  if (activities.length === 0) return [];
  if (numDays <= 1 || activities.length <= 4) {
    // Single day or very few activities: one cluster
    return [buildCluster(1, activities)];
  }

  // Separate day-trip activities from city activities.
  // Must-see activities >10km from center get a day trip IF they match a known day trip suggestion
  // or are >30km away (clearly a different destination). 10-30km range without suggestion match
  // is treated as a suburban attraction (e.g. Disneyland) and stays in city pool.
  // Non-must-see activities >15km only get day trips for longer trips (>5 days).
  const dayTripMustSees: ScoredActivity[] = [];
  const dayTripOther: ScoredActivity[] = [];
  const cityActivities: ScoredActivity[] = [];

  // Pre-compute suggestion match helper
  const hasDayTripSuggestionMatch = (a: ScoredActivity): boolean => {
    if (!dayTripData?.dayTripSuggestions) return false;
    const aNameLower = a.name.toLowerCase();
    return dayTripData.dayTripSuggestions.some(s => {
      const d = calculateDistance(a.latitude, a.longitude, s.latitude, s.longitude);
      if (d < 5) return true;
      const sNameLower = (s.name || '').toLowerCase();
      const sDestLower = (s.destination || '').toLowerCase();
      const keyAttrs = (s.keyAttractions || []).map(k => k.toLowerCase());
      return sNameLower.includes(aNameLower) || aNameLower.includes(sDestLower) ||
        keyAttrs.some(k => k.includes(aNameLower) || aNameLower.includes(k));
    });
  };

  for (const a of activities) {
    const dist = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
    if (a.mustSee && dist > 30) {
      // Clearly a different destination (>30km) — always day trip
      dayTripMustSees.push(a);
    } else if (a.mustSee && dist > 10 && hasDayTripSuggestionMatch(a)) {
      // 10-30km must-see that matches a known day trip suggestion
      dayTripMustSees.push(a);
    } else if (dist > 15 && numDays > 5) {
      dayTripOther.push(a);
    } else {
      cityActivities.push(a);
    }
  }

  // Limit day trips based on trip length and density.
  // Spread/regional trips need more day-trip slots to avoid impossible mega-clusters.
  const farMustSeeCount = dayTripMustSees.filter((a) =>
    calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng) >= 45
  ).length;
  const hasRegionalSpreadSignal = densityProfile?.densityCategory === 'spread' || farMustSeeCount >= 2;
  const maxDayTrips = hasRegionalSpreadSignal
    ? (numDays <= 5 ? 2 : Math.max(2, Math.floor((numDays - 1) / 2)))
    : (numDays <= 5 ? 1 : Math.floor((numDays - 1) / 3));

  // If more must-see day trips than allowed, keep the FARTHEST ones (they need a dedicated day
  // the most — closer must-sees can survive in city clusters). Demote the rest.
  if (dayTripMustSees.length > maxDayTrips) {
    dayTripMustSees.sort((a, b) => {
      const distA = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
      const distB = calculateDistance(b.latitude, b.longitude, cityCenter.lat, cityCenter.lng);
      return distB - distA; // farthest first
    });
    const demoted = dayTripMustSees.splice(maxDayTrips);
    cityActivities.push(...demoted);
    console.log(`[Pipeline V3] Day trips: too many must-see day trips (${dayTripMustSees.length + demoted.length}) for ${numDays} days — demoted ${demoted.length} back to city: ${demoted.map(a => `"${a.name}"`).join(', ')}`);
  }

  // Merge remaining non-must-see day trip activities (capped)
  const remainingSlots = maxDayTrips - dayTripMustSees.length;
  if (dayTripOther.length > remainingSlots) {
    dayTripOther.sort((a, b) => b.score - a.score);
    const demoted = dayTripOther.splice(remainingSlots);
    cityActivities.push(...demoted);
  }

  const dayTripActivities = [...dayTripMustSees, ...dayTripOther];

  if (dayTripMustSees.length > 0) {
    console.log(`[Pipeline V3] Day trips: ${dayTripMustSees.length} must-see day trip(s) detected: ${dayTripMustSees.map(a => `"${a.name}" (${calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng).toFixed(1)}km)`).join(', ')}`);
  }

  // Isolate full-day activities (duration >= 240min / 4h) into their own clusters.
  // Activities like "Tokyo Disneyland" (5h), "Desert Excursion" (8h) should not be
  // mixed with regular 30-60min city visits — they consume the entire day.
  const FULL_DAY_THRESHOLD_MIN = 240;
  const fullDayActivities: ScoredActivity[] = [];
  const regularActivities: ScoredActivity[] = [];

  for (const a of cityActivities) {
    if ((a.duration || 60) >= FULL_DAY_THRESHOLD_MIN) {
      fullDayActivities.push(a);
    } else {
      regularActivities.push(a);
    }
  }

  // Each full-day activity gets its own cluster day, but cap at (numDays - dayTripDays - 1)
  // so at least 1 day remains for regular city activities
  const dayTripDays = dayTripActivities.length;
  const maxFullDaySlots = Math.max(0, numDays - dayTripDays - 1);
  // If more full-day activities than available slots, keep only the highest-scored ones;
  // demote the rest back to regular activities.
  if (fullDayActivities.length > maxFullDaySlots) {
    fullDayActivities.sort((a, b) => b.score - a.score);
    const demoted = fullDayActivities.splice(maxFullDaySlots);
    regularActivities.push(...demoted);
    console.log(`[Pipeline V2] Too many full-day activities (${fullDayActivities.length + demoted.length}) for ${numDays} days — demoted ${demoted.length} back to regular: ${demoted.map(a => `"${a.name}"`).join(', ')}`);
  }

  const fullDayClusters: ActivityCluster[] = fullDayActivities.map((a, i) => {
    const cluster = buildCluster(i + 1, [a]);
    cluster.isFullDay = true;
    return cluster;
  });

  if (fullDayClusters.length > 0) {
    console.log(`[Pipeline V2] Isolated ${fullDayClusters.length} full-day activities (>=${FULL_DAY_THRESHOLD_MIN}min): ${fullDayActivities.map(a => `"${a.name}" (${a.duration}min)`).join(', ')}`);
  }

  // How many days for city vs day-trips vs full-day?
  const fullDayDays = fullDayClusters.length;
  const cityDays = Math.max(1, numDays - dayTripDays - fullDayDays);

  // Hierarchical clustering on regular city activities (with radius constraint if available)
  const maxRadius = densityProfile?.maxClusterRadius;
  const hardRadiusCap = densityProfile?.hardRadiusCap ?? 5.0;
  const clusters = hierarchicalClustering(regularActivities, cityDays, maxRadius, hardRadiusCap);

  // Add full-day clusters
  for (const fdc of fullDayClusters) {
    fdc.dayNumber = clusters.length + 1;
    clusters.push(fdc);
  }

  // Add day-trip cluster(s) — one per day trip destination, enriched with local activities
  for (const dtAct of dayTripActivities) {
    const clusterActs: ScoredActivity[] = [dtAct];

    // Try to find the day trip destination name from suggestions.
    // Match strategies (in order): proximity <5km, name match, then wider proximity <50km.
    let destName: string | undefined;
    if (dayTripData?.dayTripSuggestions) {
      const actNameLower = dtAct.name.toLowerCase();
      const matchingSuggestion =
        // 1. Close proximity match (<5km from suggestion coords)
        dayTripData.dayTripSuggestions.find(s => {
          const d = calculateDistance(dtAct.latitude, dtAct.longitude, s.latitude, s.longitude);
          return d < 5;
        }) ||
        // 2. Name match (suggestion name/keyAttractions mentions the activity name, or vice versa)
        dayTripData.dayTripSuggestions.find(s => {
          const sNameLower = (s.name || '').toLowerCase();
          const sDestLower = (s.destination || '').toLowerCase();
          const keyAttrs = (s.keyAttractions || []).map(k => k.toLowerCase());
          return sNameLower.includes(actNameLower) || actNameLower.includes(sDestLower) ||
            keyAttrs.some(k => k.includes(actNameLower) || actNameLower.includes(k));
        }) ||
        // 3. Wider proximity (<50km — for cases like Mont Fuji activity vs Kawaguchiko base)
        dayTripData.dayTripSuggestions.find(s => {
          const d = calculateDistance(dtAct.latitude, dtAct.longitude, s.latitude, s.longitude);
          return d < 50;
        });
      destName = matchingSuggestion?.destination || matchingSuggestion?.name;
    }

    // Enrich cluster with activities from the day trip destination
    if (destName && dayTripData?.dayTripActivities?.[destName]) {
      const destActivities = dayTripData.dayTripActivities[destName];
      let added = 0;
      for (const da of destActivities) {
        if (added >= 3) break; // max 3 extra activities
        if (clusterActs.some(a => a.name === da.name || a.id === da.id)) continue;
        // Convert Attraction to ScoredActivity
        const scored: ScoredActivity = {
          ...da,
          score: da.rating ? da.rating * 10 : 30,
          source: 'serpapi' as const,
          reviewCount: da.reviewCount || 0,
          // Use day trip coords as fallback if activity has no coords
          latitude: da.latitude || dtAct.latitude,
          longitude: da.longitude || dtAct.longitude,
        };
        clusterActs.push(scored);
        added++;
      }
      if (added > 0) {
        console.log(`[Pipeline V3] Day trip "${destName}": enriched with ${added} local activities`);
      }
    }

    const cluster = buildCluster(clusters.length + 1, clusterActs);
    cluster.isFullDay = true;
    cluster.isDayTrip = true;
    cluster.dayTripDestination = destName || dtAct.name;
    clusters.push(cluster);
  }

  // Collect indices of protected clusters (full-day and day-trip) that should not
  // receive extra activities during balancing or minimum-size enforcement.
  const protectedIndices = new Set<number>();
  for (let ci = 0; ci < clusters.length; ci++) {
    if (clusters[ci].isFullDay || clusters[ci].isDayTrip) protectedIndices.add(ci);
  }
  // Legacy compat: dayTripClusterIdx used by balance/enforce functions
  const dayTripClusterIdx = dayTripActivities.length > 0
    ? clusters.findIndex(c => c.isDayTrip)
    : -1;

  // Balance cluster sizes (but protect day-trip and full-day clusters)
  balanceClusterSizes(clusters, Math.ceil(activities.length / numDays) + 1, dayTripClusterIdx, maxRadius, protectedIndices);

  // Enforce minimum cluster sizes: no full day should have fewer than 3 activities
  // (boundary days — first and last — are exempted with min=1, last day min=2)
  // Full-day clusters are also exempted (they intentionally have 1 activity)
  enforceMinimumClusterSize(clusters, 3, dayTripClusterIdx, numDays, protectedIndices);

  // Fix lonely remote activities: if a non-protected cluster has exactly 1 activity
  // that is >10km from city center, try to move it to a cluster that has activities
  // nearby (within 5km of the lonely activity), instead of leaving a near-empty day.
  for (let ci = 0; ci < clusters.length; ci++) {
    if (protectedIndices.has(ci)) continue;
    const c = clusters[ci];
    if (c.activities.length !== 1) continue;
    const act = c.activities[0];
    const distFromCenter = calculateDistance(act.latitude, act.longitude, cityCenter.lat, cityCenter.lng);
    if (distFromCenter <= 10) continue;

    // Find a non-protected cluster that has an activity within 5km of this lonely activity
    let bestTarget = -1;
    let bestDist = Infinity;
    for (let ti = 0; ti < clusters.length; ti++) {
      if (ti === ci || protectedIndices.has(ti)) continue;
      for (const tAct of clusters[ti].activities) {
        const d = calculateDistance(act.latitude, act.longitude, tAct.latitude, tAct.longitude);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = ti;
        }
      }
    }

    if (bestTarget !== -1 && bestDist <= 10) {
      // Move the lonely activity to the target cluster
      const [moved] = c.activities.splice(0, 1);
      clusters[bestTarget].activities.push(moved);
      recomputeCentroid(clusters[bestTarget]);
      console.log(`[Pipeline V2] Moved lonely remote activity "${moved.name}" (${distFromCenter.toFixed(1)}km from center) to Day ${clusters[bestTarget].dayNumber} (nearest activity ${bestDist.toFixed(1)}km away)`);

      // Redistribute: steal activities from the largest donor to fill this now-empty cluster
      const donorIdx = clusters
        .map((cl, idx) => ({ idx, size: cl.activities.length }))
        .filter(x => !protectedIndices.has(x.idx) && x.idx !== ci)
        .sort((a, b) => b.size - a.size)[0]?.idx;

      if (donorIdx !== undefined && clusters[donorIdx].activities.length >= 4) {
        // Move 2 activities closest to city center from the donor to the empty cluster
        const toMove = 2;
        for (let m = 0; m < toMove && clusters[donorIdx].activities.length > 3; m++) {
          let closestIdx = -1;
          let closestDist = Infinity;
          for (let ai = 0; ai < clusters[donorIdx].activities.length; ai++) {
            const a = clusters[donorIdx].activities[ai];
            if (a.mustSee) continue;
            const d = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
            if (d < closestDist) {
              closestDist = d;
              closestIdx = ai;
            }
          }
          if (closestIdx !== -1) {
            const [stolen] = clusters[donorIdx].activities.splice(closestIdx, 1);
            c.activities.push(stolen);
          }
        }
        recomputeCentroid(c);
        recomputeCentroid(clusters[donorIdx]);
      }
    }
  }

  // Remove empty clusters after lonely-activity redistribution
  for (let ci = clusters.length - 1; ci >= 0; ci--) {
    if (clusters[ci].activities.length === 0 && !protectedIndices.has(ci)) {
      clusters.splice(ci, 1);
    }
  }
  // Re-number days
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  // Fill missing days: if fewer clusters than requested, split the largest cluster(s)
  // so every day has at least some activities
  while (clusters.length < numDays) {
    // Find the largest non-protected cluster with ≥4 activities (worth splitting)
    let bestIdx = -1;
    let bestSize = 0;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (protectedIndices.has(ci)) continue;
      if (clusters[ci].activities.length > bestSize) {
        bestSize = clusters[ci].activities.length;
        bestIdx = ci;
      }
    }
    if (bestIdx === -1 || bestSize < 2) break; // Nothing to split

    // Split: move the bottom half (lowest-scored) to a new cluster
    const donor = clusters[bestIdx];
    const sorted = [...donor.activities].sort((a, b) => b.score - a.score);
    const splitAt = Math.ceil(sorted.length / 2);
    donor.activities = sorted.slice(0, splitAt);
    recomputeCentroid(donor);
    const newCluster = buildCluster(clusters.length + 1, sorted.slice(splitAt));
    clusters.push(newCluster);
    console.log(`[Pipeline V2] Fill missing day: split Day ${donor.dayNumber} (${bestSize} acts) → ${splitAt} + ${sorted.length - splitAt} activities`);
  }
  // Re-number days after splits
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  // Cap boundary days (first/last): arrival and departure days have shorter time windows
  // so they should have fewer activities. Max ~3 for boundary, redistribute excess to full days.
  if (clusters.length >= 3) {
    const BOUNDARY_MAX = 3;
    const boundaryIndices = [0, clusters.length - 1];
    for (const bi of boundaryIndices) {
      if (protectedIndices.has(bi)) continue;
      const c = clusters[bi];
      while (c.activities.length > BOUNDARY_MAX) {
        // Find the lowest-scored non-must-see activity to move
        let worstIdx = -1;
        let worstScore = Infinity;
        for (let ai = 0; ai < c.activities.length; ai++) {
          if (c.activities[ai].mustSee) continue;
          if (c.activities[ai].score < worstScore) {
            worstScore = c.activities[ai].score;
            worstIdx = ai;
          }
        }
        if (worstIdx === -1) break; // Only must-sees left

        // Find the smallest non-boundary, non-protected cluster to receive it
        const targetIdx = clusters
          .map((cl, idx) => ({ idx, size: cl.activities.length }))
          .filter(x => !protectedIndices.has(x.idx) && !boundaryIndices.includes(x.idx))
          .sort((a, b) => a.size - b.size)[0]?.idx;

        if (targetIdx === undefined) break;

        const [moved] = c.activities.splice(worstIdx, 1);
        clusters[targetIdx].activities.push(moved);
        recomputeCentroid(c);
        recomputeCentroid(clusters[targetIdx]);
        console.log(`[Pipeline V2] Boundary cap: moved "${moved.name}" from boundary Day ${c.dayNumber} → Day ${clusters[targetIdx].dayNumber}`);
      }
    }
  }

  // Time-proportional rebalancing: distribute activities proportionally to available time per day
  if (timeWindows && timeWindows.length > 0) {
    rebalanceByTimeCapacity(clusters, timeWindows, protectedIndices, paceFactor);

    // Remove empty clusters created by rebalancing
    for (let ci = clusters.length - 1; ci >= 0; ci--) {
      if (clusters[ci].activities.length === 0 && !protectedIndices.has(ci)) {
        clusters.splice(ci, 1);
      }
    }
    clusters.forEach((c, i) => { c.dayNumber = i + 1; });

    // Re-split if rebalancing reduced cluster count below numDays
    while (clusters.length < numDays) {
      let bestIdx = -1;
      let bestSize = 0;
      for (let ci = 0; ci < clusters.length; ci++) {
        if (protectedIndices.has(ci)) continue;
        if (clusters[ci].activities.length > bestSize) {
          bestSize = clusters[ci].activities.length;
          bestIdx = ci;
        }
      }
      if (bestIdx === -1 || bestSize < 4) break;
      const half = Math.ceil(bestSize / 2);
      const newCluster: ActivityCluster = {
        dayNumber: clusters.length + 1,
        activities: clusters[bestIdx].activities.splice(half),
        centroid: { lat: 0, lng: 0 },
        totalIntraDistance: 0,
      };
      recomputeCentroid(clusters[bestIdx]);
      recomputeCentroid(newCluster);
      clusters.push(newCluster);
      clusters.forEach((c, i) => { c.dayNumber = i + 1; });
      console.log(`[Cluster] Re-split after rebalance: Day ${bestIdx + 1} (${bestSize} acts) → 2 clusters (${clusters[bestIdx].activities.length} + ${newCluster.activities.length})`);
    }
  }

  // Optimize visit order within each cluster (nearest-neighbor + 2-opt)
  for (const cluster of clusters) {
    cluster.activities = optimizeVisitOrder(cluster.activities);
  }

  // Reorder clusters by geographic proximity (nearest-neighbor from city center)
  // Also handles day-trip cluster placement (middle of the trip)
  reorderClustersByProximity(clusters, cityCenter, dayTripClusterIdx);

  // Renumber days after reordering
  clusters.forEach((c, i) => { c.dayNumber = i + 1; });

  // Handle day-of-week closures if startDate is provided
  if (startDate) {
    handleDayClosures(clusters, startDate, numDays);
  }

  // Inter-cluster swap optimization (2-opt between days)
  interClusterSwap(clusters);

  // Type diversity pass: swap out excess same-type activities between clusters
  // Prevents days like "3 basilicas" by distributing same-type activities across days
  diversifyClusterTypes(clusters, protectedIndices, timeWindows);

  // Log cluster quality metrics
  for (const c of clusters) {
    const radius = c.activities.length > 0
      ? Math.max(...c.activities.map(a =>
          calculateDistance(a.latitude, a.longitude, c.centroid.lat, c.centroid.lng)))
      : 0;
    c.maxRadius = radius;
    console.log(`[Pipeline V2] Cluster Day ${c.dayNumber}: ${c.activities.length} activities, radius=${radius.toFixed(2)}km, intraDistance=${c.totalIntraDistance.toFixed(2)}km`);
  }

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
  K: number,
  maxClusterRadius?: number,
  hardRadiusCap: number = 5.0
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
  const clusterMembers: number[][] = activities.map((_, i) => [i]);

  // 3. Agglomerate until K clusters (with radius constraint)
  while (clusterMembers.length > K) {
    // Find the two closest clusters (average-linkage) that respect radius constraint
    let bestI = -1, bestJ = -1;
    let bestDist = Infinity;

    for (let i = 0; i < clusterMembers.length; i++) {
      for (let j = i + 1; j < clusterMembers.length; j++) {
        const d = averageLinkageDistance(clusterMembers[i], clusterMembers[j], distMatrix);
        if (d < bestDist) {
          // Check time-capacity constraint: merged cluster should fit in a day
          const mergedMembers = [...clusterMembers[i], ...clusterMembers[j]];
          const mergedDuration = mergedMembers.reduce((s, idx) => s + (activities[idx].duration || 60), 0);
          const estimatedTravel = (mergedMembers.length - 1) * 15; // 15min per activity transition
          const dayCapacityMinutes = 10 * 60; // 10h of activities per day max

          if (mergedDuration + estimatedTravel > dayCapacityMinutes) continue; // Reject merge: too much content

          // Check radius constraint: softer than before, with adaptive hard cap
          if (maxClusterRadius !== undefined) {
            const mergedRadius = computeMergedRadius(mergedMembers, activities);
            // Soft radius: allow merge up to 2.5x maxClusterRadius, hard cap is adaptive
            // (5km for compact cities like Paris/Rome, up to 15km for spread cities like Tokyo/LA)
            if (mergedRadius > maxClusterRadius * 2.5 || mergedRadius > hardRadiusCap) continue;
          }
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // No valid merge found within radius constraint — stop early
    if (bestI === -1 || bestJ === -1) break;

    // Merge cluster[bestJ] into cluster[bestI]
    clusterMembers[bestI] = [...clusterMembers[bestI], ...clusterMembers[bestJ]];
    clusterMembers.splice(bestJ, 1);
  }

  // Soft-constraint fallback: if we have too many clusters (> K), do a second pass
  // with relaxed radius (1.5x) to try to reach K clusters
  if (maxClusterRadius !== undefined && clusterMembers.length > K) {
    const relaxedRadius = maxClusterRadius * 1.5;
    console.log(`[Pipeline V2] Radius-constrained clustering produced ${clusterMembers.length} clusters (target ${K}), running soft pass with ${relaxedRadius.toFixed(2)}km`);

    while (clusterMembers.length > K) {
      let bestI = -1, bestJ = -1;
      let bestDist = Infinity;

      for (let i = 0; i < clusterMembers.length; i++) {
        for (let j = i + 1; j < clusterMembers.length; j++) {
          const d = averageLinkageDistance(clusterMembers[i], clusterMembers[j], distMatrix);
          if (d < bestDist) {
            const mergedRadius = computeMergedRadius(
              [...clusterMembers[i], ...clusterMembers[j]], activities
            );
            if (mergedRadius > relaxedRadius) continue;
            bestDist = d;
            bestI = i;
            bestJ = j;
          }
        }
      }

      if (bestI === -1 || bestJ === -1) break; // Even relaxed constraint fails
      clusterMembers[bestI] = [...clusterMembers[bestI], ...clusterMembers[bestJ]];
      clusterMembers.splice(bestJ, 1);
    }
  }

  // Last resort: if still > K clusters, merge smallest-first (to avoid monster clusters)
  // With time-capacity safeguard: never create a cluster > 8 hours (480min)
  while (clusterMembers.length > K) {
    // Sort cluster indices by size ascending, try to merge the two smallest
    const sizeIndices = clusterMembers
      .map((members, idx) => ({ idx, size: members.length, duration: members.reduce((s, i) => s + (activities[i].duration || 60), 0) }))
      .sort((a, b) => a.size - b.size);

    let merged = false;
    // Try to merge the smallest cluster with its nearest neighbor that fits capacity
    for (let si = 0; si < sizeIndices.length && !merged; si++) {
      const smallIdx = sizeIndices[si].idx;
      let bestTarget = -1;
      let bestDist = Infinity;

      for (let j = 0; j < clusterMembers.length; j++) {
        if (j === smallIdx) continue;
        const d = averageLinkageDistance(clusterMembers[smallIdx], clusterMembers[j], distMatrix);
        const mergedDuration = [...clusterMembers[smallIdx], ...clusterMembers[j]]
          .reduce((s, idx) => s + (activities[idx].duration || 60), 0);
        const estimatedTravel = (clusterMembers[smallIdx].length + clusterMembers[j].length - 1) * 15;
        // Allow up to 8h (480min) total activity time + travel
        if (mergedDuration + estimatedTravel > 8 * 60) continue;
        if (d < bestDist) {
          bestDist = d;
          bestTarget = j;
        }
      }

      if (bestTarget !== -1) {
        clusterMembers[bestTarget] = [...clusterMembers[bestTarget], ...clusterMembers[smallIdx]];
        clusterMembers.splice(smallIdx, 1);
        merged = true;
      }
    }

    // If no merge was possible with capacity constraint, do one unconditional merge (absolute last resort)
    if (!merged) {
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
      clusterMembers[bestI] = [...clusterMembers[bestI], ...clusterMembers[bestJ]];
      clusterMembers.splice(bestJ, 1);
    }
  }

  // 4. Build ActivityCluster[] from result
  return clusterMembers.map((memberIndices, idx) => {
    const members = memberIndices.map(i => activities[i]);
    return buildCluster(idx + 1, members);
  });
}

/**
 * Compute the radius of a merged cluster (max distance from centroid to any member).
 */
function computeMergedRadius(memberIndices: number[], activities: ScoredActivity[]): number {
  if (memberIndices.length <= 1) return 0;
  const centroidLat = memberIndices.reduce((s, i) => s + activities[i].latitude, 0) / memberIndices.length;
  const centroidLng = memberIndices.reduce((s, i) => s + activities[i].longitude, 0) / memberIndices.length;
  let maxDist = 0;
  for (const i of memberIndices) {
    const d = calculateDistance(activities[i].latitude, activities[i].longitude, centroidLat, centroidLng);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
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
  _dayTripClusterIdx: number
): void {
  if (clusters.length <= 2) return;

  // Separate ALL day-trip and full-day clusters — they get placed on non-boundary days later
  const dayTripClusters: ActivityCluster[] = [];
  const cityClusterIndices: number[] = [];
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].isDayTrip) {
      dayTripClusters.push(clusters[i]);
    } else {
      cityClusterIndices.push(i);
    }
  }

  if (cityClusterIndices.length <= 1 && dayTripClusters.length === 0) return;

  // Nearest-neighbor ordering on city clusters from startCoords
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

  // Rebuild with city clusters in proximity order
  const reordered: ActivityCluster[] = order.map(i => clusters[i]);

  // Insert day-trip clusters on non-boundary positions (never first or last day).
  // Distribute evenly across middle days.
  for (let dt = 0; dt < dayTripClusters.length; dt++) {
    if (reordered.length <= 1) {
      // Only 1 city day — insert day trips after it
      reordered.push(dayTripClusters[dt]);
    } else {
      // Place at evenly spaced middle positions (avoid index 0 and last)
      const spacing = Math.floor(reordered.length / (dayTripClusters.length + 1));
      const insertIdx = Math.max(1, Math.min(reordered.length - 1, spacing * (dt + 1)));
      reordered.splice(insertIdx, 0, dayTripClusters[dt]);
    }
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
function balanceClusterSizes(
  clusters: ActivityCluster[],
  maxPerCluster: number,
  dayTripClusterIdx: number = -1,
  maxClusterRadius?: number,
  protectedIndices?: Set<number>
): void {
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 10) {
    changed = false;
    iterations++;

    for (let ci = 0; ci < clusters.length; ci++) {
      // Skip protected clusters (full-day, day-trip) — they should not donate or receive
      if (protectedIndices?.has(ci)) continue;

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

        const activityToMove = cluster.activities[farthestIdx];

        // Find the smallest cluster to receive it
        // Never move city activities INTO protected clusters (day-trip, full-day)
        // With radius constraint: only move if the activity is within radius of the target cluster
        const candidates = clusters
          .filter((c, idx) => c !== cluster && !protectedIndices?.has(idx))
          .filter(c => {
            if (!maxClusterRadius || !activityToMove) return true;
            const distToTarget = calculateDistance(
              activityToMove.latitude, activityToMove.longitude,
              c.centroid.lat, c.centroid.lng
            );
            return distToTarget <= maxClusterRadius * 1.2;
          })
          .sort((a, b) => a.activities.length - b.activities.length);

        const smallest = candidates[0];
        if (!smallest) break; // No valid target within radius — stop

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

  // Second pass: forced redistribution for severely unbalanced clusters
  // If any cluster has more than avg+2 (or 7, whichever is larger), force-move to smallest (ignore radius)
  const totalActivities = clusters.reduce((s, c) => s + c.activities.length, 0);
  const avgSize = Math.round(totalActivities / clusters.length);
  const hardMax = Math.max(avgSize + 2, 7); // Never more than avg+2 or 7, whichever is larger

  for (let pass = 0; pass < 5; pass++) {
    let didMove = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      // Skip protected clusters
      if (protectedIndices?.has(ci)) continue;
      const cluster = clusters[ci];

      while (cluster.activities.length > hardMax) {
        // Find farthest non-must-see activity from centroid
        let farthestIdx = -1;
        let farthestDist = 0;
        for (let i = 0; i < cluster.activities.length; i++) {
          if (cluster.activities[i].mustSee) continue;
          const d = calculateDistance(
            cluster.activities[i].latitude, cluster.activities[i].longitude,
            cluster.centroid.lat, cluster.centroid.lng
          );
          if (d > farthestDist) {
            farthestDist = d;
            farthestIdx = i;
          }
        }
        if (farthestIdx === -1) break; // Only must-sees left

        // Find smallest non-protected cluster (ignore radius constraint)
        const target = clusters
          .filter((c, idx) => c !== cluster && !protectedIndices?.has(idx))
          .sort((a, b) => a.activities.length - b.activities.length)[0];

        if (!target || target.activities.length >= hardMax) break;

        const [moved] = cluster.activities.splice(farthestIdx, 1);
        target.activities.push(moved);
        recomputeCentroid(cluster);
        recomputeCentroid(target);
        didMove = true;

        console.log(
          `[Pipeline V2] balanceClusterSizes forced redistribution: moved "${moved.name}" from cluster with ${cluster.activities.length + 1} → ${cluster.activities.length} activities to cluster with ${target.activities.length} activities`
        );
      }
    }
    if (!didMove) break;
  }
}

/**
 * Enforce minimum cluster size: ensure no full day has fewer than `minPerCluster` activities.
 * Boundary days (first and last) are exempted (min=1).
 * Steals from the largest donor cluster, picking the activity closest to the target's centroid.
 */
function enforceMinimumClusterSize(
  clusters: ActivityCluster[],
  minPerCluster: number,
  dayTripClusterIdx: number,
  numDays: number,
  protectedIndices?: Set<number>
): void {
  const MAX_ITERATIONS = 30;
  let iterations = 0;

  while (iterations++ < MAX_ITERATIONS) {
    let madeProgress = false;

    for (let ci = 0; ci < clusters.length; ci++) {
      // Skip protected clusters (day-trip, full-day) — they have their own size rules
      if (protectedIndices?.has(ci)) continue;

      // Boundary days get a relaxed minimum: first day = 1, last day = 2 (at least some activities before departure)
      const isFirstDay = clusters[ci].dayNumber === 1;
      const isLastDay = clusters[ci].dayNumber === numDays;
      const effectiveMin = isFirstDay ? 1 : isLastDay ? Math.min(2, minPerCluster) : minPerCluster;

      if (clusters[ci].activities.length >= effectiveMin) continue;

      const deficit = effectiveMin - clusters[ci].activities.length;

      for (let d = 0; d < deficit; d++) {
        // Find the largest donor cluster (excluding protected and target)
        // Donor must keep at least effectiveMin+1 activities after donation
        let donorIdx = -1;
        let donorSize = 0;
        for (let di = 0; di < clusters.length; di++) {
          if (di === ci || protectedIndices?.has(di)) continue;
          const diIsBoundary = clusters[di].dayNumber === 1 || clusters[di].dayNumber === numDays;
          const diMin = diIsBoundary ? 1 : minPerCluster;
          // Donor must retain at least diMin + 1 activities (so it stays above minimum after giving)
          if (clusters[di].activities.length > diMin && clusters[di].activities.length > donorSize) {
            donorSize = clusters[di].activities.length;
            donorIdx = di;
          }
        }

        if (donorIdx === -1) break; // No valid donor found

        // Among non-must-see activities in the donor, pick the one closest to target centroid
        const targetCentroid = clusters[ci].centroid;
        let bestMoveIdx = -1;
        let bestMoveDist = Infinity;

        for (let ai = 0; ai < clusters[donorIdx].activities.length; ai++) {
          const a = clusters[donorIdx].activities[ai];
          if (a.mustSee) continue; // Never steal must-sees
          const dist = calculateDistance(a.latitude, a.longitude, targetCentroid.lat, targetCentroid.lng);
          if (dist < bestMoveDist) {
            bestMoveDist = dist;
            bestMoveIdx = ai;
          }
        }

        // If no non-must-see found, try must-sees as last resort (only if donor has many)
        if (bestMoveIdx === -1 && clusters[donorIdx].activities.length > minPerCluster + 2) {
          for (let ai = 0; ai < clusters[donorIdx].activities.length; ai++) {
            const a = clusters[donorIdx].activities[ai];
            const dist = calculateDistance(a.latitude, a.longitude, targetCentroid.lat, targetCentroid.lng);
            if (dist < bestMoveDist) {
              bestMoveDist = dist;
              bestMoveIdx = ai;
            }
          }
        }

        if (bestMoveIdx === -1) break; // Nothing to move

        const [moved] = clusters[donorIdx].activities.splice(bestMoveIdx, 1);
        clusters[ci].activities.push(moved);
        recomputeCentroid(clusters[ci]);
        recomputeCentroid(clusters[donorIdx]);
        madeProgress = true;

        console.log(
          `[Pipeline V2] enforceMinimumClusterSize: moved "${moved.name}" from Day ${clusters[donorIdx].dayNumber} (${clusters[donorIdx].activities.length} left) → Day ${clusters[ci].dayNumber} (${clusters[ci].activities.length} now), dist=${bestMoveDist.toFixed(2)}km`
        );
      }
    }

    if (!madeProgress) break;
  }
}

/**
 * Proactive closure avoidance: move activities closed on their assigned day
 * to other clusters where they're open.
 */
function handleDayClosures(
  clusters: ActivityCluster[],
  startDate: string,
  durationDays: number
): void {
  for (const cluster of clusters) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + cluster.dayNumber - 1);

    const closedActivities: ScoredActivity[] = [];
    cluster.activities = cluster.activities.filter(act => {
      if (!isActivityOpenOnDay(act, dayDate)) {
        console.log(`[Cluster] "${act.name}" closed on Day ${cluster.dayNumber} (${DAY_NAMES_EN[dayDate.getDay()]}) — will try to swap`);
        closedActivities.push(act);
        return false;
      }
      return true;
    });

    // Try to place closed activities in other clusters where they're open
    for (const closedAct of closedActivities) {
      let placed = false;
      for (const otherCluster of clusters) {
        if (otherCluster === cluster) continue;
        const otherDate = new Date(startDate);
        otherDate.setDate(otherDate.getDate() + otherCluster.dayNumber - 1);
        if (isActivityOpenOnDay(closedAct, otherDate)) {
          otherCluster.activities.push(closedAct);
          placed = true;
          console.log(`[Cluster] Moved "${closedAct.name}" to Day ${otherCluster.dayNumber}`);
          break;
        }
      }
      if (!placed && closedAct.mustSee) {
        // Must-see that can't be placed — put it back and log warning
        cluster.activities.push(closedAct);
        console.warn(`[Cluster] WARNING: Must-see "${closedAct.name}" closed on Day ${cluster.dayNumber} but no alternative day found`);
      }
    }

    // Recompute centroid after moving activities
    if (cluster.activities.length > 0) {
      recomputeCentroid(cluster);
    }
  }
}

/**
 * Type diversity: if a cluster has >2 activities of the same type (e.g. 3 churches),
 * try to swap the excess with a different-type activity from another cluster.
 * This prevents monotonous days like "visit 3 basilicas".
 */
function diversifyClusterTypes(
  clusters: ActivityCluster[],
  protectedIndices: Set<number>,
  timeWindows?: Array<{ dayNumber: number; activityStartTime: string; activityEndTime: string; hasDepartureTransport?: boolean }>
): void {
  const MAX_SAME_TYPE = 2;

  for (let ci = 0; ci < clusters.length; ci++) {
    if (protectedIndices.has(ci)) continue;
    const cluster = clusters[ci];

    // Count activities by type
    const typeCounts = new Map<string, number>();
    for (const act of cluster.activities) {
      typeCounts.set(act.type, (typeCounts.get(act.type) || 0) + 1);
    }

    for (const [type, count] of typeCounts) {
      if (count <= MAX_SAME_TYPE) continue;

      // Find excess non-must-see activities of this type (keep the highest-scored ones)
      const sameTypeActs = cluster.activities
        .filter(a => a.type === type && !a.mustSee)
        .sort((a, b) => a.score - b.score); // lowest score first = candidates to swap out

      const toSwap = Math.min(sameTypeActs.length, count - MAX_SAME_TYPE);

      for (let s = 0; s < toSwap; s++) {
        const candidate = sameTypeActs[s];

        // Find a target cluster that:
        // 1. Is not protected
        // 2. Has fewer of this type
        // 3. Has an activity of a DIFFERENT type we can swap in
        let bestSwap: { targetIdx: number; targetActIdx: number; distance: number } | null = null;

        for (let ti = 0; ti < clusters.length; ti++) {
          if (ti === ci || protectedIndices.has(ti)) continue;
          const target = clusters[ti];

          const targetTypeCount = target.activities.filter(a => a.type === type).length;
          if (targetTypeCount >= MAX_SAME_TYPE) continue; // target already has enough of this type

          // Find a non-must-see activity in target that is a DIFFERENT type
          for (let ai = 0; ai < target.activities.length; ai++) {
            const tAct = target.activities[ai];
            if (tAct.mustSee) continue;
            if (tAct.type === type) continue; // same type, no improvement
            // Check the incoming activity wouldn't make OUR cluster lose diversity
            const ourTypeCountOfIncoming = cluster.activities.filter(a => a.type === tAct.type).length;
            if (ourTypeCountOfIncoming >= MAX_SAME_TYPE) continue;

            // Prefer swaps with nearby activities (don't blow up geographic clusters)
            const dist = calculateDistance(candidate.latitude, candidate.longitude, tAct.latitude, tAct.longitude);
            if (!bestSwap || dist < bestSwap.distance) {
              bestSwap = { targetIdx: ti, targetActIdx: ai, distance: dist };
            }
          }
        }

        if (bestSwap && bestSwap.distance < 10) { // only swap if within 10km
          const candIdx = cluster.activities.indexOf(candidate);
          const swappedIn = clusters[bestSwap.targetIdx].activities[bestSwap.targetActIdx];
          cluster.activities[candIdx] = swappedIn;
          clusters[bestSwap.targetIdx].activities[bestSwap.targetActIdx] = candidate;
          recomputeCentroid(cluster);
          recomputeCentroid(clusters[bestSwap.targetIdx]);
          console.log(`[Pipeline V3] Type diversity: swapped "${candidate.name}" (${type}) from Day ${cluster.dayNumber} ↔ "${swappedIn.name}" (${swappedIn.type}) from Day ${clusters[bestSwap.targetIdx].dayNumber}`);
        }
      }
    }
  }

  // Second pass: spread must-see museums across days (max 1 must-see museum per day)
  if (clusters.length >= 2) {
    const isMajorMuseum = (a: ScoredActivity) =>
      ((a.type as string) === 'museum' || a.type === 'culture') && (a.duration || 60) >= 90;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (protectedIndices.has(ci)) continue;
      const cluster = clusters[ci];

      const mustSeeMuseums = cluster.activities
        .filter(a => isMajorMuseum(a) && a.mustSee)
        .sort((a, b) => a.score - b.score); // lowest score = candidate to move

      if (mustSeeMuseums.length <= 1) continue;

      const candidate = mustSeeMuseums[0];

      // Find the cluster with the fewest must-see museums whose time window
      // can actually host a museum visit (needs morning hours, start before 12:00)
      const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

      let bestTarget = -1;
      let bestTargetCount = mustSeeMuseums.length;
      let bestDist = Infinity;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || protectedIndices.has(ti)) continue;

        // Skip days where the window starts too late for a museum visit
        if (timeWindows) {
          const tw = timeWindows.find(w => w.dayNumber === clusters[ti].dayNumber);
          if (tw && toMin(tw.activityStartTime) >= 12 * 60) continue;
        }

        const targetMustSeeMuseums = clusters[ti].activities.filter(a => isMajorMuseum(a) && a.mustSee).length;
        if (targetMustSeeMuseums >= bestTargetCount) continue;

        const centroid = clusters[ti].centroid;
        if (!centroid || (centroid.lat === 0 && centroid.lng === 0)) continue;
        const dist = calculateDistance(candidate.latitude, candidate.longitude, centroid.lat, centroid.lng);
        if (targetMustSeeMuseums < bestTargetCount || dist < bestDist) {
          bestTargetCount = targetMustSeeMuseums;
          bestDist = dist;
          bestTarget = ti;
        }
      }

      if (bestTarget !== -1 && bestDist < 15) {
        const candIdx = cluster.activities.indexOf(candidate);
        cluster.activities.splice(candIdx, 1);
        clusters[bestTarget].activities.push(candidate);
        recomputeCentroid(cluster);
        recomputeCentroid(clusters[bestTarget]);
        console.log(`[Pipeline V3] Museum diversity: moved must-see "${candidate.name}" from Day ${cluster.dayNumber} → Day ${clusters[bestTarget].dayNumber} (${bestDist.toFixed(1)}km)`);
      }
    }
  }
}

/**
 * Inter-cluster 2-opt: try swapping non-must-see activities between days
 * to reduce total intra-cluster distance.
 */
function interClusterSwap(clusters: ActivityCluster[]): void {
  const routeCost = (cluster: ActivityCluster): number => {
    let cost = 0;
    for (let i = 1; i < cluster.activities.length; i++) {
      cost += calculateDistance(
        cluster.activities[i - 1].latitude,
        cluster.activities[i - 1].longitude,
        cluster.activities[i].latitude,
        cluster.activities[i].longitude
      );
    }
    return cost;
  };

  let improvements = 0;
  const MAX_PASSES = 5;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let passImprovements = 0;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        // Rebuild swappable lists fresh each pair to avoid stale references
        let madeSwap = true;
        while (madeSwap) {
          madeSwap = false;
          const swappableA = clusters[i].activities.filter(a => !a.mustSee);
          const swappableB = clusters[j].activities.filter(a => !a.mustSee);

          for (const actA of swappableA) {
            if (madeSwap) break;
            for (const actB of swappableB) {
              if (madeSwap) break;
              const idxA = clusters[i].activities.indexOf(actA);
              const idxB = clusters[j].activities.indexOf(actB);
              if (idxA === -1 || idxB === -1) continue; // Safety check

              const costBefore = routeCost(clusters[i]) + routeCost(clusters[j]);

              // Swap
              clusters[i].activities[idxA] = actB;
              clusters[j].activities[idxB] = actA;

              const costAfter = routeCost(clusters[i]) + routeCost(clusters[j]);

              if (costAfter < costBefore - 0.1) {
                passImprovements++;
                madeSwap = true; // Restart with fresh swappable lists
              } else {
                // Revert
                clusters[i].activities[idxA] = actA;
                clusters[j].activities[idxB] = actB;
              }
            }
          }
        }
      }
    }

    improvements += passImprovements;
    if (passImprovements === 0) break; // No more improvements possible
  }

  if (improvements > 0) {
    console.log(`[Cluster] Inter-cluster swap: ${improvements} improvements`);
    // Recalculate centroids after swaps
    for (const cluster of clusters) {
      if (cluster.activities.length > 0) {
        cluster.centroid = {
          lat: cluster.activities.reduce((s, a) => s + a.latitude, 0) / cluster.activities.length,
          lng: cluster.activities.reduce((s, a) => s + a.longitude, 0) / cluster.activities.length,
        };
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

/**
 * Rebalance clusters so activity count is proportional to available time per day.
 * Full days (10h) get more activities than compressed boundary days (4-6h).
 */
function rebalanceByTimeCapacity(
  clusters: ActivityCluster[],
  timeWindows: Array<{ dayNumber: number; activityStartTime: string; activityEndTime: string; hasDepartureTransport?: boolean }>,
  protectedIndices: Set<number>,
  paceFactor?: number
): void {
  // Parse time "HH:MM" to minutes
  const toMin = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  // Compute capacity for each cluster in minutes (available time minus meal overhead)
  const FULL_DAY_MEAL_OVERHEAD = 195; // breakfast 60 + lunch 90 + dinner-buffer 45
  const AVG_ACTIVITY_SLOT = 90; // 60min activity + 15min travel + 15min buffer

  const capacities = clusters.map((c) => {
    const tw = timeWindows.find(w => w.dayNumber === c.dayNumber);
    if (!tw) return 600; // default 10h
    const availableMin = toMin(tw.activityEndTime) - toMin(tw.activityStartTime);
    // Departure days need less meal overhead (no lunch/dinner if leaving early)
    let mealOverhead = FULL_DAY_MEAL_OVERHEAD;
    if (tw.hasDepartureTransport) {
      const endMin = toMin(tw.activityEndTime);
      mealOverhead = endMin < 12 * 60 ? 0     // matin: hotel breakfast only
                   : endMin < 15 * 60 ? 90    // début aprèm: + lunch
                   : 135;                      // aprèm: + lunch + dinner buffer
    }
    return Math.max(0, availableMin - mealOverhead);
  });

  // Target activity count per cluster = proportional to capacity, adjusted by pace
  const totalCapacity = capacities.reduce((s, c) => s + c, 0);
  const totalActivities = clusters.reduce((s, c) => s + (protectedIndices.has(clusters.indexOf(c)) ? 0 : c.activities.length), 0);
  const factor = paceFactor ?? 1.0;

  const targets = capacities.map((cap, i) => {
    if (protectedIndices.has(i)) return clusters[i].activities.length; // Don't touch protected
    const raw = totalCapacity > 0 ? (cap / totalCapacity) * totalActivities * factor : 0;
    return Math.max(1, Math.round(raw)); // At least 1 activity per day
  });

  // Iterative rebalancing: move activities from over-target clusters to under-target
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (protectedIndices.has(ci)) continue;
      const excess = clusters[ci].activities.length - targets[ci];
      if (excess <= 0) continue;

      // Find the most under-target cluster
      let bestTarget = -1;
      let bestDeficit = 0;
      for (let ti = 0; ti < clusters.length; ti++) {
        if (ti === ci || protectedIndices.has(ti)) continue;
        const deficit = targets[ti] - clusters[ti].activities.length;
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          bestTarget = ti;
        }
      }
      if (bestTarget === -1) continue;

      // Move the lowest-scored non-must-see activity
      let worstIdx = -1;
      let worstScore = Infinity;
      for (let ai = 0; ai < clusters[ci].activities.length; ai++) {
        if (clusters[ci].activities[ai].mustSee) continue;
        if (clusters[ci].activities[ai].score < worstScore) {
          worstScore = clusters[ci].activities[ai].score;
          worstIdx = ai;
        }
      }
      if (worstIdx === -1) continue;

      const [act] = clusters[ci].activities.splice(worstIdx, 1);
      clusters[bestTarget].activities.push(act);
      recomputeCentroid(clusters[ci]);
      recomputeCentroid(clusters[bestTarget]);
      console.log(`[Pipeline V3] Time rebalance: moved "${act.name}" from Day ${clusters[ci].dayNumber} (${clusters[ci].activities.length} acts, ${capacities[ci]}min) → Day ${clusters[bestTarget].dayNumber} (${clusters[bestTarget].activities.length} acts, ${capacities[bestTarget]}min)`);
      moved = true;
    }
    if (!moved) break;
  }
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
