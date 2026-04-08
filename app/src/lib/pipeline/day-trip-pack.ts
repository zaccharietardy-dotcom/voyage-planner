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
const LONG_DAY_TRIP_SLACK_MIN = 90;
const DAY_TRIP_LUNCH_MIN = 75;
const MIN_USEFUL_WINDOW_MIN = 420; // 7h minimum useful time for a day trip
const DAY_TRIP_WIDE_PROXIMITY_KM = 25;
const DESTINATION_ENVELOPE_KM = 20;
const ANCHOR_ENVELOPE_KM = 18;

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
    calculateDistance(activity.latitude, activity.longitude, s.latitude, s.longitude) < DAY_TRIP_WIDE_PROXIMITY_KM
  );
}

function normalizePlannerText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesDestinationEnvelope(
  activity: ScoredActivity,
  destination: string,
  suggestion?: DayTripSuggestion,
  anchor?: ScoredActivity
): boolean {
  const text = normalizePlannerText(`${activity.name || ''} ${activity.description || ''}`);
  const normalizedDestination = normalizePlannerText(destination);
  if (normalizedDestination && text.includes(normalizedDestination)) return true;

  if (suggestion) {
    const distToSuggestion = calculateDistance(activity.latitude, activity.longitude, suggestion.latitude, suggestion.longitude);
    if (distToSuggestion <= DESTINATION_ENVELOPE_KM) return true;
    const keyAttractions = (suggestion.keyAttractions || []).map((value) => normalizePlannerText(value));
    if (keyAttractions.some((key) => key && text.includes(key))) return true;
  }

  if (anchor) {
    const distToAnchor = calculateDistance(activity.latitude, activity.longitude, anchor.latitude, anchor.longitude);
    if (distToAnchor <= ANCHOR_ENVELOPE_KM) return true;
  }

  return false;
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
  const totalRequired = outboundMin + returnMin + slackMin + DAY_TRIP_LUNCH_MIN + totalActivityDurationMin;
  return totalRequired <= availableWindowMin;
}

// ============================================
// Enrichment
// ============================================

function enrichWithLocalActivities(
  anchor: ScoredActivity,
  destName: string,
  dayTripActivities: Record<string, Attraction[]>,
  sourcePackId: string
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
      protectedReason: 'day_trip',
      dayTripAffinity: 1.0,
      sourcePackId,
      planningToken: `${sourcePackId}:${da.id || da.name}`,
    };
    enriched.push(scored);
    added++;
  }

  return enriched;
}

