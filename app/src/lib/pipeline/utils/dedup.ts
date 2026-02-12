/**
 * Pipeline V2 — Deduplication utilities
 */

import { calculateDistance } from '../../services/geocoding';
import type { ScoredActivity } from '../types';

/**
 * Check if two names refer to the same attraction (different data sources).
 * Uses accent-insensitive, normalized substring matching.
 * Also checks for shared significant words (e.g. "rijksmuseum" in both names).
 */
function areNamesSimilar(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  if (!n1 || !n2 || n1.length < 3 || n2.length < 3) return false;
  if (n1 === n2) return true;
  // One contains the other (e.g. "pantheon" vs "pantheonroma")
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Check for shared significant words (6+ chars to avoid false positives).
  // This catches "Visite guidée du Rijksmuseum" vs "Rijksmuseum Amsterdam"
  // because both contain "rijksmuseum".
  const words1 = extractSignificantWords(name1);
  const words2 = extractSignificantWords(name2);
  for (const w of words1) {
    if (words2.has(w)) return true;
  }

  return false;
}

/** Extract significant words (6+ chars, normalized, no stop words) from a name */
function extractSignificantWords(name: string): Set<string> {
  const stopWords = new Set([
    'museum', 'musee', 'visite', 'guided', 'guidee', 'private', 'privee',
    'amsterdam', 'paris', 'london', 'rome', 'barcelona', 'berlin', 'madrid',
    'ticket', 'tickets', 'access', 'acces', 'priority', 'prioritaire',
    'walking', 'balade', 'promenade',
  ]);
  const normalized = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 6 && !stopWords.has(w));
  return new Set(normalized);
}

/**
 * Deduplicate activities by GPS proximity + name similarity.
 *
 * Three cases:
 * - <100m AND similar names → definite duplicate (same attraction, different sources)
 * - <300m AND similar names → still a duplicate (GPS imprecision between sources)
 * - <100m but DIFFERENT names → keep both (Panthéon ≠ nearby café)
 */
export function deduplicateByProximity(
  activities: ScoredActivity[],
  thresholdKm: number = 0.1
): ScoredActivity[] {
  const result: ScoredActivity[] = [];

  for (const activity of activities) {
    if (!activity.latitude || !activity.longitude) continue;

    let isDuplicate = false;
    let duplicateIdx = -1;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (!existing.latitude || !existing.longitude) continue;

      const dist = calculateDistance(
        activity.latitude, activity.longitude,
        existing.latitude, existing.longitude
      );

      const namesSimilar = areNamesSimilar(activity.name || '', existing.name || '');

      // CASE 1: Close (<100m) AND similar names → definite duplicate
      // CASE 2: Same name but farther apart (up to 300m) → still duplicate (GPS variance)
      // CASE 3: Close (<100m) but DIFFERENT names → NOT a duplicate
      if ((dist < thresholdKm && namesSimilar) || (dist < 0.3 && namesSimilar)) {
        isDuplicate = true;
        duplicateIdx = i;
        break;
      }
    }

    if (isDuplicate && duplicateIdx >= 0) {
      const existing = result[duplicateIdx];
      // Keep the one with more reviews, but preserve best image + mustSee
      if ((activity.reviewCount || 0) > (existing.reviewCount || 0)) {
        mergeActivities(result, duplicateIdx, activity, existing);
      } else {
        mergeActivities(result, duplicateIdx, existing, activity);
      }
    } else {
      result.push(activity);
    }
  }

  return result;
}

/**
 * Deduplicate activities that share the same GPS location (<200m)
 * AND the same activity type. These represent the same experience
 * offered by different operators (e.g., two kayak tours at the same beach).
 * Name similarity is NOT required — same place + same type = duplicate.
 */
const SAME_LOCATION_DEDUP_TYPES = new Set([
  'museum', 'religious', 'park', 'gallery', 'zoo', 'amusement_park',
  'stadium', 'market', 'beach', 'nature', 'adventure', 'wellness',
]);

