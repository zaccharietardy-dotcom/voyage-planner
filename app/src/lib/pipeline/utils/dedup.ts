/**
 * Pipeline V2 — Deduplication utilities
 */

import { calculateDistance } from '../../services/geocoding';
import type { ScoredActivity } from '../types';

/**
 * Deduplicate activities by GPS proximity.
 * When two activities are within `thresholdKm`, keep the one with more reviews.
 */
export function deduplicateByProximity(
  activities: ScoredActivity[],
  thresholdKm: number = 0.1
): ScoredActivity[] {
  const result: ScoredActivity[] = [];

  for (const activity of activities) {
    if (!activity.latitude || !activity.longitude) continue;

    const duplicate = result.find(
      (existing) =>
        existing.latitude &&
        existing.longitude &&
        calculateDistance(
          activity.latitude,
          activity.longitude,
          existing.latitude,
          existing.longitude
        ) < thresholdKm
    );

    if (duplicate) {
      // Keep the one with more reviews (better data)
      if ((activity.reviewCount || 0) > (duplicate.reviewCount || 0)) {
        const idx = result.indexOf(duplicate);
        // Preserve mustSee flag from either version
        if (duplicate.mustSee) activity.mustSee = true;
        result[idx] = activity;
      } else {
        // Preserve mustSee flag on the kept item
        if (activity.mustSee) duplicate.mustSee = true;
      }
    } else {
      result.push(activity);
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
