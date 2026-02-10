/**
 * Pipeline V2 — Step 2: Score & Select Activities
 *
 * Pure function, zero API calls.
 * Merges multi-source activities, deduplicates, scores by popularity, selects the right count.
 */

import type { TripPreferences, GroupType, ActivityType } from '../types';
import type { Attraction } from '../services/attractions';
import type { FetchedData, ScoredActivity } from './types';
import { deduplicateByProximity, isIrrelevantAttraction } from './utils/dedup';
import { fixAttractionDuration, fixAttractionCost } from '../tripAttractions';
import { findKnownViatorProduct } from '../services/viatorKnownProducts';
import { calculateDistance } from '../services/geocoding';

// ─── Contextual scoring dictionaries ────────────────────────────────────────

/** Tags inferred from activity name + description to characterize the experience */
type ProfileTag = 'kid_friendly' | 'romantic' | 'party' | 'adult_only' | 'instagram'
  | 'deep_culture' | 'active' | 'relaxing' | 'foodie';

/** Keywords that indicate each profile tag */
const PROFILE_KEYWORDS: Record<ProfileTag, string[]> = {
  kid_friendly: [
    'kids', 'children', 'family', 'playground', 'interactive', 'fun',
    'aquarium', 'zoo', 'theme park', 'amusement', 'legoland', 'trampoline',
    'nemo', 'science center', 'artis',
  ],
  romantic: [
    'cruise', 'croisière', 'sunset', 'candlelight', 'wine', 'rooftop',
    'spa', 'hammam', 'gondola', 'romantic',
  ],
  party: [
    'pub crawl', 'bar crawl', 'nightlife', 'club', 'party', 'karaoke',
    'cocktail', 'beer', 'brewery', 'bar hop',
  ],
  adult_only: [
    'red light', 'coffee shop', 'coffeeshop', 'cannabis', 'sex museum',
    'erotic', 'strip',
  ],
  instagram: [
    'selfie', 'instagram', 'instagrammable', 'immersive', 'experience museum',
    'upside down', 'illusions', 'wondr', 'pop-up',
  ],
  deep_culture: [
    'museum', 'musée', 'gallery', 'galerie', 'archaeological', 'heritage',
    'historical', 'monument', 'cathedral', 'basilica', 'palace', 'palais',
    'castle', 'château',
  ],
  active: [
    'bike', 'vélo', 'cycling', 'hike', 'randonnée', 'kayak', 'climbing',
    'surfing', 'diving', 'segway', 'zip line',
  ],
  relaxing: [
    'spa', 'hammam', 'wellness', 'massage', 'yoga', 'garden', 'jardin',
    'botanical', 'park', 'beach', 'plage',
  ],
  foodie: [
    'food tour', 'cooking class', 'tasting', 'dégustation', 'gastro',
    'culinary', 'street food', 'market tour',
  ],
};

/** Scoring matrix: groupType × profileTag → bonus/penalty
 *  Values are intentionally strong (up to ±6) so the contextual signal
 *  can overcome a high base score (popularity + rating ≈ 15-22).
 */
const CONTEXT_FIT_MATRIX: Record<GroupType, Record<ProfileTag, number>> = {
  family_with_kids: {
    kid_friendly: +5, romantic: -3, party: -5, adult_only: -6,
    instagram: +2, deep_culture: -1, active: +2, relaxing: +2, foodie: 0,
  },
  couple: {
    kid_friendly: -2, romantic: +5, party: 0, adult_only: 0,
    instagram: -2, deep_culture: +2, active: +2, relaxing: +3, foodie: +3,
  },
  friends: {
    kid_friendly: -3, romantic: -2, party: +5, adult_only: +2,
    instagram: +2, deep_culture: 0, active: +3, relaxing: 0, foodie: +3,
  },
  solo: {
    kid_friendly: -2, romantic: -3, party: 0, adult_only: 0,
    instagram: 0, deep_culture: +3, active: +2, relaxing: +2, foodie: +2,
  },
  family_without_kids: {
    kid_friendly: 0, romantic: +2, party: -2, adult_only: -5,
    instagram: 0, deep_culture: +3, active: +2, relaxing: +2, foodie: +3,
  },
};