export function deduplicateSameLocationSameType(
  activities: ScoredActivity[]
): ScoredActivity[] {
  const result: ScoredActivity[] = [];

  for (const activity of activities) {
    if (!activity.latitude || !activity.longitude) {
      result.push(activity);
      continue;
    }

    let isDuplicate = false;
    let duplicateIdx = -1;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (!existing.latitude || !existing.longitude) continue;

      const dist = calculateDistance(
        activity.latitude, activity.longitude,
        existing.latitude, existing.longitude
      );

      // Same location (<200m) AND same mapped type → duplicate
      if (dist < 0.2
        && activity.type && existing.type
        && activity.type === existing.type
        && SAME_LOCATION_DEDUP_TYPES.has(activity.type)) {
        isDuplicate = true;
        duplicateIdx = i;
        break;
      }
    }

    if (isDuplicate && duplicateIdx >= 0) {
      const existing = result[duplicateIdx];
      // Keep higher-scored, fall back to more reviews
      const actScore = (activity as any).score || 0;
      const exScore = (existing as any).score || 0;
      if (actScore > exScore || (actScore === exScore && (activity.reviewCount || 0) > (existing.reviewCount || 0))) {
        mergeActivities(result, duplicateIdx, activity, existing);
      } else {
        mergeActivities(result, duplicateIdx, existing, activity);
      }
      console.log(`[Pipeline V2] Same-location-type dedup: "${activity.name}" merged with "${existing.name}" (type=${activity.type})`);
    } else {
      result.push(activity);
    }
  }

  return result;
}

/**
 * Deduplicate activities that share the same Viator booking search URL
 * OR are Viator products for the same location (same GPS, same attraction).
 * e.g. "Chapelle Sixtine" and "Musées du Vatican" both link to
 * "Vatican Museums Sistine Chapel Skip the Line" — same visit, keep the best.
 */
export function deduplicateByBookingUrl(
  activities: ScoredActivity[]
): ScoredActivity[] {
  const result: ScoredActivity[] = [];
  const seenUrls = new Map<string, number>(); // normalized key → index in result

  for (const a of activities) {
    const url = a.bookingUrl;
    if (!url) { result.push(a); continue; }

    // Normalize: for Viator search URLs, extract the search term as dedup key
    let key: string | null = null;
    if (url.includes('searchResults/all?text=')) {
      const match = url.match(/text=([^&]+)/);
      key = match ? `viator-search:${decodeURIComponent(match[1]).toLowerCase()}` : null;
    } else if (url.includes('viator.com') && url.includes('/tours/')) {
      // Direct Viator product URL — extract the attraction slug from the path
      // e.g. /tours/Amsterdam/Rijksmuseum-Highlights-Tour/d525-460280P3 → "rijksmuseum"
      // We look for significant words shared with existing activities
      // Fall through to GPS dedup below
      key = null;
    }

    if (key && seenUrls.has(key)) {
      const idx = seenUrls.get(key)!;
      const existing = result[idx];
      if ((a.reviewCount || 0) > (existing.reviewCount || 0)) {
        mergeActivities(result, idx, a, existing);
      } else {
        mergeActivities(result, idx, existing, a);
      }
      console.log(`[Pipeline V2] Booking URL dedup: "${a.name}" merged with "${existing.name}"`);
    } else if (key) {
      seenUrls.set(key, result.length);
      result.push(a);
    } else {
      result.push(a);
    }
  }

  // Second pass: deduplicate Viator products that are at the same location
  // but have different direct product URLs. This catches two different Viator
  // tours of the same museum (e.g. "Rijksmuseum Private Tour" vs "Rijksmuseum Guided Tour").
  return deduplicateViatorSameLocation(result);
}

/**
 * Among Viator activities with direct product URLs, deduplicate those
 * that are at the same GPS location (<200m) and share significant words.
 * Keep the one with the most reviews.
 */
function deduplicateViatorSameLocation(activities: ScoredActivity[]): ScoredActivity[] {
  const result: ScoredActivity[] = [];

  for (const a of activities) {
    const isViatorProduct = a.source === 'viator'
      && a.bookingUrl?.includes('viator.com')
      && a.bookingUrl?.includes('/tours/');

    if (!isViatorProduct || !a.latitude || !a.longitude) {
      result.push(a);
      continue;
    }

    // Check if there's already a Viator product at the same location in result
    let isDuplicate = false;
    let dupIdx = -1;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (!existing.latitude || !existing.longitude) continue;

      const dist = calculateDistance(a.latitude, a.longitude, existing.latitude, existing.longitude);
      if (dist < 0.2) {
        // Same GPS location — check if names share significant words
        const namesSimilar = areNamesSimilar(a.name || '', existing.name || '');
        if (namesSimilar) {
          isDuplicate = true;
          dupIdx = i;
          break;
        }
      }
    }

    if (isDuplicate && dupIdx >= 0) {
      const existing = result[dupIdx];
      // Keep the one with more reviews, but preserve best image + mustSee
      if ((a.reviewCount || 0) > (existing.reviewCount || 0)) {
        mergeActivities(result, dupIdx, a, existing);
      } else {
        mergeActivities(result, dupIdx, existing, a);
      }
      console.log(`[Pipeline V2] Viator location dedup: "${a.name}" merged with "${existing.name}"`);
    } else {
      result.push(a);
    }
  }

  return result;
}

