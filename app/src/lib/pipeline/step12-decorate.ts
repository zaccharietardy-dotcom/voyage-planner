/**
 * Pipeline V3 — Step 12: Decorate with LLM (Optional)
 *
 * Adds day themes and narrative descriptions to the trip plan.
 * OFF by default (PIPELINE_LLM_DECOR=off).
 * Falls back to template-based themes if LLM fails.
 *
 * This is purely cosmetic — it does NOT modify activities, times, or restaurants.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TripDay, TripItem } from '../types';

// ============================================
// Types
// ============================================

export interface DecorationResult {
  days: TripDay[];
  usedLLM: boolean;
  /** Time spent on LLM call (ms), 0 if template-only */
  llmDurationMs: number;
}

// ============================================
// Template-based decoration (fallback)
// ============================================

/** Generate a theme based on the dominant activity types in a day */
function generateTemplateTheme(items: TripItem[], dayNumber: number, totalDays: number): string {
  const activityItems = items.filter(i => i.type === 'activity');
  if (activityItems.length === 0) return 'Journée de détente';

  const names = activityItems.map(i => (i.title || '').toLowerCase()).join(' ');
  const types = activityItems.map(i => ((i as any).activityType || '').toLowerCase()).join(' ');
  const allText = `${names} ${types}`;

  // Detect dominant theme
  if (/museum|musée|museo|gallery|galerie|galleria/i.test(allText)) {
    return 'Art et culture';
  }
  if (/park|parc|garden|jardin|botanical|zoo|aquarium/i.test(allText)) {
    return 'Nature et découverte';
  }
  if (/church|église|cathedral|cathédrale|basilica|temple|mosque/i.test(allText)) {
    return 'Patrimoine historique';
  }
  if (/palace|palais|castle|château|fort/i.test(allText)) {
    return 'Palais et monuments';
  }
  if (/market|marché|food|gastronomie|cooking/i.test(allText)) {
    return 'Saveurs locales';
  }
  if (/viewpoint|belvedere|panorama|tower|tour/i.test(allText)) {
    return 'Panoramas et vues';
  }
  if (/beach|plage|coast|côte|waterfront|port/i.test(allText)) {
    return 'Bord de mer';
  }
  if (/shopping|mall|boutique|marché aux puces/i.test(allText)) {
    return 'Shopping et flânerie';
  }
  if (/nightlife|bar|club|jazz|concert|show/i.test(allText)) {
    return 'Soirée en ville';
  }

  // Generic themes by day position
  if (dayNumber === 1) return 'Première découverte';
  if (dayNumber === totalDays) return 'Dernière journée';
  return 'Découverte locale';
}

/** Generate a narrative blurb from the activity list */
function generateTemplateNarrative(items: TripItem[], theme: string): string {
  const activityItems = items.filter(i => i.type === 'activity');
  if (activityItems.length === 0) return '';

  const highlights = activityItems
    .slice(0, 3)
    .map(i => i.title)
    .filter(Boolean);

  if (highlights.length === 0) return '';

  if (highlights.length === 1) {
    return `Journée centrée sur ${highlights[0]}.`;
  }

  const last = highlights.pop();
  return `Découvrez ${highlights.join(', ')} puis ${last}.`;
}

// ============================================
// Main Function
// ============================================

/**
 * Decorate trip days with themes and narratives.
 *
 * @param days - Trip days to decorate (NOT modified in place — returns new array)
 * @param destination - Trip destination name (for LLM context)
 * @param useLLM - Whether to use LLM for decoration (default: false)
 * @returns Decorated days + metadata
 */
export async function decorateTrip(
  days: TripDay[],
  destination: string,
  useLLM: boolean = false
): Promise<DecorationResult> {
  const totalDays = days.length;

  // Template decoration (always runs as baseline or fallback)
  const decoratedDays = days.map(day => {
    const theme = day.theme || generateTemplateTheme(day.items, day.dayNumber, totalDays);
    const narrative = day.dayNarrative || generateTemplateNarrative(day.items, theme);

    return {
      ...day,
      theme,
      dayNarrative: narrative,
    };
  });

  if (!useLLM) {
    return {
      days: decoratedDays,
      usedLLM: false,
      llmDurationMs: 0,
    };
  }

  // LLM decoration (optional enhancement)
  const startTime = Date.now();
  try {
    const llmResult = await decorateWithLLM(decoratedDays, destination);
    const llmDuration = Date.now() - startTime;

    if (llmResult) {
      return {
        days: llmResult,
        usedLLM: true,
        llmDurationMs: llmDuration,
      };
    }
  } catch (err) {
    console.warn(`[Decorate] LLM decoration failed, using templates: ${err}`);
  }

  return {
    days: decoratedDays,
    usedLLM: false,
    llmDurationMs: Date.now() - startTime,
  };
}

// ============================================
// LLM Decoration (optional)
// ============================================

async function decorateWithLLM(
  days: TripDay[],
  destination: string
): Promise<TripDay[] | null> {
  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[Decorate] No ANTHROPIC_API_KEY, skipping LLM decoration');
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const dayDescriptions = days.map(day => {
      const activities = day.items
        .filter(i => i.type === 'activity')
        .map(i => i.title)
        .join(', ');
      return `Day ${day.dayNumber}: ${activities || '(no activities)'}`;
    }).join('\n');

    const prompt = `You are a travel writer. For a trip to ${destination}, create a short theme (2-4 words) and a one-sentence narrative for each day. Keep it evocative and helpful.

Days:
${dayDescriptions}

Respond in JSON format:
[
  {"dayNumber": 1, "theme": "...", "narrative": "..."},
  ...
]`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    if (!response.content || response.content.length === 0) {
      return null;
    }

    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }

    const responseText = textContent.text;

    // Parse response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ dayNumber: number; theme: string; narrative: string }>;

    // Merge LLM themes/narratives into days
    return days.map(day => {
      const llmDay = parsed.find(d => d.dayNumber === day.dayNumber);
      if (llmDay) {
        return {
          ...day,
          theme: llmDay.theme || day.theme,
          dayNarrative: llmDay.narrative || day.dayNarrative,
        };
      }
      return day;
    });
  } catch (err) {
    console.warn(`[Decorate] LLM call failed: ${err}`);
    return null;
  }
}
