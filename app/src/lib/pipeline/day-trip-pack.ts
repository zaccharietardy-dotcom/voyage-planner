/**
 * day-trip-pack.ts — Phase 2: DayTripPack builder
 *
 * Assembles atomic DayTripPack units from scored activities + day trip suggestions.
 * A pack only exists if the day trip is feasible within the day's time window.
 *
 * Transport resolution order (strict):
 *   1. dayTripSuggestion.transportDurationMin (curated base)
 *   2. Distance-based estimate by transport mode
 *   3. Haversine fallback (worst case)
 *
 * Packs are atomic: never split, never swapped, never re-diversified.
 */

import type { ScoredActivity, DayTripPack, FetchedData } from './types';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';
import type { Attraction } from '../services/attractions';
import { calculateDistance } from '../services/geocoding';

const DEFAULT_SLACK_MIN = 60;
const MIN_USEFUL_WINDOW_MIN = 360; // 6h minimum useful time for a day trip

// ============================================
// Transport Duration Resolution
// ============================================

interface TransportEstimate {
  durationMin: number;
  confidence: 'high' | 'medium' | 'low';
  mode: string;
}

function resolveTransportDuration(
  suggestion: DayTripSuggestion | undefined,
  distanceKm: number
): TransportEstimate {
  // Priority 1: Curated suggestion data
  if (suggestion?.transportDurationMin && suggestion.transportDurationMin > 0) {
    return {
      durationMin: suggestion.transportDurationMin,
      confidence: 'high',
      mode: suggestion.transportMode || 'train',
    };
  }

  // Priority 2: Distance-based estimate by mode
  if (suggestion?.transportMode) {
    const speeds: Record<string, number> = {
      train: 80,   // km/h average including stops
      RER: 50,
      metro: 35,
      bus: 45,
      car: 60,
      ferry: 30,
    };
    const speed = speeds[suggestion.transportMode] || 50;
    const estimatedMin = Math.round((distanceKm / speed) * 60);
    return {
      durationMin: Math.max(15, estimatedMin),
      confidence: 'medium',
      mode: suggestion.transportMode,
    };
  }

  // Priority 3: Haversine fallback — assume 50km/h average
  const fallbackMin = Math.round((distanceKm / 50) * 60);
  return {
    durationMin: Math.max(20, fallbackMin),
    confidence: 'low',
    mode: 'train',
  };
}

// ============================================
// Suggestion Matching
// ============================================

function findMatchingSuggestion(
  activity: ScoredActivity,
  suggestions: DayTripSuggestion[]
): DayTripSuggestion | undefined {
  const actNameLower = activity.name.toLowerCase();

  // 1. Close proximity (<5km)
  const proximityMatch = suggestions.find(s =>
    calculateDistance(activity.latitude, activity.longitude, s.latitude, s.longitude) < 5
  );
  if (proximityMatch) return proximityMatch;

  // 2. Name match
  const nameMatch = suggestions.find(s => {
    const sNameLower = (s.name || '').toLowerCase();
    const sDestLower = (s.destination || '').toLowerCase();
    const keyAttrs = (s.keyAttractions || []).map(k => k.toLowerCase());
    return sNameLower.includes(actNameLower) || actNameLower.includes(sDestLower) ||
      keyAttrs.some(k => k.includes(actNameLower) || actNameLower.includes(k));
  });
  if (nameMatch) return nameMatch;

  // 3. Wider proximity (<50km)
  return suggestions.find(s =>
    calculateDistance(activity.latitude, activity.longitude, s.latitude, s.longitude) < 50
  );
}

// ============================================
// Feasibility Check
// ============================================

function isDayTripFeasible(
  outboundMin: number,
  returnMin: number,
  slackMin: number,
  totalActivityDurationMin: number,
  availableWindowMin: number
): boolean {
  const totalRequired = outboundMin + returnMin + slackMin + totalActivityDurationMin;
  return totalRequired <= availableWindowMin;
}

