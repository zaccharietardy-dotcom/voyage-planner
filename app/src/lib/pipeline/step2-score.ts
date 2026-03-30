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
import { classifyOutdoorIndoor, getMinDuration, getMaxDuration } from './utils/constants';
import { isViatorGenericPrivateTourCandidate, scoreViatorPlusValue } from '../services/viator';
import { isMonumentLikeActivityName, resolveOfficialTicketing } from '../services/officialTicketing';
import { isGarbageActivity } from './utils/garbage-filter';
import { validateCoordinate, isPlausibleCoordinate } from './utils/coordinate-validator';

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
  // Stadiums: can't visit interior without event ticket — not true tourist attractions
  'stadium', 'stade', 'stadio', 'arena',
];

const SECONDARY_AUTO_MUST_SEE_KEYWORDS = [
  'basilica', 'basilique', 'church', 'église', 'eglise', 'cathedral', 'cathédrale', 'cathedrale',
  'column', 'colonne', 'memorial', 'monument à', 'monument a',
  'square', 'piazza', 'place', 'park', 'parc', 'garden', 'jardin',
];

const ICONIC_ALIASES_BY_DESTINATION: Record<string, string[]> = {
  rome: [
    'colossee', 'colisee', 'colisée', 'colosseum', 'forum romain', 'roman forum',
    'pantheon', 'panthéon', 'fontaine de trevi', 'trevi fountain',
    'vatican', 'musees du vatican', 'musee du vatican', 'musei vaticani',
    'chapelle sixtine', 'sistine chapel', 'saint pierre', 'saint-pierre', 'st peter',
    'piazza navona', 'castel sant angelo', 'chateau saint ange', 'espagne',
  ],
  tokyo: [
    'senso ji', 'senso-ji', 'asakusa', 'meiji jingu', 'meiji-jingu',
    'shibuya sky', 'tokyo tower', 'tour de tokyo', 'tokyo skytree',
    'akihabara', 'teamlab', 'ueno', 'disneysea', 'disneyland',
  ],
};

/** Keywords that indicate an activity includes a meal (cooking class, food tour, etc.) */
const MEAL_INCLUSIVE_KEYWORDS = [
  'cooking class', 'cours de cuisine', 'atelier cuisine', 'atelier culinaire',
  'food tour', 'food tasting', 'wine tasting', 'dégustation', 'degustation',
  'includes lunch', 'includes dinner', 'déjeuner inclus', 'dîner inclus',
  'repas inclus', 'meal included', 'menu dégustation',
];

// ─── Additional keyword patterns for reinforced personalization ─────────────

const ROMANTIC_KEYWORDS = /sunset|viewpoint|cruise|jardin|garden|spa|wine|rooftop/i;
const KID_FRIENDLY_KEYWORDS = /zoo|aquarium|park|playground|amusement|disney|lego/i;
export const NIGHTLIFE_KEYWORDS = /bar|club|pub|jazz|cabaret|flamenco|opera|show|concert/i;

export function isNightlifeActivity(act: { name?: string; type?: string }): boolean {
  return NIGHTLIFE_KEYWORDS.test(`${act.name || ''} ${act.type || ''}`);
}
const FOOD_TOUR_KEYWORDS = /food tour|cooking class|market tour|wine tasting|gastronom/i;
const ADVENTURE_KEYWORDS = /hike|kayak|surf|climb|zip.?line|rafting|diving|paraglid/i;

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

/** Conflicts: preference → tags that contradict it (-4 each) */
const PREFERENCE_CONFLICTS: Partial<Record<ActivityType, ProfileTag[]>> = {
  culture: ['instagram', 'party', 'active'],
  nature: ['instagram', 'party'],
  adventure: ['relaxing', 'instagram'],
  nightlife: ['kid_friendly'],
  beach: ['deep_culture'],
  wellness: ['party', 'active'],
};

/**
 * Parse an explicit duration from a Viator activity title.
 * Returns duration in minutes, or null if no duration indicator found.
 */
