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
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[LLM Review] API returned ${response.status} — skipping review`);
      return { corrections: [], confidence: 0, reviewSummary: 'API error' };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[LLM Review] Empty response — skipping review');
      return { corrections: [], confidence: 0, reviewSummary: 'Empty response' };
    }

    const parsed = JSON.parse(text) as LLMReviewResult;
    console.log(`[LLM Review] ${parsed.corrections.length} corrections, confidence: ${parsed.confidence}`);
    for (const c of parsed.corrections) {
      console.log(`  [${c.severity}] Day ${c.dayNumber}: ${c.description} — ${c.reason}`);
    }

    return parsed;
  } catch (e) {
    console.warn('[LLM Review] Failed to parse response:', e);
    return { corrections: [], confidence: 0, reviewSummary: 'Parse error' };
  }
}

// ============================================
// Apply Corrections
// ============================================

export function applyLLMCorrections(days: TripDay[], corrections: LLMCorrection[]): number {
  let applied = 0;

  for (const correction of corrections) {
    if (correction.severity !== 'error') continue; // Only apply errors, log warnings

    const day = days.find(d => d.dayNumber === correction.dayNumber);
    if (!day) continue;

    if (correction.type === 'remove' && correction.itemId) {
      const idx = day.items.findIndex(i => i.id === correction.itemId);
      if (idx !== -1) {
        console.log(`[LLM Review] Removing "${day.items[idx].title}" from Day ${day.dayNumber}: ${correction.reason}`);
        day.items.splice(idx, 1);
        day.items.forEach((item, i) => { item.orderIndex = i; });
        applied++;
      }
    } else if (correction.type === 'truncate' && correction.itemId && correction.newDuration) {
      const item = day.items.find(i => i.id === correction.itemId);
      if (item && item.startTime) {
        const startMin = timeToMin(item.startTime);
        item.duration = correction.newDuration;
        item.endTime = minToTime(startMin + correction.newDuration);
        console.log(`[LLM Review] Truncated "${item.title}" to ${correction.newDuration}min: ${correction.reason}`);
        applied++;
      }
    }
  }

  return applied;
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

function timeToMin(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToTime(min: number): string {
  const h = Math.floor(Math.min(min, 23 * 60 + 59) / 60);
  const m = Math.min(min, 23 * 60 + 59) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
