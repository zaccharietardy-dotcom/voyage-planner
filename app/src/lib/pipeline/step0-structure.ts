/**
 * Pipeline V3 — Step 0: LLM Trip Structure
 *
 * Uses Gemini Flash to suggest a thematic day-by-day grouping of activities.
 * Output is used as affinity hints for step3 clustering (soft bonus, not forcing).
 *
 * Timing: runs AFTER step2 (scored pool) + step4 (transport anchor).
 * Cost: ~$0.001/trip, ~2s latency.
 * Fallback: returns null on any failure → step3 uses pure geometric clustering.
 */

import type { ScoredActivity } from './types';
import type { DayTimeWindow } from './step4-anchor-transport';
import { fetchGeminiWithRetry } from '../services/geminiSearch';

const STEP0_TIMEOUT_MS = 10_000;

export interface LLMDayStructure {
  dayNumber: number;
  activities: string[];  // Activity names from the scored pool
  theme?: string;
  intensity?: 'light' | 'moderate' | 'intensive';
  notes?: string;
}

export interface LLMTripStructure {
  days: LLMDayStructure[];
}

/**
 * Affinity pairs: activities the LLM suggests should be on the same day.
 * Used by step3 to reduce virtual distance between paired activities.
 */
export interface AffinityPair {
  activityA: string;  // Activity name or ID
  activityB: string;
  dayNumber: number;  // Suggested day
}

/**
 * Call Gemini Flash to get a thematic trip structure.
 * Returns affinity pairs for step3 clustering, or null on failure.
 */
export async function generateTripStructure(
  destination: string,
  durationDays: number,
  groupType: string,
  arrivalTime: string | null,
  departureTime: string | null,
  mustSees: ScoredActivity[],
  topActivities: ScoredActivity[],
): Promise<AffinityPair[] | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.log('[Step 0] No GOOGLE_AI_API_KEY, skipping LLM structure');
    return null;
  }

  const mustSeeNames = mustSees.map(a => a.name).filter(Boolean);
  const topActList = topActivities.slice(0, 20).map(a => ({
    name: a.name,
    zone: a.zoneHint || 'unknown',
  }));

  const prompt = `Tu es un expert en planification de voyages. Organise ces activités en ${durationDays} journées thématiques pour ${destination}.

CONTRAINTES :
- Groupe : ${groupType}
${arrivalTime ? `- Arrivée jour 1 : ${arrivalTime} (jour léger)` : ''}
${departureTime ? `- Départ jour ${durationDays} : ${departureTime} (jour léger)` : ''}
- Regroupe les activités proches géographiquement
- Les must-sees doivent être placés à des moments optimaux (pas le soir, pas le dernier jour si possible)
- Jour d'arrivée et départ = intensité "light"

MUST-SEES : ${mustSeeNames.join(', ')}

ACTIVITÉS DISPONIBLES :
${topActList.map(a => `- ${a.name} (zone: ${a.zone})`).join('\n')}

Retourne UNIQUEMENT un JSON valide :
{
  "days": [
    { "dayNumber": 1, "activities": ["Nom activité 1", "Nom activité 2"], "theme": "Thème court", "intensity": "light" },
    ...
  ]
}

Règles :
- Utilise UNIQUEMENT les noms exacts de la liste ci-dessus
- Chaque activité ne doit apparaître qu'une seule fois
- 3-5 activités par jour plein, 1-3 par jour léger`;

  try {
    const response = await Promise.race([
      fetchGeminiWithRetry({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Step 0 timeout (${STEP0_TIMEOUT_MS / 1000}s)`)), STEP0_TIMEOUT_MS)
      ),
    ]);

    if (!response.ok) {
      console.warn(`[Step 0] Gemini returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[Step 0] No text in Gemini response');
      return null;
    }

    // Parse JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[Step 0] No JSON object found in response');
      return null;
    }

    const structure: LLMTripStructure = JSON.parse(jsonMatch[0]);
    if (!structure.days || !Array.isArray(structure.days)) {
      console.warn('[Step 0] Invalid structure format');
      return null;
    }

    // Validate: each activity name must match a known candidate (fuzzy)
    const allCandidateNames = new Set([
      ...mustSees.map(a => a.name?.toLowerCase().trim()),
      ...topActivities.map(a => a.name?.toLowerCase().trim()),
    ].filter(Boolean) as string[]);

    const affinityPairs: AffinityPair[] = [];

    for (const day of structure.days) {
      if (!day.activities || !Array.isArray(day.activities)) continue;

      // Filter to only valid activity names
      const validNames = day.activities.filter(name => {
        const norm = name?.toLowerCase().trim();
        if (!norm) return false;
        // Exact match or substring containment
        return allCandidateNames.has(norm) ||
          [...allCandidateNames].some(c => c.includes(norm) || norm.includes(c));
      });

      // Generate pairs: every pair of activities on the same day gets affinity
      for (let i = 0; i < validNames.length; i++) {
        for (let j = i + 1; j < validNames.length; j++) {
          affinityPairs.push({
            activityA: validNames[i],
            activityB: validNames[j],
            dayNumber: day.dayNumber,
          });
        }
      }
    }

    console.log(`[Step 0] LLM structure: ${structure.days.length} days, ${affinityPairs.length} affinity pairs`);
    if (structure.days.length > 0) {
      for (const day of structure.days) {
        console.log(`[Step 0]   Day ${day.dayNumber}: "${day.theme}" — ${(day.activities || []).join(', ')}`);
      }
    }

    return affinityPairs.length > 0 ? affinityPairs : null;

  } catch (err) {
    console.warn(`[Step 0] LLM structure failed, falling back:`, err instanceof Error ? err.message : err);
    return null;
  }
}
