/**
 * Pipeline V2 — Deduplication utilities
 */

import { calculateDistance } from '../../services/geocoding';
import type { ScoredActivity } from '../types';

/**
 * Check if two names refer to the same attraction (different data sources).
 * Uses accent-insensitive, normalized substring matching.
 */
function areNamesSimilar(name1: string, name2: string): boolean {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  if (!n1 || !n2 || n1.length < 3 || n2.length < 3) return false;
  if (n1 === n2) return true;
  // One contains the other (e.g. "pantheon" vs "pantheonroma")
  if (n1.includes(n2) || n2.includes(n1)) return true;
  return false;
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
      // Keep the one with more reviews (better data)
      if ((activity.reviewCount || 0) > (existing.reviewCount || 0)) {
        // Preserve mustSee flag from either version
        if (existing.mustSee) activity.mustSee = true;
        result[duplicateIdx] = activity;
      } else {
        // Preserve mustSee flag on the kept item
        if (activity.mustSee) existing.mustSee = true;
      }
    } else {
      result.push(activity);
    }
  }

  return result;
}

/**
 * Deduplicate activities that share the same Viator booking search URL.
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
    let key: string;
    if (url.includes('searchResults/all?text=')) {
      const match = url.match(/text=([^&]+)/);
      key = match ? decodeURIComponent(match[1]).toLowerCase() : url.toLowerCase();
    } else {
      // Don't dedup non-search URLs (direct product links are unique)
      result.push(a);
      continue;
    }

    if (seenUrls.has(key)) {
      const idx = seenUrls.get(key)!;
      const existing = result[idx];
      // Keep the one with more reviews (better data quality), propagate mustSee
      if ((a.reviewCount || 0) > (existing.reviewCount || 0)) {
        if (existing.mustSee) a.mustSee = true;
        result[idx] = a;
      } else {
        if (a.mustSee) existing.mustSee = true;
      }
      console.log(`[Pipeline V2] Booking URL dedup: "${a.name}" merged with "${existing.name}"`);
    } else {
      seenUrls.set(key, result.length);
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

  // 3. Generic places/streets/squares that are NOT real activities
  // (walking through a street is not a 1h activity)
  const genericPlacePatterns = [
    /^(the )?\d+ streets$/,           // "The 9 Streets"
    /\bsquare$/,                       // "Dam Square"
    /\bplein$/,                        // "Museumplein"
    /\bstraat$/,                       // street names
    /\bgracht$/,                       // canal names like "Prinsengracht"
    /\bstreet$/,                       // "Oxford Street"
    /\bavenue$/,                       // "Champs Élysées" (as place only)
    /^(rue|boulevard|place|piazza|plaza|platz|calle) /,  // French/Italian/Spanish/German streets
  ];

  // Don't filter if the name contains keywords suggesting it's a real attraction
  const attractionKeywords = ['museum', 'musée', 'palace', 'palais', 'garden', 'jardin',
    'church', 'église', 'cathedral', 'cathédrale', 'tower', 'tour',
    'castle', 'château', 'temple', 'mosque', 'synagogue', 'monument',
    'market', 'marché', 'zoo', 'aquarium', 'gallery', 'galerie',
    'bridge', 'pont', 'park', 'parc', 'basilica', 'basilique', 'fort',
    'library', 'bibliothèque', 'opera', 'opéra', 'theatre', 'théâtre'];
  const hasAttractionKeyword = attractionKeywords.some(k => name.includes(k));

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