/** Affinities: preference → tags that reinforce it (+2 each) */
const PREFERENCE_AFFINITIES: Partial<Record<ActivityType, ProfileTag[]>> = {
  culture: ['deep_culture'],
  nature: ['relaxing', 'active'],
  nightlife: ['party'],
  gastronomy: ['foodie'],
  wellness: ['relaxing'],
  adventure: ['active'],
};

/** Conflicts: preference → tags that contradict it (-2 each) */
const PREFERENCE_CONFLICTS: Partial<Record<ActivityType, ProfileTag[]>> = {
  culture: ['instagram', 'party'],
  nature: ['instagram', 'party'],
  adventure: ['relaxing', 'instagram'],
  nightlife: ['kid_friendly'],
};

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
  const cityCenter = data.destCoords;
  const scored = filtered.map(a => ({
    ...a,
    score: computeScore(a, preferences, cityCenter),
  }));

  // 6. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 7. Separate must-sees from regular activities
  const mustSees = scored.filter(a => a.mustSee);
  const nonMustSees = scored.filter(a => !a.mustSee);

  // 8. Select the right count
  // Arrival/departure days get fewer activities (~2 each), full days get ~4
  const fullDays = Math.max(0, preferences.durationDays - 2);
  const targetCount = Math.max(
    2 + 2 + fullDays * 4 + 2, // time-based estimate
    mustSees.length + fullDays * 3 + 2, // ensure must-sees + enough for full days
    preferences.durationDays * 3, // minimum 3 per day
    6 // absolute minimum
  );
  const remainingSlots = Math.max(0, targetCount - mustSees.length);
  const selected: ScoredActivity[] = [...mustSees, ...nonMustSees.slice(0, remainingSlots)];

  // 8b. Guarantee at least 1 Viator experiential activity (cruise, food tour, bike tour…)
  // Aligned with scoring keywords in computeScore() — same breadth
  const EXPERIENTIAL_KW = ['cruise', 'croisière', 'tour', 'visite guidée',
    'food', 'dégustation', 'tasting', 'cooking', 'bike', 'vélo', 'boat', 'bateau',
    'canal', 'workshop', 'atelier'];
  const isExperientialActivity = (a: ScoredActivity): boolean =>
    a.source === 'viator' && EXPERIENTIAL_KW.some(k => (a.name || '').toLowerCase().includes(k));

  if (!selected.some(isExperientialActivity)) {
    const bestExperiential = nonMustSees.find(a =>
      isExperientialActivity(a) && !selected.some(s => s.id === a.id)
    );
    if (bestExperiential) {
      selected.push(bestExperiential);
      console.log(`[Pipeline V2] Added guaranteed experiential: "${bestExperiential.name}"`);
    }
  }

  // 9. Fix durations, costs, and enrich with Viator known product data
  return selected.map(a => {
    let fixed = fixAttractionCost(fixAttractionDuration(a)) as ScoredActivity;

    // Enrich with known Viator product data (sync dictionary lookup)
    const viatorData = findKnownViatorProduct(fixed.name);
    if (viatorData) {
      // Booking URL
      if (!fixed.bookingUrl && viatorData.url) {
        fixed = { ...fixed, bookingUrl: viatorData.url };
      }
      // Duration: use known duration if available (more accurate than API/estimate)
      if (viatorData.duration && viatorData.duration !== fixed.duration) {
        fixed = { ...fixed, duration: viatorData.duration };
      }
      // Coords: replace city-center coords with real GPS for Viator activities
      if (viatorData.lat && viatorData.lng && fixed.dataReliability === 'estimated') {
        fixed = { ...fixed, latitude: viatorData.lat, longitude: viatorData.lng, dataReliability: 'verified' };
      }
      // Opening hours: use real hours instead of generic 09:00-18:00
      if (viatorData.openingHours) {
        fixed = { ...fixed, openingHours: viatorData.openingHours };
      }
    }

    return fixed;
  });
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
  preferences: TripPreferences,
  cityCenter: { lat: number; lng: number }
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

  // Viator bonus: experiences (cruises, food tours, guided tours) add variety
  // Higher bonus for experiential activities that aren't just monument visits
  let viatorBonus = 0;
  if (activity.source === 'viator') {
    viatorBonus = 2; // Base bonus for bookable experiences
    const expName = (activity.name || '').toLowerCase();
    const isExperiential = ['cruise', 'croisière', 'tour', 'visite guidée',
      'food', 'cooking', 'tasting', 'dégustation', 'bike', 'vélo',
      'boat', 'bateau', 'canal', 'workshop', 'atelier'].some(k => expName.includes(k));
    if (isExperiential) viatorBonus = 4; // Strong bonus for unique experiences
  }

  // Data quality bonus (verified > estimated > generated)
  const reliabilityBonus = activity.dataReliability === 'verified' ? 1 : 0;

  // Distance penalty: activities far from city center are penalized on short trips
  // >30km costs 2h+ of round-trip travel — not worth it for ≤3 day trips
  let distancePenalty = 0;
  if (activity.latitude && activity.longitude) {
    const distKm = calculateDistance(activity.latitude, activity.longitude, cityCenter.lat, cityCenter.lng);
    if (distKm > 30 && preferences.durationDays <= 3) {
      distancePenalty = -15; // Heavy penalty: makes it lose to any city attraction
    } else if (distKm > 30) {
      distancePenalty = -5; // Moderate penalty for longer trips
    }
  }

  // Factor 8: Context fit — score activity based on group type (family, couple, friends…)
  const tags = inferActivityTags(activity);
  const contextFitBonus = computeContextFit(tags, preferences.groupType);

  // Factor 9: Preference depth — reward tags that reinforce selected preferences, penalize contradictions
  const preferenceDepthBonus = computePreferenceDepth(tags, preferences.activities || []);

  return mustSeeBonus + popularityScore + ratingScore + typeMatchBonus + viatorBonus
    + reliabilityBonus + distancePenalty + contextFitBonus + preferenceDepthBonus;
}