function parseDurationFromTitle(title: string): number | null {
  const t = title.toLowerCase();

  // "X hour(s)" / "X heure(s)" / "X-hour"
  const hourMatch = t.match(/(\d+(?:\.\d+)?)\s*[-‑]?\s*(?:hours?|heures?|hrs?|h)\b/);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);

  // "une heure" / "1 heure"
  if (/\bune?\s+heure\b/.test(t)) return 60;

  // "X min(utes)" / "X minutes"
  const minMatch = t.match(/(\d+)\s*[-‑]?\s*(?:minutes?|mins?|min)\b/);
  if (minMatch) return parseInt(minMatch[1]);

  // "half day" / "demi-journée"
  if (/\b(?:half[- ]?day|demi[- ]?journ[eé]e)\b/.test(t)) return 240;

  // "full day" / "journée complète"
  if (/\b(?:full[- ]?day|journ[eé]e\s+compl[eè]te)\b/.test(t)) return 480;

  return null;
}

function normalizePlannerText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSecondaryAutoMustSeeCandidate(activity: ScoredActivity): boolean {
  const text = normalizePlannerText(`${activity.name || ''} ${(activity as any).description || ''}`);
  return SECONDARY_AUTO_MUST_SEE_KEYWORDS.some((keyword) => text.includes(normalizePlannerText(keyword)));
}

function isCuratedIconicForDestination(activity: ScoredActivity, destination: string): boolean {
  const normalizedDestination = normalizePlannerText(destination);
  const aliases = ICONIC_ALIASES_BY_DESTINATION[normalizedDestination] || [];
  if (aliases.length === 0) return false;
  const text = normalizePlannerText(`${activity.name || ''} ${(activity as any).description || ''}`);
  return aliases.some((alias) => text.includes(normalizePlannerText(alias)));
}

