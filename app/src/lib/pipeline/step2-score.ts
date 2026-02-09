/**
 * Pipeline V2 — Step 2: Score & Select Activities
 *
 * Pure function, zero API calls.
 * Merges multi-source activities, deduplicates, scores by popularity, selects the right count.
 */

import type { TripPreferences } from '../types';
import type { Attraction } from '../services/attractions';
import type { FetchedData, ScoredActivity } from './types';
import { deduplicateByProximity, isIrrelevantAttraction } from './utils/dedup';
import { fixAttractionDuration, fixAttractionCost } from '../tripAttractions';

export function scoreAndSelectActivities(
  data: FetchedData,
  preferences: TripPreferences
): ScoredActivity[] {
  // 1. Merge all sources with source tagging
  const allActivities: ScoredActivity[] = [
    // Must-sees first (highest priority)
    ...data.mustSeeAttractions.map(a => tagActivity(a, 'mustsee')),
    // Google Places (best popularity data)
    ...data.googlePlacesAttractions.map(a => tagActivity(a, 'google_places')),
    // SerpAPI (GPS + ratings)
    ...data.serpApiAttractions.map(a => tagActivity(a, 'serpapi')),
    // Overpass (free, GPS, no ratings)
    ...data.overpassAttractions.map(a => tagActivity(a, 'overpass')),
    // Viator (bookable experiences)
    ...data.viatorActivities.map(a => tagActivity(a, 'viator')),
  ];

  // 2. Filter activities without valid GPS
  const withGPS = allActivities.filter(
    a => a.latitude && a.longitude && a.latitude !== 0 && a.longitude !== 0
  );

  // 3. Deduplicate by proximity (100m)
  const deduped = deduplicateByProximity(withGPS, 0.1);

  // 4. Filter irrelevant types
  const filtered = deduped.filter(a => !isIrrelevantAttraction(a));

  // 5. Score each activity
  const scored = filtered.map(a => ({
    ...a,
    score: computeScore(a, preferences),
  }));

  // 6. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 7. Select the right count (4 per day + 2 extra buffer)
  const targetCount = Math.max(preferences.durationDays * 4 + 2, 6);

  // 8. Fix durations and costs using existing utilities
  return scored
    .slice(0, targetCount)
    .map(a => fixAttractionCost(fixAttractionDuration(a)) as ScoredActivity);
}

function tagActivity(
  a: Attraction,
  source: ScoredActivity['source']
): ScoredActivity {
  return {
    ...a,
    score: 0,
    source,
    reviewCount: (a as any).reviewCount || (a as any).reviews || 0,
  };
}

function computeScore(
  activity: ScoredActivity,
  preferences: TripPreferences
): number {
  // Must-see = always first
  const mustSeeBonus = activity.mustSee ? 100 : 0;

  // Popularity: log10 of review count (0-10 scale)
  const reviews = Math.max(activity.reviewCount || 1, 1);
  const popularityScore = Math.log10(reviews) * 2; // 1 review = 0, 10K = 8, 50K = 9.4

  // Rating: 0-10 scale
  const ratingScore = (activity.rating || 3) * 2;

  // Type match: bonus if activity type matches user preferences
  const activityType = (activity.type || '').toLowerCase();
  const typeMatchBonus = (preferences.activities || []).some(pref => {
    if (pref === 'culture') return ['museum', 'gallery', 'monument', 'historic', 'church', 'palace', 'castle', 'temple', 'cultural'].some(t => activityType.includes(t));
    if (pref === 'nature') return ['park', 'garden', 'nature', 'viewpoint', 'mountain', 'lake', 'beach', 'trail'].some(t => activityType.includes(t));
    if (pref === 'adventure') return ['adventure', 'sport', 'outdoor', 'hiking', 'diving', 'climbing'].some(t => activityType.includes(t));
    if (pref === 'shopping') return ['market', 'shopping', 'bazaar', 'souk'].some(t => activityType.includes(t));
    if (pref === 'gastronomy') return ['food_tour', 'cooking_class', 'wine', 'tasting'].some(t => activityType.includes(t));
    if (pref === 'nightlife') return ['nightlife', 'club', 'bar', 'show', 'entertainment'].some(t => activityType.includes(t));
    if (pref === 'wellness') return ['spa', 'hammam', 'wellness', 'yoga', 'thermal'].some(t => activityType.includes(t));
    if (pref === 'beach') return ['beach', 'coast', 'seaside', 'water_park'].some(t => activityType.includes(t));
    return activityType.includes(pref);
  }) ? 3 : 0;

  // Viator bonus (bookable = more actionable)
  const viatorBonus = activity.source === 'viator' ? 0.5 : 0;

  // Data quality bonus (verified > estimated > generated)
  const reliabilityBonus = activity.dataReliability === 'verified' ? 1 : 0;

  return mustSeeBonus + popularityScore + ratingScore + typeMatchBonus + viatorBonus + reliabilityBonus;
}