// ============================================
// Enrichment
// ============================================

function enrichWithLocalActivities(
  anchor: ScoredActivity,
  destName: string,
  dayTripActivities: Record<string, Attraction[]>
): ScoredActivity[] {
  const enriched: ScoredActivity[] = [anchor];
  const localActivities = dayTripActivities[destName];
  if (!localActivities) return enriched;

  let added = 0;
  for (const da of localActivities) {
    if (added >= 3) break;
    if (enriched.some(a => a.name === da.name || a.id === da.id)) continue;

    const scored: ScoredActivity = {
      ...da,
      score: da.rating ? da.rating * 10 : 30,
      source: 'serpapi' as const,
      reviewCount: da.reviewCount || 0,
      latitude: da.latitude || anchor.latitude,
      longitude: da.longitude || anchor.longitude,
      protectedReason: 'day_trip_anchor',
      dayTripAffinity: 1.0,
    };
    enriched.push(scored);
    added++;
  }

  return enriched;
}

// ============================================
// Public API
// ============================================

/**
 * Build DayTripPacks from scored activities.
 *
 * Separates day-trip-eligible activities from city activities,
 * validates feasibility, and returns atomic packs.
 *
 * @returns { packs: validated day trip packs, cityActivities: remaining city activities }
 */
export function buildDayTripPacks(
  activities: ScoredActivity[],
  data: FetchedData,
  cityCenter: { lat: number; lng: number },
  numDays: number,
  defaultWindowMin: number = 12 * 60 // 12h default available window
): { packs: DayTripPack[]; cityActivities: ScoredActivity[] } {
  const suggestions = data.dayTripSuggestions || [];
  const dayTripActivitiesMap = data.dayTripActivities || {};

  // Identify day trip candidates (same logic as current step3)
  const dayTripCandidates: ScoredActivity[] = [];
  const cityActivities: ScoredActivity[] = [];

  const hasSuggestionMatch = (a: ScoredActivity): boolean => {
    return !!findMatchingSuggestion(a, suggestions);
  };

  for (const a of activities) {
    const dist = calculateDistance(a.latitude, a.longitude, cityCenter.lat, cityCenter.lng);
    if (a.mustSee && dist > 30) {
      dayTripCandidates.push(a);
    } else if (a.mustSee && dist > 10 && hasSuggestionMatch(a)) {
      dayTripCandidates.push(a);
    } else if (dist > 15 && numDays > 5) {
      dayTripCandidates.push(a);
    } else {
      cityActivities.push(a);
    }
  }

  if (dayTripCandidates.length === 0) {
    return { packs: [], cityActivities: activities };
  }

  // Cap day trips
  const maxDayTrips = numDays <= 5 ? 1 : Math.floor((numDays - 1) / 3);

  // Group candidates by destination to avoid creating duplicate packs
  // (e.g. 5 activities near Kamakura → 1 Kamakura pack, not 5)
  const destinationGroups = new Map<string, { candidates: ScoredActivity[]; suggestion?: DayTripSuggestion; distKm: number }>();

  for (const candidate of dayTripCandidates) {
    const distKm = calculateDistance(
      candidate.latitude, candidate.longitude,
      cityCenter.lat, cityCenter.lng
    );
    const suggestion = findMatchingSuggestion(candidate, suggestions);
    const destName = suggestion?.destination || suggestion?.name || candidate.name;

    const existing = destinationGroups.get(destName);
    if (existing) {
      existing.candidates.push(candidate);
      // Keep highest-priority suggestion
      if (suggestion && !existing.suggestion) existing.suggestion = suggestion;
    } else {
      destinationGroups.set(destName, { candidates: [candidate], suggestion, distKm });
    }
  }

  // Build one pack per destination group
  const candidatePacks: (DayTripPack & { score: number; distKm: number })[] = [];

  for (const [destName, group] of destinationGroups) {
    // Pick the best anchor (must-see first, then highest score)
    const sortedCandidates = [...group.candidates].sort((a, b) => {
      if (a.mustSee !== b.mustSee) return a.mustSee ? -1 : 1;
      return b.score - a.score;
    });
    const anchor = sortedCandidates[0];

    const transport = resolveTransportDuration(group.suggestion, group.distKm);

    // Build activities: anchor + other candidates in same destination + enrichment
    const packActivities = enrichWithLocalActivities(anchor, destName, dayTripActivitiesMap);
    // Add other candidates from the same destination group (if not already included)
    for (const other of sortedCandidates.slice(1)) {
      if (!packActivities.some(a => a.id === other.id || a.name === other.name)) {
        packActivities.push(other);
      }
    }

    const totalActivityDuration = packActivities.reduce((sum, a) => sum + (a.duration || 60), 0);

    // Feasibility check
    const feasible = isDayTripFeasible(
      transport.durationMin,
      transport.durationMin,
      DEFAULT_SLACK_MIN,
      totalActivityDuration,
      defaultWindowMin
    );

    if (!feasible) {
      console.log(
        `[DayTripPack] "${destName}" infeasible: ` +
        `${transport.durationMin}min×2 travel + ${totalActivityDuration}min activities + ${DEFAULT_SLACK_MIN}min slack = ` +
        `${transport.durationMin * 2 + totalActivityDuration + DEFAULT_SLACK_MIN}min > ${defaultWindowMin}min window`
      );
      // Demote all candidates back to city
      cityActivities.push(...group.candidates);
      continue;
    }

    // Mark all activities in pack as protected
    for (const a of packActivities) {
      a.protectedReason = 'day_trip_anchor';
      a.dayTripAffinity = 1.0;
    }

    candidatePacks.push({
      anchor,
      activities: packActivities,
      destination: destName,
      outboundDurationMin: transport.durationMin,
      returnDurationMin: transport.durationMin,
      slackMin: DEFAULT_SLACK_MIN,
      transportConfidence: transport.confidence,
      transportMode: transport.mode,
      score: anchor.score,
      distKm: group.distKm,
    });
  }

  // If too many packs, demote by: score desc, distance desc, transport confidence desc
  if (candidatePacks.length > maxDayTrips) {
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    candidatePacks.sort((a, b) => {
      // Must-see first
      const aMustSee = a.anchor.mustSee ? 1 : 0;
      const bMustSee = b.anchor.mustSee ? 1 : 0;
      if (bMustSee !== aMustSee) return bMustSee - aMustSee;
      // Then by score
      if (b.score !== a.score) return b.score - a.score;
      // Then by distance (farther = more needs its own day)
      if (b.distKm !== a.distKm) return b.distKm - a.distKm;
      // Then by transport confidence
      return confidenceRank[b.transportConfidence] - confidenceRank[a.transportConfidence];
    });

    const demoted = candidatePacks.splice(maxDayTrips);
    for (const pack of demoted) {
      // Push back only original candidates (not enrichment activities from dayTripActivitiesMap)
      for (const a of pack.activities) {
        a.protectedReason = undefined;
        a.dayTripAffinity = 0;
      }
      cityActivities.push(pack.anchor);
      console.log(`[DayTripPack] Demoted "${pack.destination}" (over max ${maxDayTrips} day trips)`);
    }
  }

  // Clean packs (remove internal scoring fields)
  const packs: DayTripPack[] = candidatePacks.map(({ score, distKm, ...pack }) => pack);

  if (packs.length > 0) {
    console.log(
      `[DayTripPack] ${packs.length} pack(s) built: ` +
      packs.map(p =>
        `"${p.destination}" (${p.outboundDurationMin}min ${p.transportMode}, ${p.activities.length} acts, confidence=${p.transportConfidence})`
      ).join(', ')
    );
  }

  return { packs, cityActivities };
}