// ─── Contextual scoring helpers ─────────────────────────────────────────────

/**
 * Infer profile tags from activity name, description, and type.
 * Returns the set of tags that matched at least one keyword.
 */
function inferActivityTags(activity: ScoredActivity): Set<ProfileTag> {
  const text = [
    activity.name || '',
    (activity as any).description || '',
    activity.type || '',
    (activity as any).cuisineType || '',
  ].join(' ').toLowerCase();

  const matched = new Set<ProfileTag>();
  for (const [tag, keywords] of Object.entries(PROFILE_KEYWORDS) as [ProfileTag, string[]][]) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.add(tag);
    }
  }

  // Disambiguate: if something is both deep_culture and instagram, keep both — the matrix handles it.
  // Exception: real museums (Rijksmuseum, Van Gogh) should NOT get instagram tag just because "museum" is in both
  // deep_culture keywords and the name. Only add instagram if it has explicit instagram keywords.
  // (This is already handled by the keyword lists — "museum" is in deep_culture, not instagram.)

  return matched;
}

/**
 * Factor 8: Context fit bonus.
 * Sum the matrix scores for each matched tag, clamped to [-6, +6].
 */
function computeContextFit(tags: Set<ProfileTag>, groupType: GroupType): number {
  const matrix = CONTEXT_FIT_MATRIX[groupType];
  if (!matrix) return 0;

  let score = 0;
  for (const tag of tags) {
    score += matrix[tag] || 0;
  }
  return Math.max(-6, Math.min(6, score));
}

/**
 * Factor 9: Preference depth bonus.
 * For each user preference, check if activity tags reinforce (+2) or contradict (-2) it.
 * Clamped to [-4, +4].
 */
function computePreferenceDepth(tags: Set<ProfileTag>, preferences: ActivityType[]): number {
  let score = 0;

  for (const pref of preferences) {
    // Affinities: tags that reinforce this preference
    const affinities = PREFERENCE_AFFINITIES[pref];
    if (affinities) {
      for (const affTag of affinities) {
        if (tags.has(affTag)) score += 2;
      }
    }

    // Conflicts: tags that contradict this preference
    const conflicts = PREFERENCE_CONFLICTS[pref];
    if (conflicts) {
      for (const confTag of conflicts) {
        if (tags.has(confTag)) score -= 2;
      }
    }
  }

  return Math.max(-4, Math.min(4, score));
}