/**
 * Filter out irrelevant attraction types (restaurants, cinemas, gyms, etc.)
 */
export function isIrrelevantAttraction(activity: ScoredActivity): boolean {
  const name = (activity.name || '').toLowerCase();
  const type = (activity.type || '').toLowerCase();

  // 1. Irrelevant facility types
  const irrelevantTypes = [
    'restaurant', 'cafe', 'bar', 'pub', 'nightclub',
    'cinema', 'movie_theater', 'gym', 'fitness',
    'hospital', 'clinic', 'pharmacy', 'dentist',
    'bank', 'atm', 'post_office',
    'car_rental', 'gas_station', 'parking',
    'supermarket', 'grocery', 'convenience_store',
    'hotel', 'hostel', 'motel', 'lodging',
    'airport', 'train_station', 'bus_station',
  ];

  if (irrelevantTypes.some(t => type.includes(t))) return true;

  // 2. Genuine spam: wax museums, fast food chains, escape rooms
  // NOTE: "experience museums" (WONDR, Museum of Illusions, Banksy, Ice Bar, Dungeon, etc.)
  // are NOT blacklisted — they are handled by contextual scoring in step2-score.ts
  // (e.g. WONDR scores +4 for family_with_kids but -3 for friends+culture).
  const irrelevantNames = [
    'madame tussaud', 'selfie museum', 'escape room',
    'hard rock cafe', 'starbucks', 'mcdonalds', 'mcdonald',
    'burger king', 'kfc', 'subway',
    'ripley', 'body worlds',
  ];

  if (irrelevantNames.some(n => name.includes(n))) return true;

  // 2b. Tour operators, travel agencies, tourist offices
  // These slip through when Google Places types aren't available (e.g. from SerpAPI/Overpass)
  const tourOperatorPatterns = [
    /\btour(?:s)?\s+(?:operator|agency|company|oficina)\b/i,
    /\bagenc[ey]\s+(?:de\s+)?(?:voyage|viaje|viaggio|reisen)\b/i,
    /\boficina\s+de\s+turism[eo]\b/i,
    /\boffice\s+(?:de\s+)?tourisme\b/i,
    /\btourist\s+(?:info(?:rmation)?|office|center|centre)\b/i,
  ];
  // Exception: Viator activities that ARE tours (food tours, bike tours) should NOT be filtered
  const isTourExperience = activity.source === 'viator' ||
    /\b(food\s+tour|bike\s+tour|walking\s+tour|boat\s+tour|cruise|kayak|cooking\s+class|wine\s+tasting|guided\s+visit|visite\s+guid[eé]e|excursion|snorkel|plong[eé]e|segway|e-?bike)\b/i.test(name);
  if (!isTourExperience && tourOperatorPatterns.some(p => p.test(name))) return true;
  // Also catch names like "In Out Barcelona Tours" — an agency, not a tour experience
  if (!isTourExperience && /\btours?\b/i.test(name) && !/\b(tour\s+of|tour\s+du|tour\s+de|tour\s+del|city\s+tour|free\s+tour|hop[\s-]on)\b/i.test(name)) {
    // If the name ends with "Tours" and has no experiential verb, it's likely an agency
    if (/\btours?\s*$/i.test(name)) return true;
  }

  // 3. Generic places/streets/squares that are NOT real activities
  // (walking through a street is not a 1h activity)
  const genericPlacePatterns = [
    /^(the )?\d+ streets$/i,           // "The 9 Streets"
    /\bsquare$/i,                       // "Dam Square"
    /\bplein$/i,                        // "Museumplein"
    /\bstraat$/i,                       // street names
    /\bgracht$/i,                       // canal names like "Prinsengracht"
    /\bstreet$/i,                       // "Oxford Street"
    /\bavenue\b/i,                      // "avenue des Champs-Élysées" (was: /\bavenue$/)
    /^(rue|boulevard|place|piazza|plaza|platz|calle|avenida|viale|corso|strasse|straße)\b/i,  // International street types
    /\b(rue|boulevard|rambla) /i,       // Mid-name: "La Rambla", "Le Boulevard..."
    // Neighbourhoods/quarters (SerpAPI pollution: "Latin Quarter", "Marais district")
    /\b(quarter|quartier|neighbourhood|neighborhood|barrio|viertel|wijk)\b/i,
  ];

  // Don't filter if the name contains keywords suggesting it's a real attraction
  const attractionKeywords = ['museum', 'musée', 'palace', 'palais', 'garden', 'jardin',
    'church', 'église', 'cathedral', 'cathédrale', 'tower', 'tour',
    'castle', 'château', 'temple', 'mosque', 'synagogue', 'monument',
    'market', 'marché', 'zoo', 'aquarium', 'gallery', 'galerie',
    'bridge', 'pont', 'park', 'parc', 'basilica', 'basilique', 'fort',
    'library', 'bibliothèque', 'opera', 'opéra', 'theatre', 'théâtre'];
  const hasAttractionKeyword = attractionKeywords.some(k => name.includes(k));

  // Don't filter high-popularity items from verified APIs (Google Places)
  // They were explicitly returned as tourist attractions
  if ((activity as any).source === 'google_places' && (activity.reviewCount || 0) > 500) return false;

  if (!hasAttractionKeyword && genericPlacePatterns.some(p => p.test(name))) return true;

  return false;
}