function trimPackActivitiesToFit(
  activities: ScoredActivity[],
  anchor: ScoredActivity,
  availableActivityMin: number
): ScoredActivity[] {
  if (availableActivityMin <= 0) return [];

  const selected: ScoredActivity[] = [];
  const selectedKeys = new Set<string>();
  const anchorKey = anchor.id || anchor.name;
  const ordered = [...activities].sort((left, right) => {
    const leftProtected = left.id === anchor.id || left.mustSee ? 1 : 0;
    const rightProtected = right.id === anchor.id || right.mustSee ? 1 : 0;
    if (rightProtected !== leftProtected) return rightProtected - leftProtected;
    if (right.score !== left.score) return right.score - left.score;
    const leftDist = calculateDistance(left.latitude, left.longitude, anchor.latitude, anchor.longitude);
    const rightDist = calculateDistance(right.latitude, right.longitude, anchor.latitude, anchor.longitude);
    if (leftDist !== rightDist) return leftDist - rightDist;
    return (left.duration || 60) - (right.duration || 60);
  });

  let usedMin = 0;
  for (const activity of ordered) {
    const key = activity.id || activity.name;
    const duration = activity.duration || 60;
    if (selectedKeys.has(key)) continue;
    if (key === anchorKey || activity.mustSee) {
      if (usedMin + duration > availableActivityMin) return [];
      selected.push(activity);
      selectedKeys.add(key);
      usedMin += duration;
      continue;
    }
    if (usedMin + duration > availableActivityMin) continue;
    selected.push(activity);
    selectedKeys.add(key);
    usedMin += duration;
  }

  if (!selectedKeys.has(anchorKey)) return [];
  return selected;
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
): { packs: DayTripPack[]; cityActivities: ScoredActivity[]; destinationMismatchCount: number } {
  const suggestions = data.dayTripSuggestions || [];
  const dayTripActivitiesMap = data.dayTripActivities || {};
  let destinationMismatchCount = 0;

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
    return { packs: [], cityActivities: activities, destinationMismatchCount: 0 };
  }

  // Cap day trips adaptively.
  // Regional/sparse itineraries need more than one day-trip slot on 4-5 day trips.
  const farCandidateCount = dayTripCandidates.filter((candidate) => {
    const dist = calculateDistance(candidate.latitude, candidate.longitude, cityCenter.lat, cityCenter.lng);
    return dist >= 45;
  }).length;
  const hasRegionalSpreadSignal = farCandidateCount >= 2;
  const maxDayTrips = hasRegionalSpreadSignal
    ? (numDays <= 5 ? 2 : Math.max(2, Math.floor((numDays - 1) / 2)))
    : (numDays <= 5 ? 1 : Math.floor((numDays - 1) / 3));

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
    const packId = `daytrip:${destName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    // Pick the best anchor (must-see first, then highest score)
    const sortedCandidates = [...group.candidates].sort((a, b) => {
      if (a.mustSee !== b.mustSee) return a.mustSee ? -1 : 1;
      return b.score - a.score;
    });
    const anchor = sortedCandidates[0];

    const transport = resolveTransportDuration(group.suggestion, group.distKm);

    const slackMin = transport.durationMin * 2 > 180 ? LONG_DAY_TRIP_SLACK_MIN : DEFAULT_SLACK_MIN;
    const availableActivityMin = defaultWindowMin - transport.durationMin * 2 - DAY_TRIP_LUNCH_MIN - slackMin;

    // Build activities: anchor + other candidates in same destination + enrichment
    const rawPackActivities = enrichWithLocalActivities(anchor, destName, dayTripActivitiesMap, packId);
    // Add other candidates from the same destination group (if not already included)
    for (const other of sortedCandidates.slice(1)) {
      if (!rawPackActivities.some(a => a.id === other.id || a.name === other.name)) {
        rawPackActivities.push({
          ...other,
          protectedReason: other === anchor ? 'day_trip_anchor' : 'day_trip',
          dayTripAffinity: 1.0,
          sourcePackId: packId,
          planningToken: `${packId}:${other.id || other.name}`,
        });
      }
    }

    if (!matchesDestinationEnvelope(anchor, destName, group.suggestion, anchor)) {
      destinationMismatchCount++;
      cityActivities.push(...group.candidates);
      continue;
    }

    const mismatchedCandidates: ScoredActivity[] = [];
    const packActivitiesWithinEnvelope = rawPackActivities.filter((activity) => {
      const valid = matchesDestinationEnvelope(activity, destName, group.suggestion, anchor);
      if (!valid && group.candidates.some((candidate) => candidate.id === activity.id || candidate.name === activity.name)) {
        destinationMismatchCount++;
        mismatchedCandidates.push({
          ...activity,
          protectedReason: activity.mustSee ? 'must_see' : undefined,
          dayTripAffinity: 0,
          sourcePackId: undefined,
          planningToken: undefined,
          destinationEnvelopeId: undefined,
        });
      }
      return valid;
    });

    const packActivities = trimPackActivitiesToFit(packActivitiesWithinEnvelope, anchor, availableActivityMin);
    if (packActivities.length === 0) {
      console.log(`[DayTripPack] "${destName}" infeasible after protected-trim (budget ${availableActivityMin}min activities)`);
      cityActivities.push(...group.candidates);
      continue;
    }
    if (mismatchedCandidates.length > 0) {
      cityActivities.push(...mismatchedCandidates);
    }
    const totalActivityDuration = packActivities.reduce((sum, a) => sum + (a.duration || 60), 0);

    // Feasibility check
    const requiredWindowMin = transport.durationMin * 2 + totalActivityDuration + DAY_TRIP_LUNCH_MIN + slackMin;
    const feasible = defaultWindowMin >= MIN_USEFUL_WINDOW_MIN && isDayTripFeasible(
      transport.durationMin,
      transport.durationMin,
      slackMin,
      totalActivityDuration,
      defaultWindowMin
    );

    if (!feasible) {
      console.log(
        `[DayTripPack] "${destName}" infeasible: ` +
        `${transport.durationMin}min×2 travel + ${totalActivityDuration}min activities + ${DAY_TRIP_LUNCH_MIN}min lunch + ${slackMin}min slack = ` +
        `${requiredWindowMin}min > ${defaultWindowMin}min window`
      );
      // Demote all candidates back to city
      cityActivities.push(...group.candidates);
      continue;
    }

    // Mark all activities in pack as protected
    for (const a of packActivities) {
      a.protectedReason = a.id === anchor.id ? 'day_trip_anchor' : 'day_trip';
      a.dayTripAffinity = 1.0;
      a.sourcePackId = packId;
      a.destinationEnvelopeId = packId;
      a.planningToken = a.planningToken || `${packId}:${a.id || a.name}`;
    }

    candidatePacks.push({
      id: packId,
      anchor,
      activities: packActivities,
      destination: destName,
      outboundDurationMin: transport.durationMin,
      returnDurationMin: transport.durationMin,
      slackMin,
      transportConfidence: transport.confidence,
      transportMode: transport.mode,
      requiredWindowMin,
      score: anchor.score,
      distKm: group.distKm,
      originalCandidates: sortedCandidates,
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
      for (const a of pack.activities) {
        a.protectedReason = undefined;
        a.dayTripAffinity = 0;
        a.sourcePackId = undefined;
        a.planningToken = undefined;
      }
      const seen = new Set<string>();
      for (const candidate of pack.originalCandidates || [pack.anchor]) {
        const key = candidate.id || candidate.name;
        if (seen.has(key)) continue;
        seen.add(key);
        cityActivities.push({
          ...candidate,
          protectedReason: candidate.mustSee ? 'must_see' : undefined,
          dayTripAffinity: 0,
          sourcePackId: undefined,
          planningToken: undefined,
          destinationEnvelopeId: undefined,
        });
      }
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

  return { packs, cityActivities, destinationMismatchCount };
}
