/**
 * Pipeline V2 — Step 2: Score & Select Activities
 *
 * Pure function, zero API calls.
 * Merges multi-source activities, deduplicates, scores by popularity, selects the right count.
 */

import type { TripPreferences, GroupType, ActivityType } from '../types';
import type { Attraction } from '../services/attractions';
import type { FetchedData, ScoredActivity } from './types';
import { deduplicateByProximity, deduplicateByBookingUrl, deduplicateSameLocationSameType, isIrrelevantAttraction } from './utils/dedup';
import { classifyExperienceCategory } from './utils/activityDedup';
import { fixAttractionDuration, fixAttractionCost } from '../tripAttractions';
import { findKnownViatorProduct } from '../services/viatorKnownProducts';
import { calculateDistance } from '../services/geocoding';
import { classifyOutdoorIndoor } from './utils/constants';
import { isViatorGenericPrivateTourCandidate, scoreViatorPlusValue } from '../services/viator';
import { isMonumentLikeActivityName } from '../services/officialTicketing';

const MAX_GENERIC_PRIVATE_VIATOR = 1;
const DISTINCTIVE_VIATOR_EXPERIENCE_KEYWORDS = [
  'workshop', 'atelier', 'class', 'cours',
  'cooking', 'culinary', 'knife', 'couteau',
  'tea ceremony', 'ceremonie du the', 'craft', 'artisan',
];

/**
 * Keywords that disqualify an activity from auto-detection as must-see.
 * Experiences, guided tours, walks, and activities are NOT incontournables —
 * only iconic places/monuments should be auto-flagged.
 */
const MUST_SEE_EXCLUDED_KEYWORDS = [
  'cooking', 'cuisine', 'culinary', 'food tour', 'food tasting',
  'workshop', 'atelier', 'class', 'cours', 'lesson', 'lecon',
  'wine tasting', 'degustation', 'oenologie',
  'bike tour', 'velo tour', 'cycling tour', 'e-bike',
  'segway', 'pub crawl', 'bar crawl',
  'escape', 'escape game', 'escape room',
  'photo shoot', 'seance photo',
  'spa', 'hammam', 'massage',
  'transfer', 'shuttle',
  'walk', 'promenade', 'passeggiata', 'balade', 'stroll',
  'canal walk', 'river walk', 'lakeside walk',
];

