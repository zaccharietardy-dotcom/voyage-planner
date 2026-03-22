/**
 * Step 3b — LLM Cluster Rebalancing
 *
 * Takes geo-clustered activities and asks Gemini 2.5 Flash to reorganize them
 * into thematically coherent days while keeping distances minimal.
 *
 * Returns null on any failure → caller falls back to algo clusters.
 */

import type { ActivityCluster, ScoredActivity } from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
import type { TripPreferences } from '../types';
import type { CityDensityProfile } from './step3-cluster';
import { fetchGeminiWithRetry } from '../services/geminiSearch';
import { calculateDistance } from '../services/geocoding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LLMDayAssignment {
  dayNumber: number;
  activityIds: string[];
  theme: string;
}

export interface LLMRebalanceResult {
  clusters: ActivityCluster[];
  themes: string[];
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function rebalanceClustersWithLLM(
  clusters: ActivityCluster[],
  timeWindows: DayTimeWindow[],
  preferences: TripPreferences,
  densityProfile: CityDensityProfile
): Promise<LLMRebalanceResult | null> {
  const t0 = Date.now();

  try {
    // Collect all activities with their current day assignment
    const allActivities: Array<ScoredActivity & { originalDay: number }> = [];
    const protectedDays = new Map<string, number>(); // activityId → locked dayNumber

    for (const cluster of clusters) {
      for (const act of cluster.activities) {
        allActivities.push({ ...act, originalDay: cluster.dayNumber });

        // Must-sees, day-trips, and protected items cannot move
        if (
          act.mustSee ||
          act.protectedReason === 'must_see' ||
          act.protectedReason === 'day_trip_anchor' ||
          act.protectedReason === 'day_trip' ||
          act.protectedReason === 'user_forced' ||
          cluster.isDayTrip ||
          cluster.isFullDay
        ) {
          protectedDays.set(act.id, cluster.dayNumber);
        }
      }
    }

    // Skip if too few movable activities (nothing to rebalance)
    const movableCount = allActivities.filter(a => !protectedDays.has(a.id)).length;
    if (movableCount < 3) {
      console.log(`[LLM Rebalance] Only ${movableCount} movable activities, skipping`);
      return null;
    }

    // Build prompt
    const prompt = buildPrompt(clusters, allActivities, protectedDays, timeWindows, preferences);

    // Call Gemini 2.5 Flash
    const response = await Promise.race([
      callGemini(prompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);

    if (!response) {
      console.warn('[LLM Rebalance] Gemini timeout (8s)');
      return null;
    }

    // Parse and validate
    const assignments = parseResponse(response);
    if (!assignments) {
      console.warn('[LLM Rebalance] Failed to parse Gemini response');
      return null;
    }

    const validationError = validateAssignments(
      assignments, allActivities, protectedDays, clusters.length
    );
    if (validationError) {
      console.warn(`[LLM Rebalance] Validation failed: ${validationError}`);
      return null;
    }

    // Rebuild clusters from LLM assignments
    const newClusters = rebuildClusters(assignments, allActivities, clusters);
    const themes = assignments.map(a => a.theme || '');
    const latencyMs = Date.now() - t0;

    console.log(`[LLM Rebalance] Success in ${latencyMs}ms — themes: ${themes.join(', ')}`);

    return { clusters: newClusters, themes, latencyMs };
  } catch (err) {
    console.warn(`[LLM Rebalance] Error: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  clusters: ActivityCluster[],
  allActivities: Array<ScoredActivity & { originalDay: number }>,
  protectedDays: Map<string, number>,
  timeWindows: DayTimeWindow[],
  preferences: TripPreferences
): string {
  const dayDescriptions = clusters.map(cluster => {
    const tw = timeWindows.find(tw => tw.dayNumber === cluster.dayNumber);
    const role = cluster.isDayTrip ? 'day_trip'
      : cluster.plannerRole
      || (tw?.hasArrivalTransport ? 'arrival' : tw?.hasDepartureTransport ? 'departure' : 'full_city');

    const startMin = tw ? timeToMinSimple(tw.activityStartTime) : 9 * 60;
    const endMin = tw ? timeToMinSimple(tw.activityEndTime) : 20 * 60;
    const capacityMin = endMin - startMin;

    const activities = cluster.activities.map(act => {
      const locked = protectedDays.has(act.id);
      const prefix = locked ? '[FIXE] ' : '';
      return `  - ${prefix}${act.name} (${act.type || 'activité'}, ${act.duration || 60}min) [${act.latitude.toFixed(4)}, ${act.longitude.toFixed(4)}] id=${act.id}`;
    });

    return `Jour ${cluster.dayNumber} (${role}, ${capacityMin}min disponibles):\n${activities.join('\n')}`;
  });

  return `Tu es un planificateur de voyage expert pour ${preferences.destination}.

Réorganise ces activités entre les jours pour créer des journées thématiquement cohérentes.
Exemples de bons thèmes : "Rome antique", "Art & Vatican", "Quartiers authentiques", "Nature & panoramas".

ACTIVITÉS PAR JOUR ACTUEL :
${dayDescriptions.join('\n\n')}

RÈGLES STRICTES :
1. Les activités marquées [FIXE] DOIVENT rester sur leur jour actuel
2. MINIMISE la distance totale parcourue chaque jour — garde les activités proches ensemble
3. Respecte la capacité en minutes de chaque jour (somme des durées ≤ capacité)
4. Chaque jour doit avoir un thème cohérent
5. TOUTES les activités doivent être présentes (aucune supprimée, aucune ajoutée)
6. Les jours arrival/departure ont moins de capacité — leur assigner moins d'activités

Réponds UNIQUEMENT en JSON, sans explication :
[{"dayNumber": 1, "activityIds": ["id1", "id2"], "theme": "Nom du thème"}, ...]`;
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

async function callGemini(prompt: string): Promise<string | null> {
  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
      },
    }, 2);

    if (!response.ok) {
      console.warn(`[LLM Rebalance] Gemini HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseResponse(raw: string): LLMDayAssignment[] | null {
  try {
    // Extract JSON array from response (may have markdown wrappers)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return null;

    return parsed.map((item: any) => ({
      dayNumber: item.dayNumber,
      activityIds: Array.isArray(item.activityIds) ? item.activityIds : [],
      theme: item.theme || '',
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAssignments(
  assignments: LLMDayAssignment[],
  allActivities: Array<ScoredActivity & { originalDay: number }>,
  protectedDays: Map<string, number>,
  expectedDayCount: number
): string | null {
  // Check day count
  if (assignments.length !== expectedDayCount) {
    return `Expected ${expectedDayCount} days, got ${assignments.length}`;
  }

  // Check all activities present (no duplicates, no missing)
  const allIds = new Set(allActivities.map(a => a.id));
  const assignedIds = new Set<string>();

  for (const day of assignments) {
    for (const id of day.activityIds) {
      if (!allIds.has(id)) return `Unknown activity ID: ${id}`;
      if (assignedIds.has(id)) return `Duplicate activity ID: ${id}`;
      assignedIds.add(id);
    }
  }

  if (assignedIds.size !== allIds.size) {
    const missing = [...allIds].filter(id => !assignedIds.has(id));
    return `Missing ${missing.length} activities: ${missing.slice(0, 3).join(', ')}...`;
  }

  // Check protected activities stayed on their day
  for (const day of assignments) {
    for (const id of day.activityIds) {
      const lockedDay = protectedDays.get(id);
      if (lockedDay !== undefined && lockedDay !== day.dayNumber) {
        return `Protected activity ${id} moved from day ${lockedDay} to day ${day.dayNumber}`;
      }
    }
  }

  return null; // All good
}

// ---------------------------------------------------------------------------
// Rebuild clusters
// ---------------------------------------------------------------------------

function rebuildClusters(
  assignments: LLMDayAssignment[],
  allActivities: Array<ScoredActivity & { originalDay: number }>,
  originalClusters: ActivityCluster[]
): ActivityCluster[] {
  const activityById = new Map(allActivities.map(a => [a.id, a]));

  return assignments.map((assignment, idx) => {
    const activities = assignment.activityIds
      .map(id => activityById.get(id)!)
      .filter(Boolean);

    const original = originalClusters[idx];

    // Recompute centroid
    const centroid = activities.length > 0
      ? {
          lat: activities.reduce((s, a) => s + a.latitude, 0) / activities.length,
          lng: activities.reduce((s, a) => s + a.longitude, 0) / activities.length,
        }
      : original?.centroid || { lat: 0, lng: 0 };

    // Compute intra-cluster distance
    let totalIntra = 0;
    for (let i = 1; i < activities.length; i++) {
      totalIntra += calculateDistance(
        activities[i - 1].latitude, activities[i - 1].longitude,
        activities[i].latitude, activities[i].longitude
      );
    }

    return {
      dayNumber: assignment.dayNumber,
      activities,
      centroid,
      totalIntraDistance: totalIntra,
      isDayTrip: original?.isDayTrip,
      dayTripDestination: original?.dayTripDestination,
      isFullDay: original?.isFullDay,
      plannerRole: original?.plannerRole,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeToMinSimple(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
