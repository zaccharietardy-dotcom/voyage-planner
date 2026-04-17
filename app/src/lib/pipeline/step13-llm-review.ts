/**
 * Pipeline V3 — Step 13: LLM Review
 *
 * Post-generation safety net: Gemini 3 Flash reviews the complete trip
 * for logical inconsistencies that deterministic checks might miss.
 *
 * Single-pass review with structured JSON output.
 * Only remove/truncate/flag corrections — no move/swap (too risky).
 *
 * Feature flag: PIPELINE_LLM_REVIEW=on (default: off)
 */

import type { TripDay, TripItem } from '../types';
import type { TripPreferences } from '../types';
import type { DayTimeWindow } from './step4-anchor-transport';
import { fetchGeminiWithRetry } from '../services/geminiSearch';

// ============================================
// Types
// ============================================

export interface LLMCorrection {
  type: 'remove' | 'truncate' | 'flag';
  dayNumber: number;
  itemId?: string;
  newDuration?: number;
  description: string;
  severity: 'error' | 'warning';
  reason: string;
}

export interface LLMReviewResult {
  corrections: LLMCorrection[];
  confidence: number;
  reviewSummary: string;
}

// ============================================
// Main Function
// ============================================

export async function llmReviewTrip(
  days: TripDay[],
  preferences: TripPreferences,
  timeWindows: DayTimeWindow[],
): Promise<LLMReviewResult> {
  const schedule = buildCompactSchedule(days, timeWindows);
  const prompt = buildReviewPrompt(schedule, preferences);

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    }, 3, 'step13_review');

    if (!response.ok) {
      console.warn(`[LLM Review] API returned ${response.status} — skipping review`);
      return { corrections: [], confidence: 0, reviewSummary: 'API error' };
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Extract text from all parts
    const text = parts.map((p: any) => p.text || '').join('').trim();
    if (!text) {
      console.warn('[LLM Review] Empty response — skipping review');
      return { corrections: [], confidence: 0, reviewSummary: 'Empty response' };
    }

    // Try to parse as the expected object format
    let parsed = extractJson<LLMReviewResult>(text);

    // Handle case where LLM returns just an array of corrections
    if (!parsed) {
      const arr = extractJson<LLMCorrection[]>(text);
      if (Array.isArray(arr)) {
        parsed = { corrections: arr, confidence: 0.7, reviewSummary: 'Parsed from array' };
      }
    }

    if (!parsed) {
      console.warn('[LLM Review] Could not extract valid JSON from response');
      console.warn('[LLM Review] Raw text (first 500 chars):', text.substring(0, 500));
      return { corrections: [], confidence: 0, reviewSummary: 'Parse error' };
    }

    // Normalize corrections array
    if (!Array.isArray(parsed.corrections)) parsed.corrections = [];
    parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    parsed.reviewSummary = parsed.reviewSummary || '';

    console.log(`[LLM Review] ${parsed.corrections.length} corrections, confidence: ${parsed.confidence}`);
    for (const c of parsed.corrections) {
      console.log(`  [${c.severity}] Day ${c.dayNumber}: ${c.description} — ${c.reason}`);
    }

    return parsed;
  } catch (e) {
    console.warn('[LLM Review] Failed:', e);
    return { corrections: [], confidence: 0, reviewSummary: 'Error' };
  }
}

// ============================================
// Apply Corrections
// ============================================

export function applyLLMCorrections(days: TripDay[], corrections: LLMCorrection[]): { applied: number; warnings: string[] } {
  let applied = 0;
  const warnings: string[] = [];

  for (const correction of corrections) {
    const day = days.find(d => d.dayNumber === correction.dayNumber);

    // Log warnings but don't apply them
    if (correction.severity === 'warning') {
      const msg = `Day ${correction.dayNumber}: ${correction.description}`;
      warnings.push(msg);
      console.log(`[LLM Review] Warning: ${msg}`);
      continue;
    }

    if (!day) {
      console.warn(`[LLM Review] Day ${correction.dayNumber} not found — skipping correction`);
      continue;
    }

    // Find item by ID or by title substring (LLM may not return exact UUID)
    const findItem = (itemId?: string): { item: TripItem; idx: number } | null => {
      if (!itemId) return null;
      // Try exact ID match first
      const idxById = day.items.findIndex(i => i.id === itemId);
      if (idxById !== -1) return { item: day.items[idxById], idx: idxById };
      // Fallback: match by title substring (LLM may reference by name)
      const normalized = itemId.toLowerCase();
      const idxByTitle = day.items.findIndex(i =>
        i.title?.toLowerCase().includes(normalized) || normalized.includes(i.title?.toLowerCase() || '___')
      );
      if (idxByTitle !== -1) return { item: day.items[idxByTitle], idx: idxByTitle };
      return null;
    };

    if (correction.type === 'remove') {
      const found = findItem(correction.itemId);
      if (found) {
        console.log(`[LLM Review] Removing "${found.item.title}" from Day ${day.dayNumber}: ${correction.reason}`);
        day.items.splice(found.idx, 1);
        day.items.forEach((item, i) => { item.orderIndex = i; });
        applied++;
      } else {
        console.warn(`[LLM Review] Item "${correction.itemId}" not found on Day ${day.dayNumber}`);
      }
    } else if (correction.type === 'truncate' && correction.newDuration) {
      const found = findItem(correction.itemId);
      if (found?.item.startTime) {
        const startMin = timeToMin(found.item.startTime);
        found.item.duration = correction.newDuration;
        found.item.endTime = minToTime(startMin + correction.newDuration);
        console.log(`[LLM Review] Truncated "${found.item.title}" to ${correction.newDuration}min: ${correction.reason}`);
        applied++;
      }
    } else if (correction.type === 'flag') {
      warnings.push(`Day ${day.dayNumber}: ${correction.description}`);
    }
  }

  return { applied, warnings };
}