/** Keywords that indicate an activity includes a meal (cooking class, food tour, etc.) */
const MEAL_INCLUSIVE_KEYWORDS = [
  'cooking class', 'cours de cuisine', 'atelier cuisine', 'atelier culinaire',
  'food tour', 'food tasting', 'wine tasting', 'dégustation', 'degustation',
  'includes lunch', 'includes dinner', 'déjeuner inclus', 'dîner inclus',
  'repas inclus', 'meal included', 'menu dégustation',
];

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
    kid_friendly: 0, romantic: -1, party: -2, adult_only: -5,
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

  // 1b. Validate OSM mustSee flags: only keep if the item looks like a visitable place.
  // Overpass sets mustSee based on Wikidata sitelinks count, which can flag abstract
  // concepts (e.g. "metre" = unit of measurement with 180 sitelinks → mustSee=true).
  const VISITABLE_KEYWORDS = /\b(museum|musée|musee|monument|palace|palais|castle|château|chateau|cathedral|cathédrale|basilica|basilique|church|église|eglise|tower|tour|park|parc|garden|jardin|bridge|pont|market|marché|marche|gallery|galerie|opera|opéra|library|bibliothèque|fort|fortress|temple|mosque|synagogue|zoo|aquarium|theatre|théâtre|viewpoint|belvedere|belvédère|citadel|citadelle|arena|arène|amphitheatre|amphithéâtre|stadium|stade|lighthouse|phare|waterfall|cascade|lake|lac|cave|grotte|abbey|abbaye|priory|prieuré|cloister|cloître)\b/i;
  for (const a of allActivities) {
    if (a.source === 'overpass' && a.mustSee) {
      const text = `${a.name || ''} ${(a as any).description || ''}`;
      if (!VISITABLE_KEYWORDS.test(text)) {
        console.log(`[Pipeline V2] Stripped mustSee from OSM item "${a.name}" — no visitable-place keyword`);
        a.mustSee = false;
      }
    }
  }

  // 2. Filter activities without valid GPS
  const withGPS = allActivities.filter(
    a => a.latitude && a.longitude && a.latitude !== 0 && a.longitude !== 0
  );

  // 2b. Reject GPS outliers: activities >50km from destination center
  // Catches cross-city contamination (e.g., "Palais de Tokyo" in Paris appearing in a Tokyo trip)
  const MAX_ACTIVITY_DIST_KM = 50;
  const gpsFiltered = withGPS.filter(a => {
    const dist = calculateDistance(a.latitude, a.longitude, data.destCoords.lat, data.destCoords.lng);
    if (dist > MAX_ACTIVITY_DIST_KM) {
      console.log(`[Pipeline V2] ❌ GPS outlier rejected: "${a.name}" (${dist.toFixed(0)}km from destination, max ${MAX_ACTIVITY_DIST_KM}km)`);
      return false;
    }
    return true;
  });

  // 3. Deduplicate by proximity (100m)
  const gpsDeduped = deduplicateByProximity(gpsFiltered, 0.1);

  // 3a. Deduplicate same GPS location + same activity type (e.g., two kayak tours at same beach)
  const locationTypeDeduped = deduplicateSameLocationSameType(gpsDeduped);

  // 3b. Deduplicate by shared booking URL (e.g. Vatican Museums + Sistine Chapel = same visit)
  const deduped = deduplicateByBookingUrl(locationTypeDeduped);

  // 3c. FALLBACK must-see name matching
  // If the SerpAPI must-see search failed for an item, or the dedup lost the flag,
  // check all activities against the user's mustSee text and apply the flag.
  // This catches cases like "Fontaine de Trevi" where the API search returned
  // a different result or the GPS was too far from the Google Places entry.
  if (preferences.mustSee?.trim()) {
    const mustSeeItems = preferences.mustSee
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .flatMap(item => {
        // Also expand "et" / "&"
        if (/\s+et\s+/i.test(item) || /\s*&\s*/.test(item)) {
          return item.split(/\s+et\s+|\s*&\s*/i).map(p => p.trim()).filter(Boolean);
        }
        return [item];
      });

    // Normalize for accent-insensitive matching
    const normalizeAccents = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    for (const activity of deduped) {
      if (activity.mustSee) continue; // Already flagged
      // Skip Viator activities for fallback matching — their marketing names
      // often include landmark names ("Séance photo à la Tour Eiffel") which
      // causes false must-see matches. Viator activities should only be must-see
      // if explicitly matched via ID/slug in the primary matching pass.
      if ((activity as any).source === 'viator') continue;
      const actNameNorm = normalizeAccents(activity.name || '');
      for (const mustSeeItem of mustSeeItems) {
        const mustSeeNorm = normalizeAccents(mustSeeItem);
        // Guard: require the must-see term to be a significant portion of the
        // activity name. This prevents "Tour Eiffel" (11 chars) matching inside
        // "Séance photo privée parisienne Life Style à la Tour Eiffel" (55 chars)
        // because 11/55 = 0.20 < 0.3.
        const nameRatio = mustSeeNorm.length / actNameNorm.length;
        if (nameRatio < 0.3 || nameRatio > 3.0) continue;
        // Check if activity name contains the must-see item or vice versa
        if (actNameNorm.includes(mustSeeNorm) || mustSeeNorm.includes(actNameNorm)) {
          console.log(`[Pipeline V2] Fallback must-see: "${activity.name}" matched "${mustSeeItem}" from user preferences (ratio=${nameRatio.toFixed(2)})`);
          activity.mustSee = true;
          break;
        }
      }
    }
  }

  // 3d. Cap OSM-only mustSees to prevent pool flooding.
  // User-specified mustSees (from 'mustsee' source or fallback matching) are untouched.
  // Only auto-detected OSM mustSees (from Wikidata sitelinks) are capped.
  const MAX_OSM_MUST_SEES = 3;
  const osmMustSees = deduped.filter(a => a.mustSee && a.source === 'overpass');
  if (osmMustSees.length > MAX_OSM_MUST_SEES) {
    // Keep only the top N by rating, strip mustSee from the rest
    osmMustSees.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    for (let i = MAX_OSM_MUST_SEES; i < osmMustSees.length; i++) {
      osmMustSees[i].mustSee = false;
      console.log(`[Pipeline V2] Capped OSM mustSee: "${osmMustSees[i].name}" (${i + 1}/${osmMustSees.length})`);
    }
  }

  // 4. Filter irrelevant types
  const filtered = deduped.filter(a => !isIrrelevantAttraction(a));

  // 4b. Auto-detect must-sees from popularity data (no arbitrary threshold or cap)
  // Top N non-Viator activities by popularity score are flagged as must-see.
  // N scales with trip duration — longer trips get more incontournables.
  // Activities matching MUST_SEE_EXCLUDED_KEYWORDS (experiences, walks, tours…)
  // are excluded — only iconic places/monuments should be auto-flagged.
  const autoMustSeeCount = Math.ceil(preferences.durationDays * 1.5);
  const existingMustSeeCount = filtered.filter(a => a.mustSee).length;
  const autoDetectSlots = Math.max(0, autoMustSeeCount - existingMustSeeCount);

  if (autoDetectSlots > 0) {
    const autoDetectCandidates = filtered
      .filter(a => {
        if (a.mustSee) return false;
        if (a.source === 'viator') return false;
        // Exclude experiences, walks, tours — only places can be auto must-see
        const text = `${(a.name || '').toLowerCase()} ${((a as any).description || '').toLowerCase()}`;
        return !MUST_SEE_EXCLUDED_KEYWORDS.some(kw => text.includes(kw));
      })
      .map(a => ({
        activity: a,
        popScore: computePopularityScore(a.rating || 0, a.reviewCount || 0),
      }))
      .filter(({ popScore }) => popScore >= 12) // Minimum quality floor
      .sort((a, b) => b.popScore - a.popScore);

    for (const { activity, popScore } of autoDetectCandidates.slice(0, autoDetectSlots)) {
      activity.mustSee = true;
      console.log(`[Pipeline V2] Auto must-see: "${activity.name}" (pop=${popScore.toFixed(1)}, reviews=${activity.reviewCount}, rating=${activity.rating})`);
    }
  }

  // 5. Score each activity
  const cityCenter = data.destCoords;

  // Compute activity centroid for proximity penalty (favors geographically grouped activities)
  const gpsValid = filtered.filter(a => a.latitude && a.longitude);
  const activityCentroid = gpsValid.length >= 3
    ? {
        lat: gpsValid.reduce((s, a) => s + a.latitude, 0) / gpsValid.length,
        lng: gpsValid.reduce((s, a) => s + a.longitude, 0) / gpsValid.length,
      }
    : cityCenter;

  const scored = filtered.map(a => ({
    ...a,
    score: computeScore(
      a,
      preferences,
      cityCenter,
      activityCentroid,
      data.budgetStrategy?.maxPricePerActivity
    ),
  }));

  // 6. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Log full ranking for debugging
  console.log(`[Pipeline V2] Activity ranking (top 20):`);
  scored.slice(0, 20).forEach((a, i) => {
    const tags = Array.from(inferActivityTags(a)).join(',');
    console.log(`[Pipeline V2]   #${i + 1} [${a.score.toFixed(1)}] ${a.mustSee ? '⭐' : '  '} "${a.name}" (src=${a.source}, reviews=${a.reviewCount}, rating=${a.rating || '?'}, tags=${tags || 'none'})`);
  });

  // 7. Separate must-sees from regular activities
  const mustSees = scored.filter(a => a.mustSee);
  const nonMustSees = scored.filter(a => !a.mustSee);
  const curatedNonMustSees = curateNonMustSeePool(nonMustSees, preferences);

  // 8. Select the right count
  // Arrival/departure days get fewer activities (~2 each), full days get ~5
  // Over-select to provide margin for rebalancing drops and gap-fill candidates.
  const fullDays = Math.max(0, preferences.durationDays - 2);
  const targetCount = Math.max(
    mustSees.length + Math.ceil(preferences.durationDays * 4.5),
    preferences.durationDays * 6,
    16 // Absolute minimum for any trip
  );
  const remainingSlots = Math.max(0, targetCount - mustSees.length);
  const selected: ScoredActivity[] = [...mustSees, ...curatedNonMustSees.slice(0, remainingSlots)];

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

  const cappedSelection = enforceGenericPrivateViatorCap(selected, nonMustSees);
  const categoryCapped = enforceExperienceCategoryCaps(cappedSelection, nonMustSees);

  // 9. Fix durations, costs, and enrich with Viator known product data
  return categoryCapped.map(a => {
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

/**
 * Keep a high-interest activity pool for short city trips:
 * - Preserve all must-sees (handled upstream)
 * - Down-select weak popularity/rating entries unless the pool would become too small
 */
function curateNonMustSeePool(
  nonMustSees: ScoredActivity[],
  preferences: TripPreferences
): ScoredActivity[] {
  if (nonMustSees.length === 0) return nonMustSees;

  // For short trips, quality matters more than long-tail variety.
  const isShortTrip = preferences.durationDays <= 5;
  if (!isShortTrip) return nonMustSees;

  const interesting = nonMustSees.filter((activity) => isInterestingEnough(activity));

  // Safety valve: never starve the planner when API coverage is sparse.
  const minPoolSize = Math.max(6, preferences.durationDays * 2);
  if (interesting.length < minPoolSize) {
    console.log(
      `[Pipeline V2] Step 2: interest filter kept ${interesting.length}/${nonMustSees.length} non-must-sees (below floor=${minPoolSize}), fallback to full pool`
    );
    return nonMustSees;
  }

  if (interesting.length !== nonMustSees.length) {
    console.log(
      `[Pipeline V2] Step 2: filtered low-interest non-must-sees ${nonMustSees.length - interesting.length}/${nonMustSees.length}`
    );
  }

  return interesting;
}

function isInterestingEnough(activity: ScoredActivity): boolean {
  const rating = Number(activity.rating || 0);
  const reviews = Number(activity.reviewCount || 0);
  const source = String(activity.source || '');

  // Viator items can be niche but still valuable if reasonably rated.
  if (source === 'viator') {
    return rating >= 4.1 || reviews >= 40;
  }

  // Overpass often lacks engagement signals. Keep only very well-rated entries.
  if (source === 'overpass' && reviews === 0) {
    return rating >= 4.5;
  }

  // Generic quality gate for city-break relevance.
  if (rating >= 4.5) return true;
  if (rating >= 4.3 && reviews >= 120) return true;
  if (rating >= 4.2 && reviews >= 250) return true;
  if (reviews >= 1500 && rating >= 4.0) return true;
  if (rating >= 4.0 && reviews >= 500) return true;  // Popular but not top-rated
  if (rating >= 4.1 && reviews >= 200) return true;  // Decent with moderate engagement

  return false;
}

function isDistinctiveViatorExperience(activity: ScoredActivity): boolean {
  if (activity.source !== 'viator') return false;
  const text = `${activity.name || ''} ${activity.description || ''}`.toLowerCase();
  return DISTINCTIVE_VIATOR_EXPERIENCE_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isGenericPrivateViatorActivity(activity: ScoredActivity): boolean {
  if (activity.source !== 'viator') return false;
  return isViatorGenericPrivateTourCandidate(activity.name || '', activity.description);
}

function enforceGenericPrivateViatorCap(
  selected: ScoredActivity[],
  rankedCandidates: ScoredActivity[]
): ScoredActivity[] {
  const privateIndices = selected
    .map((activity, index) => ({ activity, index }))
    .filter(({ activity }) => isGenericPrivateViatorActivity(activity))
    .sort((a, b) => (b.activity.score || 0) - (a.activity.score || 0));

  if (privateIndices.length <= MAX_GENERIC_PRIVATE_VIATOR) {
    return selected;
  }

  const keepIndices = new Set(
    privateIndices
      .slice(0, MAX_GENERIC_PRIVATE_VIATOR)
      .map(({ index }) => index)
  );

  const result: Array<ScoredActivity | null> = [...selected];
  const usedIds = new Set(selected.map((activity) => activity.id));
  let replacedCount = 0;
  let removedCount = 0;

  for (const { index, activity } of privateIndices) {
    if (keepIndices.has(index)) continue;

    const replacement = rankedCandidates.find((candidate) =>
      !usedIds.has(candidate.id)
      && !isGenericPrivateViatorActivity(candidate)
    );

    if (replacement) {
      result[index] = replacement;
      usedIds.add(replacement.id);
      replacedCount += 1;
    } else {
      result[index] = null;
      removedCount += 1;
    }

    console.log(`[Pipeline V2] Capped generic private Viator activity: "${activity.name}"`);
  }

  if (replacedCount > 0 || removedCount > 0) {
    console.log(`[Pipeline V2] Private Viator cap applied (max=${MAX_GENERIC_PRIVATE_VIATOR}): replaced=${replacedCount}, removed=${removedCount}`);
  }

  return result.filter((activity): activity is ScoredActivity => Boolean(activity));
}

/**
 * Cap experiential activities by category: max 1 cooking class, 1 food tour, etc.
 * Replaces excess entries with the next best non-same-category candidates.
 */
function enforceExperienceCategoryCaps(
  selected: ScoredActivity[],
  rankedCandidates: ScoredActivity[]
): ScoredActivity[] {
  const MAX_PER_CATEGORY = 1;

  // Group by experience category
  const categoryMap = new Map<string, { activity: ScoredActivity; index: number }[]>();
  for (let i = 0; i < selected.length; i++) {
    const cat = classifyExperienceCategory(selected[i].name || '');
    if (!cat) continue;
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push({ activity: selected[i], index: i });
  }

  // Check if any category exceeds the cap
  let needsCapping = false;
  for (const entries of categoryMap.values()) {
    if (entries.length > MAX_PER_CATEGORY) { needsCapping = true; break; }
  }
  if (!needsCapping) return selected;

  const result: Array<ScoredActivity | null> = [...selected];
  const usedIds = new Set(selected.map(a => a.id));

  for (const [cat, entries] of categoryMap) {
    if (entries.length <= MAX_PER_CATEGORY) continue;

    // Keep the highest-scored, replace others
    entries.sort((a, b) => (b.activity.score || 0) - (a.activity.score || 0));

    for (let i = MAX_PER_CATEGORY; i < entries.length; i++) {
      const { index, activity } = entries[i];

      // Find a replacement that is NOT in the same category
      const replacement = rankedCandidates.find(c =>
        !usedIds.has(c.id)
        && classifyExperienceCategory(c.name || '') !== cat
      );

      if (replacement) {
        result[index] = replacement;
        usedIds.add(replacement.id);
      } else {
        result[index] = null;
      }

      console.log(`[Pipeline V2] Category cap: removed "${activity.name}" (${cat}, max=${MAX_PER_CATEGORY}), replaced with "${replacement?.name || 'none'}"`);
    }
  }

  return result.filter((a): a is ScoredActivity => Boolean(a));
}

function tagActivity(
  a: Attraction,
  source: ScoredActivity['source']
): ScoredActivity {
  // Classify outdoor/indoor if not already set
  const isOutdoor = a.isOutdoor ?? classifyOutdoorIndoor(a.name || '', a.description, a.type);
  // Detect meal-inclusive activities (cooking class, food tour, etc.)
  const nameAndDesc = `${(a.name || '').toLowerCase()} ${(a.description || '').toLowerCase()}`;
  const includesMeal = a.includesMeal || MEAL_INCLUSIVE_KEYWORDS.some(k => nameAndDesc.includes(k));
  return {
    ...a,
    isOutdoor,
    includesMeal: includesMeal || undefined, // Only set if true
    score: 0,
    source,
    reviewCount: (a as any).reviewCount || (a as any).reviews || 0,
  };
}

/**
 * Combined popularity score: higher rating matters more, reviews provide scale.
 * (rating/5)^2 * log10(reviews+1) * 10
 *
 * Examples:
 *   4.8★ / 5000 reviews → ~34
 *   4.5★ / 1000 reviews → ~24
 *   4.0★ / 200 reviews  → ~15
 *   3.5★ / 50 reviews   → ~8
 *   3.0★ / 10 reviews   → ~4
 */
function computePopularityScore(rating: number, reviewCount: number): number {
  const r = Math.max(0, Math.min(5, rating));
  const ratingFactor = Math.pow(r / 5, 2);
  const reviewFactor = Math.log10(Math.max(reviewCount, 1) + 1);
  return ratingFactor * reviewFactor * 10;
}

function computeScore(
  activity: ScoredActivity,
  preferences: TripPreferences,
  cityCenter: { lat: number; lng: number },
  activityCentroid: { lat: number; lng: number },
  maxPricePerActivity?: number
): number {
  // Must-see bonus: user-specified get full +100, OSM auto-detected get +50
  // This ensures user must-sees always rank above OSM auto-detected ones
  const mustSeeBonus = activity.mustSee
    ? (activity.source === 'overpass' ? 50 : 100)
    : 0;

  // Combined popularity: (rating/5)^2 * log10(reviews+1) — penalizes bad ratings exponentially
  const popularityScore = computePopularityScore(activity.rating || 0, activity.reviewCount || 0);
  const ratingScore = 0; // Absorbed into popularityScore

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
    const plusValue = scoreViatorPlusValue({
      title: activity.name || '',
      description: (activity as any).description,
      rating: activity.rating,
      reviewCount: activity.reviewCount,
      price: activity.estimatedCost,
      freeCancellation: Boolean((activity as any).freeCancellation),
      instantConfirmation: Boolean((activity as any).instantConfirmation),
    });

    // Base Viator variety bonus + plus-value modulation.
    viatorBonus = 1.5 + plusValue.score;

    const isMonumentLike = isMonumentLikeActivityName(activity.name);
    if (isMonumentLike && plusValue.score < 3) {
      // Monument tours without real plus-value should lose against official entries.
      viatorBonus -= 5;
    }

    if (isGenericPrivateViatorActivity(activity) && !isDistinctiveViatorExperience(activity)) {
      // Generic private/customized tours create itinerary noise quickly.
      viatorBonus -= 3;
    }

    const geoConfidence = (activity as any).geoConfidence;
    if (geoConfidence === 'low') {
      // Unreliable GPS frequently creates bad day geometry and fake proximity.
      viatorBonus -= 6;
      if (plusValue.score < 2) {
        viatorBonus -= 3;
      }
    }
    if (geoConfidence === 'medium') viatorBonus -= 0.5;
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

  // Factor 10: Proximity penalty — soft penalty for activities far from the activity centroid
  // Favors selecting geographically grouped activities, reducing cross-city zigzag
  let proximityPenalty = 0;
  if (activity.latitude && activity.longitude && !activity.mustSee) {
    const distFromCenter = calculateDistance(
      activity.latitude, activity.longitude,
      activityCentroid.lat, activityCentroid.lng
    );
    if (distFromCenter > 7) proximityPenalty = -8;
    else if (distFromCenter > 5) proximityPenalty = -5;
    else if (distFromCenter > 3.5) proximityPenalty = -3;
    else if (distFromCenter > 2.5) proximityPenalty = -1.5;

    // Short urban trips must stay tighter to avoid long intra-day transitions.
    if (preferences.durationDays <= 5 && distFromCenter > 4) {
      proximityPenalty -= 2;
    }
  }

  // Budget adherence penalty (balanced mode): expensive optional activities are deprioritized.
  let budgetPenalty = 0;
  if (!activity.mustSee && maxPricePerActivity && maxPricePerActivity > 0) {
    const price = Number(activity.estimatedCost || 0);
    if (price > maxPricePerActivity * 1.8) budgetPenalty = -6;
    else if (price > maxPricePerActivity * 1.4) budgetPenalty = -3;
    else if (price > maxPricePerActivity * 1.15) budgetPenalty = -1.5;
  }

  return mustSeeBonus + popularityScore + ratingScore + typeMatchBonus + viatorBonus
    + reliabilityBonus + distancePenalty + contextFitBonus + preferenceDepthBonus + proximityPenalty + budgetPenalty;
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