/**
 * Merge restaurants from TripAdvisor (quality/cuisine) + SerpAPI (GPS/reviews).
 * TripAdvisor often lacks GPS, SerpAPI has it.
 * Match by name similarity and enrich TripAdvisor entries with SerpAPI GPS.
 */
export function mergeRestaurantSources(
  tripAdvisor: { id: string; name: string; latitude: number; longitude: number; rating: number; reviewCount: number; [key: string]: any }[],
  serpApi: { id: string; name: string; latitude: number; longitude: number; rating: number; reviewCount: number; [key: string]: any }[]
): any[] {
  const merged = [...tripAdvisor];
  const taNormNames = tripAdvisor.map(r => normalizeName(r.name));

  // Add SerpAPI restaurants that don't exist in TripAdvisor
  // Use fuzzy matching: if the shorter name is a substring of the longer one, it's a match
  // e.g. "bhattipasal" is contained in "bhattipasalvoetboogauthenticnepalessefood"
  for (const sr of serpApi) {
    const srNorm = normalizeName(sr.name);
    const isDuplicate = taNormNames.some(taNorm =>
      srNorm === taNorm || srNorm.includes(taNorm) || taNorm.includes(srNorm)
    );
    if (!isDuplicate) {
      merged.push(sr);
    }
  }

  // Enrich TripAdvisor entries with GPS from SerpAPI if missing
  for (const ta of merged) {
    if (!ta.latitude || !ta.longitude || (ta.latitude === 0 && ta.longitude === 0)) {
      // Try exact match first, then fuzzy (one name contains the other)
      const taNorm = normalizeName(ta.name);
      const match = serpApi.find(sr => {
        if (!sr.latitude || !sr.longitude) return false;
        const srNorm = normalizeName(sr.name);
        return srNorm === taNorm || srNorm.includes(taNorm) || taNorm.includes(srNorm);
      });
      if (match) {
        ta.latitude = match.latitude;
        ta.longitude = match.longitude;
      }
    }
  }

  return merged;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Score an image URL by source reliability.
 * Higher = more likely to be an accurate photo of the attraction.
 * Google Places photos are tied to a place_id → highest reliability.
 * SerpAPI thumbnails are scraped from web search → lowest reliability.
 */
function getImageReliabilityScore(url: string | undefined): number {
  if (!url) return 0;
  if (url.includes('maps.googleapis.com/maps/api/place/photo')) return 4;
  if (url.includes('viator.com') || url.includes('staticcdn.viator.com')) return 3;
  if (url.includes('upload.wikimedia.org')) return 2;
  return 1; // SerpAPI thumbnails, other sources
}

/**
 * Merge two duplicate activities: keep the winner (higher reviewCount),
 * but preserve mustSee flag and the more reliable image from the loser.
 */
function mergeActivities(
  result: ScoredActivity[],
  idx: number,
  winner: ScoredActivity,
  loser: ScoredActivity
): void {
  if (loser.mustSee) winner.mustSee = true;
  // Preserve the more reliable image from either entry
  if (getImageReliabilityScore(loser.imageUrl) > getImageReliabilityScore(winner.imageUrl) && loser.imageUrl) {
    winner.imageUrl = loser.imageUrl;
  }
  result[idx] = winner;
}