// ============================================
// Prompt Builder
// ============================================

interface CompactDay {
  day: number;
  date: string;
  transitOnly: boolean;
  window: string;
  items: Array<{
    id: string;
    time: string;
    type: string;
    title: string;
    duration: number;
  }>;
}

function buildCompactSchedule(days: TripDay[], timeWindows: DayTimeWindow[]): CompactDay[] {
  return days.map(day => {
    const tw = timeWindows.find(w => w.dayNumber === day.dayNumber);
    return {
      day: day.dayNumber,
      date: day.date instanceof Date ? day.date.toISOString().split('T')[0] : String(day.date || ''),
      transitOnly: !!(day as any).isTransitOnly,
      window: tw ? `${tw.activityStartTime}-${tw.activityEndTime}` : '08:30-22:00',
      items: day.items.map(item => ({
        id: item.id,
        time: `${item.startTime}-${item.endTime}`,
        type: item.type,
        title: item.title,
        duration: item.duration || 0,
      })),
    };
  });
}

function buildReviewPrompt(schedule: CompactDay[], preferences: TripPreferences): string {
  return `Tu es un expert en planification de voyages. Analyse cet itinéraire et signale les incohérences logiques.

ITINÉRAIRE:
${JSON.stringify(schedule, null, 1)}

CONTEXTE:
- Origine: ${preferences.origin}
- Destination: ${preferences.destination}
- Durée: ${preferences.durationDays} jours
- Groupe: ${preferences.groupSize} personnes (${preferences.groupType})

RÈGLES À VÉRIFIER:
1. Aucune activité avant l'arrivée du vol (le vol est le premier item, les activités ne peuvent PAS le précéder)
2. Aucune activité qui déborde après le vol de retour
3. Les jours "transitOnly" ne doivent avoir AUCUNE activité/restaurant
4. Chaque jour plein doit avoir au moins un déjeuner et un dîner réels (pas "Repas libre" partout)
5. Pas de gap > 3h sans activité ni repas sur un jour plein
6. Pas d'activité de plus de 3h le jour du départ (avant le vol)
7. Les horaires doivent être réalistes (pas d'activité à 06:00 si le vol arrive à 07:00)
8. L'ordre chronologique des items doit être cohérent (startTime croissant)

Réponds en JSON avec ce format exact:
{
  "corrections": [
    {
      "type": "remove" | "truncate" | "flag",
      "dayNumber": number,
      "itemId": "id de l'item (pour remove/truncate)" | null,
      "newDuration": number | null,
      "description": "description courte du problème",
      "severity": "error" | "warning",
      "reason": "explication"
    }
  ],
  "confidence": 0.0 à 1.0,
  "reviewSummary": "résumé en 1 phrase"
}

Si l'itinéraire est bon, renvoie un tableau corrections vide avec confidence élevée.
Ne signale que les vrais problèmes logiques, pas les préférences subjectives.`;
}

// ============================================
// Helpers
// ============================================

/**
 * Extract JSON from LLM response that may contain markdown fences,
 * thinking tokens, or other wrapper text.
 */
function extractJson<T>(text: string): T | null {
  // 1. Try direct parse
  try { return JSON.parse(text) as T; } catch { /* continue */ }

  // 2. Try extracting from ```json ... ``` markdown fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) as T; } catch { /* continue */ }
  }

  // 3. Try finding first { ... } block (object)
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(text.substring(braceStart, braceEnd + 1)) as T; } catch { /* continue */ }
  }

  // 4. Try finding first [ ... ] block (array)
  const bracketStart = text.indexOf('[');
  const bracketEnd = text.lastIndexOf(']');
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    try { return JSON.parse(text.substring(bracketStart, bracketEnd + 1)) as T; } catch { /* continue */ }
  }

  return null;
}

function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToTime(min: number): string {
  const h = Math.floor(Math.min(min, 23 * 60 + 59) / 60);
  const m = Math.min(min, 23 * 60 + 59) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