function isIconicAutoMustSeeCandidate(
  activity: ScoredActivity,
  destination: string,
  popScore: number
): boolean {
  if (resolveOfficialTicketing(activity, destination)) return true;
  if (isCuratedIconicForDestination(activity, destination)) return true;
  if (isSecondaryAutoMustSeeCandidate(activity)) return false;
  return popScore >= 16
    && (activity.reviewCount || 0) >= 15000
    && isMonumentLikeActivityName(activity.name);
}

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

  // 2b. Reject GPS outliers: activities >50km from destination center.
  // Catches cross-city contamination (e.g., "Palais de Tokyo" in Paris appearing in a Tokyo trip).
  //
  // Must-see activities use a wider threshold:
  //   - ≤150km  → accepted (covers day-trip landmarks like Mont Fuji from Tokyo at 91km)
  //   - >150km  → kept but tagged as a day-trip candidate with a warning log
  //     (e.g., "Fushimi Inari-taisha" specified while planning Tokyo)
  // Non-must-see activities keep the strict 50km cap.
  const MAX_ACTIVITY_DIST_KM = 50;
  const MAX_MUST_SEE_DIST_KM = 150;
  const gpsFiltered = withGPS.filter(a => {
    const dist = calculateDistance(a.latitude, a.longitude, data.destCoords.lat, data.destCoords.lng);
    if (a.mustSee || a.source === 'mustsee') {
      if (dist > MAX_MUST_SEE_DIST_KM) {
        console.warn(`[Pipeline V2] ⚠️ Must-see far from destination: "${a.name}" (${dist.toFixed(0)}km > ${MAX_MUST_SEE_DIST_KM}km) — keeping as day-trip candidate`);
        (a as any).dayTripCandidate = true;
        return true;
      }
      return true;
    }
    if (dist > MAX_ACTIVITY_DIST_KM) {
      console.log(`[Pipeline V2] ❌ GPS outlier rejected: "${a.name}" (${dist.toFixed(0)}km from destination, max ${MAX_ACTIVITY_DIST_KM}km)`);
      return false;
    }
    return true;
  });

  // 2c. Filter garbage non-POI entries (e.g. "mètre" = unit of measurement from Overpass)
  const gpsClean = gpsFiltered.filter(a => {
    if (isGarbageActivity(a as any)) {
      console.log(`[Pipeline V2] ❌ Non-POI filtered: "${a.name}" (garbage activity)`);
      return false;
    }
    return true;
  });

  // 3. Deduplicate by proximity (100m)
  const gpsDeduped = deduplicateByProximity(gpsClean, 0.1);

  // 3a. Deduplicate same GPS location + same activity type (e.g., two kayak tours at same beach)
  const locationTypeDeduped = deduplicateSameLocationSameType(gpsDeduped);

  // 3b. Deduplicate by shared booking URL (e.g. Vatican Museums + Sistine Chapel = same visit)
  const deduped = deduplicateByBookingUrl(locationTypeDeduped);

  const normalizeAccents = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const userMustSeeItems = preferences.mustSee?.trim()
    ? preferences.mustSee
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
        .flatMap(item => {
          if (/\s+et\s+/i.test(item) || /\s*&\s*/.test(item)) {
            return item.split(/\s+et\s+|\s*&\s*/i).map(p => p.trim()).filter(Boolean);
          }
          return [item];
        })
    : [];
  const matchesUserMustSeePreference = (activity: ScoredActivity): boolean => {
    if (userMustSeeItems.length === 0) return false;
    if ((activity as any).source === 'viator') return false;
    const actNameNorm = normalizeAccents(activity.name || '');
    for (const mustSeeItem of userMustSeeItems) {
      const mustSeeNorm = normalizeAccents(mustSeeItem);
      const nameRatio = mustSeeNorm.length / Math.max(1, actNameNorm.length);
      if (nameRatio < 0.3 || nameRatio > 3.0) continue;
      if (actNameNorm.includes(mustSeeNorm) || mustSeeNorm.includes(actNameNorm)) {
        const actTextForExclude = `${(activity.name || '').toLowerCase()} ${((activity as any).description || '').toLowerCase()}`;
        if (MUST_SEE_EXCLUDED_KEYWORDS.some(kw => actTextForExclude.includes(kw))) continue;
        return true;
      }
    }
    return false;
  };

  // 3c. FALLBACK must-see name matching
  // If the SerpAPI must-see search failed for an item, or the dedup lost the flag,
  // check all activities against the user's mustSee text and apply the flag.
  // This catches cases like "Fontaine de Trevi" where the API search returned
  // a different result or the GPS was too far from the Google Places entry.
  if (userMustSeeItems.length > 0) {
    for (const activity of deduped) {
      if (activity.mustSee) continue; // Already flagged
      if (matchesUserMustSeePreference(activity)) {
        console.log(`[Pipeline V2] Fallback must-see: "${activity.name}" matched explicit user preferences`);
        activity.mustSee = true;
      }
    }
  }

  // 3c-bis. Strip mustSee from experiences/walks/tours that bypassed earlier guards
  // (e.g. activities from dedicated must-see API search with source='mustsee').
  for (const activity of deduped) {
    if (!activity.mustSee) continue;
    const actText = `${(activity.name || '').toLowerCase()} ${((activity as any).description || '').toLowerCase()}`;
    if (MUST_SEE_EXCLUDED_KEYWORDS.some(kw => actText.includes(kw))) {
      activity.mustSee = false;
      console.log(`[Pipeline V2] Stripped mustSee from "${activity.name}" — matches excluded keyword (source=${activity.source})`);
    }
  }

  // 3c-ter. Companion must-sees: when an iconic must-see is present, auto-promote its companions.
  // E.g. Colosseum → Roman Forum + Palatine Hill, St Peter's → Vatican Museums.
  const COMPANION_MUST_SEES: Record<string, string[]> = {
    // Rome
    'colosseum': ['roman forum', 'palatine hill'],
    'colosseo': ['roman forum', 'palatine hill'],
    'roman forum': ['colosseum', 'palatine hill'],
    'foro romano': ['colosseum', 'palatine hill'],
    'palatine hill': ['colosseum', 'roman forum'],
    'st peter': ['vatican museums', 'sistine chapel'],
    'san pietro': ['vatican museums', 'sistine chapel'],
    'vatican museums': ['st peter', 'sistine chapel'],
    'musei vaticani': ['st peter', 'sistine chapel'],
    'sistine chapel': ['vatican museums', 'st peter'],
    // Paris
    'eiffel tower': ['trocadero'],
    'tour eiffel': ['trocadero'],
    'louvre': ['tuileries garden', 'jardin des tuileries'],
    'sacre-coeur': ['montmartre'],
    'sacre coeur': ['montmartre'],
    // Barcelona
    'sagrada familia': ['park guell'],
    'park guell': ['sagrada familia'],
    // London
    'tower of london': ['tower bridge'],
    'tower bridge': ['tower of london'],
    'british museum': ['bloomsbury'],
    // Florence
    'uffizi': ['ponte vecchio'],
    'ponte vecchio': ['uffizi'],
    'duomo': ['baptistery', 'battistero'],
    // Athens
    'acropolis': ['parthenon', 'ancient agora'],
    'parthenon': ['acropolis'],
  };

  function normalizeForCompanion(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[''`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const currentMustSees = deduped.filter(a => a.mustSee);
  for (const ms of currentMustSees) {
    const msNorm = normalizeForCompanion(ms.name);
    // Find matching companion key
    for (const [key, companions] of Object.entries(COMPANION_MUST_SEES)) {
      if (!msNorm.includes(key) && !key.includes(msNorm.length >= 5 ? msNorm : '___')) continue;
      // Promote companions found in the pool
      for (const companionKey of companions) {
        const candidate = deduped.find(a => {
          if (a.mustSee) return false;
          const aNorm = normalizeForCompanion(a.name);
          return aNorm.includes(companionKey) || companionKey.includes(aNorm.length >= 5 ? aNorm : '___');
        });
        if (candidate) {
          candidate.mustSee = true;
          console.log(`[Pipeline V2] Companion must-see: "${candidate.name}" promoted (companion of "${ms.name}")`);
        }
      }
      break; // only match one key per must-see
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

  // 4b. Auto-detect must-sees conservatively.
  // Only user-forced entries, official-ticketing landmarks, and a small destination-aware
  // shortlist can become auto must-sees in v3.2. Popular but secondary POIs stay optional.
  const autoMustSeeCount = Math.min(4, Math.max(1, Math.ceil(preferences.durationDays * 0.75)));
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
      .filter(({ activity, popScore }) =>
        popScore >= 12 && isIconicAutoMustSeeCandidate(activity, preferences.destination, popScore)
      )
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

  let scored = filtered.map(a => ({
    ...a,
    score: computeScore(
      a,
      preferences,
      cityCenter,
      activityCentroid,
      data.budgetStrategy?.maxPricePerActivity,
      data.weatherForecasts
    ),
  }));

  // 5b. Exclude Viator activities with unreliable GPS (city-center fallback).
  // These have geoConfidence='low' meaning no real meeting point was resolved from Viator API.
  // Keeping them would corrupt geographic clustering and show wrong positions on the map.
  const beforeViatorGpsFilter = scored.length;
  scored = scored.filter(a =>
    !(a.source === 'viator' && (a as any).geoConfidence === 'low')
  );
  if (scored.length < beforeViatorGpsFilter) {
    console.log(`[Pipeline V2] Excluded ${beforeViatorGpsFilter - scored.length} Viator activities with unreliable GPS (city-center fallback)`);
  }

  // 5c. Validate and filter coordinates using coordinate-validator.
  // Filters out invalid coordinates and auto-corrects swapped lat/lng.
  // Must-see activities use a wider distance cap (500km) to avoid re-rejecting
  // far day-trip landmarks that were deliberately kept by the outlier filter above.
  const destCoords = data.destCoords;
  scored = scored.filter(act => {
    if (!isPlausibleCoordinate(act.latitude, act.longitude)) {
      console.log(`[Score] Dropping "${act.name}" — invalid coordinates (${act.latitude}, ${act.longitude})`);
      return false;
    }
    const maxDistKm = (act.mustSee || act.source === 'mustsee') ? 500 : 100;
    const validation = validateCoordinate(act.latitude, act.longitude, destCoords, maxDistKm);
    if (!validation.valid) {
      console.log(`[Score] Dropping "${act.name}" — ${validation.reason}`);
      return false;
    }
    if (validation.corrected) {
      console.log(`[Score] Correcting "${act.name}" coords: ${validation.reason}`);
      act.latitude = validation.corrected.lat;
      act.longitude = validation.corrected.lng;
    }
    return true;
  });

  // 5b. HARD FILTERS — remove incompatible activities (not just penalize)
  const maxPrice = data.budgetStrategy?.maxPricePerActivity;
  const beforeHardFilter = scored.length;

  // Hard filter: nightlife for family_with_kids (unless explicitly requested)
  if (preferences.groupType === 'family_with_kids' && !preferences.activities?.includes('nightlife')) {
    scored = scored.filter(a => !isNightlifeActivity(a));
  }

  // Hard filter: activities way over budget (> 2× maxPrice, except must-sees)
  if (maxPrice && maxPrice > 0) {
    scored = scored.filter(a => {
      if (a.mustSee) return true;
      const price = Number(a.estimatedCost || 0);
      if (price <= 0) return true; // No price data = keep
      return price <= maxPrice * 2;
    });
  }

  if (scored.length < beforeHardFilter) {
    console.log(`[Pipeline V2] Hard filters removed ${beforeHardFilter - scored.length} activities (nightlife/budget incompatible)`);
  }

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
  // Surplus pool (~50% above placed count) ensures gap-fill has candidates.
  const fullDays = Math.max(0, preferences.durationDays - 2);
  const targetCount = Math.max(
    mustSees.length + Math.ceil(preferences.durationDays * 6),
    preferences.durationDays * 8,
    24 // Absolute minimum for any trip
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
    const userForced = matchesUserMustSeePreference(fixed);
    if (userForced && fixed.protectedReason !== 'user_forced') {
      fixed = { ...fixed, protectedReason: 'user_forced', mustSee: true };
    }

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

    // Cap Viator duration when title contains explicit duration shorter than API value
    if (fixed.providerName === 'Viator' && fixed.name) {
      const titleDuration = parseDurationFromTitle(fixed.name);
      if (titleDuration && fixed.duration && fixed.duration > titleDuration) {
        console.log(`[Score] Viator title cap: "${fixed.name}" ${fixed.duration}min → ${titleDuration}min (from title)`);
        fixed = { ...fixed, duration: titleDuration };
      }
    }

    // Clamp duration to min/max rules from constants.ts
    const minDur = getMinDuration(fixed.name || '', fixed.type || '');
    const maxDur = getMaxDuration(fixed.name || '', fixed.type || '');
    fixed.duration = Math.max(minDur, fixed.duration || minDur);
    if (maxDur !== null) {
      fixed.duration = Math.min(maxDur, fixed.duration);
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
// Bayesian priors: pull low-review ratings toward a reasonable mean.
// This prevents tourist traps with 4.9★/15 reviews from outscoring
// established attractions with 4.2★/5000 reviews.
const BAYESIAN_PRIOR_COUNT = 50;
const BAYESIAN_PRIOR_MEAN = 4.0;

function computePopularityScore(rating: number, reviewCount: number): number {
  const r = Math.max(0, Math.min(5, rating));
  const reviews = Math.max(0, reviewCount);
  // Bayesian average: pulls outlier ratings toward the prior mean (4.0)
  // High-volume attractions (1000+ reviews) are barely affected (~0.2pt)
  // Low-volume 4.8★/15 reviews: dampened by ~0.9pt
  const bayesianRating = (reviews * r + BAYESIAN_PRIOR_COUNT * BAYESIAN_PRIOR_MEAN)
    / (reviews + BAYESIAN_PRIOR_COUNT);
  const ratingFactor = Math.pow(bayesianRating / 5, 2);
  const reviewFactor = Math.log10(Math.max(reviews, 1) + 1);
  return ratingFactor * reviewFactor * 10;
}

// Outdoor activity types that are weather-sensitive
const OUTDOOR_ACTIVITY_TYPES = /\b(beach|park|garden|viewpoint|trail|hiking|outdoor|coast|seaside|water_park|playground|promenade|walk|cycling|kayak|sailing|surf|snorkel|diving)\b/i;
const BEACH_ACTIVITY_TYPES = /\b(beach|plage|coast|seaside|water_park|surf|snorkel)\b/i;

function computeWeatherPenalty(
  activity: ScoredActivity,
  weatherForecasts: Array<{ tempMin: number; tempMax: number; weatherCode?: number }>
): number {
  if (!weatherForecasts || weatherForecasts.length === 0) return 0;

  const actText = `${activity.name || ''} ${activity.type || ''}`.toLowerCase();
  const isOutdoor = OUTDOOR_ACTIVITY_TYPES.test(actText);
  const isBeach = BEACH_ACTIVITY_TYPES.test(actText);
  if (!isOutdoor && !isBeach) return 0;

  // Average weather across trip days
  const avgTempMax = weatherForecasts.reduce((s, w) => s + w.tempMax, 0) / weatherForecasts.length;
  const hasBadWeather = weatherForecasts.some(w => w.weatherCode && w.weatherCode >= 61 && w.weatherCode <= 86);

  let penalty = 0;

  // Beach in cold weather
  if (isBeach && avgTempMax < 18) {
    penalty -= 15; // Beach is not enjoyable under 18°C
  } else if (isBeach && avgTempMax < 22) {
    penalty -= 5;
  }

  // Outdoor activities in cold weather
  if (isOutdoor && avgTempMax < 10) {
    penalty -= 5;
  }

  // Outdoor in rain/snow
  if (isOutdoor && hasBadWeather) {
    penalty -= 8;
  }

  return penalty;
}

function computeScore(
  activity: ScoredActivity,
  preferences: TripPreferences,
  cityCenter: { lat: number; lng: number },
  activityCentroid: { lat: number; lng: number },
  maxPricePerActivity?: number,
  weatherForecasts?: Array<{ tempMin: number; tempMax: number; weatherCode?: number }>
): number {
  // Must-see bonus: user-specified get full +100, OSM auto-detected get +50
  // This ensures user must-sees always rank above OSM auto-detected ones
  const mustSeeBonus = activity.mustSee
    ? (activity.source === 'overpass' ? 50 : 100)
    : 0;

  // Combined popularity: (rating/5)^2 * log10(reviews+1) — penalizes bad ratings exponentially
  const popularityScore = computePopularityScore(activity.rating || 0, activity.reviewCount || 0);
  const ratingScore = 0; // Absorbed into popularityScore

  // Type match: bonus if activity type matches user preferences, penalty if contradictory
  const activityType = (activity.type || '').toLowerCase();
  const TYPE_KEYWORDS: Record<string, string[]> = {
    culture: ['museum', 'gallery', 'monument', 'historic', 'church', 'palace', 'castle', 'temple', 'cultural'],
    nature: ['park', 'garden', 'nature', 'viewpoint', 'mountain', 'lake', 'beach', 'trail'],
    adventure: ['adventure', 'sport', 'outdoor', 'hiking', 'diving', 'climbing'],
    shopping: ['market', 'shopping', 'bazaar', 'souk'],
    gastronomy: ['food_tour', 'cooking_class', 'wine', 'tasting'],
    nightlife: ['nightlife', 'club', 'bar', 'show', 'entertainment'],
    wellness: ['spa', 'hammam', 'wellness', 'yoga', 'thermal'],
    beach: ['beach', 'coast', 'seaside', 'water_park'],
  };
  // Contradictions: activity types that clash with a given preference
  const TYPE_CONTRADICTIONS: Record<string, string[]> = {
    culture: ['sport', 'stadium', 'shopping', 'beach', 'nightlife', 'club', 'water_park'],
    nature: ['shopping', 'nightlife', 'club', 'stadium'],
    wellness: ['sport', 'nightlife', 'club', 'adventure'],
    beach: ['museum', 'gallery'],
  };
  const userPrefs = preferences.activities || [];
  const matchesAnyPref = userPrefs.some(pref => {
    const kws = TYPE_KEYWORDS[pref];
    return kws ? kws.some(t => activityType.includes(t)) : activityType.includes(pref);
  });
  const contradictsAnyPref = userPrefs.some(pref => {
    const contras = TYPE_CONTRADICTIONS[pref];
    return contras ? contras.some(t => activityType.includes(t)) : false;
  });
  const typeMatchBonus = matchesAnyPref ? 5 : (contradictsAnyPref ? -5 : 0);

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

  // Factor 9b: Reinforced personalization — keyword-based scoring by groupType and user preferences
  let personalizationBonus = 0;
  const actText = `${activity.name || ''} ${(activity as any).description || ''}`;

  // Group type modifiers
  if (preferences.groupType === 'couple') {
    if (ROMANTIC_KEYWORDS.test(actText)) personalizationBonus += 15;
    if (KID_FRIENDLY_KEYWORDS.test(actText)) personalizationBonus -= 5;
  } else if (preferences.groupType === 'family_with_kids') {
    if (KID_FRIENDLY_KEYWORDS.test(actText)) personalizationBonus += 15;
    if (NIGHTLIFE_KEYWORDS.test(actText)) personalizationBonus -= 20;
  } else if (preferences.groupType === 'friends') {
    if (NIGHTLIFE_KEYWORDS.test(actText)) personalizationBonus += 10;
  }

  // User activity preferences modifiers
  const userActivities = preferences.activities || [];
  if (userActivities.includes('gastronomy')) {
    if (FOOD_TOUR_KEYWORDS.test(actText)) personalizationBonus += 10;
  }
  if (userActivities.includes('adventure')) {
    if (ADVENTURE_KEYWORDS.test(actText)) personalizationBonus += 15;
  }
  if (userActivities.includes('culture')) {
    if (/museum|gallery|cathedral/i.test(actText)) personalizationBonus += 5;
  }

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

  // Stadium/arena penalty: exterior-only visits are not worthwhile tourist activities.
  // Users can't enter without an event ticket — deprioritize heavily so they lose to
  // real cultural attractions.
  let stadiumPenalty = 0;
  if (/\b(stadium|stade|stadio)\b/i.test(activity.name || '') || activityType === 'stadium') {
    stadiumPenalty = -8;
  }

  // Weather penalty: outdoor activities in bad weather, beach in cold weather
  const weatherPenalty = computeWeatherPenalty(activity, weatherForecasts || []);

  return mustSeeBonus + popularityScore + ratingScore + typeMatchBonus + viatorBonus
    + reliabilityBonus + distancePenalty + contextFitBonus + preferenceDepthBonus + personalizationBonus + proximityPenalty + budgetPenalty + stadiumPenalty + weatherPenalty;
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

    // Conflicts: tags that contradict this preference (-4 each, stronger than before)
    const conflicts = PREFERENCE_CONFLICTS[pref];
    if (conflicts) {
      for (const confTag of conflicts) {
        if (tags.has(confTag)) score -= 4;
      }
    }
  }

  return Math.max(-8, Math.min(8, score));
}
