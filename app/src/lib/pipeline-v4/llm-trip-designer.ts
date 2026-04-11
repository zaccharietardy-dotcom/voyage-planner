/**
 * Pipeline V4 — Step 1: LLM Trip Designer
 *
 * Gemini 3 Flash designs the complete trip.
 * Returns structured JSON with hubs, activities, restaurants, bars, drives.
 */

import type { TripPreferences } from '../types';
import type { LLMTripDesign } from './types';
import { fetchGeminiWithRetry } from '../services/geminiSearch';
import { trackEstimatedCost } from '../services/apiCostGuard';
import { GROUP_TYPE_LABELS, ACTIVITY_LABELS, BUDGET_LABELS } from '../types';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(preferences: TripPreferences): string {
  const destination = preferences.destination || 'Europe';
  const origin = preferences.origin || 'Paris';
  const days = preferences.durationDays || 3;
  const transport = preferences.transport || 'car';
  const groupSize = preferences.groupSize || 2;
  const groupType = GROUP_TYPE_LABELS[preferences.groupType] || preferences.groupType || 'amis';
  const budget = BUDGET_LABELS[preferences.budgetLevel as keyof typeof BUDGET_LABELS]?.label || preferences.budgetLevel || 'modéré';
  const activities = (preferences.activities || [])
    .map(a => ACTIVITY_LABELS[a] || a)
    .join(', ') || 'culture, nature, gastronomie';
  const mustSee = preferences.mustSee?.trim() || '';
  const startDate = preferences.startDate
    ? new Date(preferences.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return `Tu es un expert voyage reconnu. Planifie un voyage de ${days} jours en ${destination}.
Départ de ${origin} en ${transport}. ${startDate ? `Date de départ : ${startDate}.` : ''}
Groupe : ${groupSize} personnes (${groupType}). Budget : ${budget}.
Centres d'intérêt : ${activities}.
${mustSee ? `Incontournables demandés : ${mustSee}.` : ''}

RÈGLES STRICTES :
1. Circuit logique sans zigzag (progression géographique cohérente)
2. 1 hub/ville de base par nuit (ou 2 jours si la ville le mérite)
3. UNIQUEMENT des noms RÉELS de restaurants, bars, activités (vérifiables sur Google Maps)
4. Adresses RÉELLES et complètes
5. Horaires réalistes (activités 9h-18h, déjeuner 12h-14h, dîner 19h-21h)
6. Budget ${budget} : adapter le standing des restaurants et activités
7. Jour 1 : intégrer le trajet depuis ${origin} (arrivée réaliste)
8. Dernier jour : prévoir le retour vers ${origin} en fin de journée
9. Pour CHAQUE item : un "tip" contextuel prudent (1 phrase, pas de faits non vérifiables)
10. Pour CHAQUE jour : "theme" (titre évocateur 8-12 mots) + "narrative" (2 phrases immersives)
11. Chaque jour DOIT avoir un déjeuner ET un dîner (vrai restaurant, pas "repas libre")
12. Petit-déjeuner optionnel (café/boulangerie locale recommandée)

Réponds UNIQUEMENT en JSON valide :
{
  "hubs": [
    { "day": 1, "city": "Nom de la ville", "sleepHere": true }
  ],
  "days": [
    {
      "day": 1,
      "hub": "Nom de la ville",
      "theme": "Titre évocateur du jour",
      "narrative": "Deux phrases immersives décrivant l'arc de la journée.",
      "items": [
        {
          "type": "activity",
          "name": "Nom réel vérifiable Google Maps",
          "address": "Adresse complète avec code postal",
          "startTime": "10:00",
          "duration": 60,
          "estimatedCost": 15,
          "tip": "Conseil contextuel prudent"
        },
        {
          "type": "restaurant",
          "name": "Nom réel du restaurant",
          "address": "Adresse complète",
          "startTime": "12:30",
          "duration": 75,
          "estimatedCost": 25,
          "tip": "Spécialité ou ambiance",
          "mealType": "lunch"
        }
      ],
      "drives": [
        { "from": "Ville A", "to": "Ville B", "distanceKm": 90, "durationMin": 75 }
      ]
    }
  ]
}`;
}

function buildRepairPrompt(invalidJson: string): string {
  return `Le JSON ci-dessous est invalide. Corrige-le en JSON STRICTEMENT valide.
Ne change pas le contenu, corrige uniquement le format.

JSON à réparer :
${invalidJson.slice(0, 3000)}

Réponds UNIQUEMENT avec le JSON corrigé, rien d'autre.`;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJson(raw: string): LLMTripDesign | null {
  const trimmed = raw.trim();

  // Try direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // Try fenced code block
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }

  // Try extracting first { ... } block
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* continue */ }
  }

  return null;
}

function validateDesign(design: LLMTripDesign, expectedDays: number): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!Array.isArray(design.days) || design.days.length === 0) {
    issues.push('no_days');
  }
  if (!Array.isArray(design.hubs) || design.hubs.length === 0) {
    issues.push('no_hubs');
  }
  if (design.days?.length !== expectedDays) {
    issues.push(`day_count_mismatch:${design.days?.length}/${expectedDays}`);
  }

  for (const day of design.days || []) {
    if (!day.hub || !day.theme) {
      issues.push(`day_${day.day}_missing_hub_or_theme`);
    }
    if (!Array.isArray(day.items) || day.items.length === 0) {
      issues.push(`day_${day.day}_no_items`);
    }
    const hasLunch = day.items?.some(i => i.mealType === 'lunch');
    const hasDinner = day.items?.some(i => i.mealType === 'dinner');
    if (!hasLunch && !hasDinner) {
      issues.push(`day_${day.day}_no_meals`);
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function designTrip(
  preferences: TripPreferences,
  onProgress?: (label: string) => void,
): Promise<{ design: LLMTripDesign; latencyMs: number; parseAttempts: number }> {
  const t0 = Date.now();
  let parseAttempts = 0;

  const prompt = buildPrompt(preferences);
  trackEstimatedCost('v4_llm_designer', 0.005);
  onProgress?.('LLM designing trip...');

  // First attempt
  parseAttempts++;
  const response = await fetchGeminiWithRetry({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 5000,
    },
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let design = extractJson(rawText);

  // Repair attempt if first parse failed
  if (!design && rawText.length > 50) {
    parseAttempts++;
    onProgress?.('Repairing LLM response...');
    const repairPrompt = buildRepairPrompt(rawText);
    const repairResponse = await fetchGeminiWithRetry({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: repairPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 5000,
      },
    });

    if (repairResponse.ok) {
      const repairData = await repairResponse.json();
      const repairText = repairData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      design = extractJson(repairText);
    }
  }

  if (!design) {
    throw new Error('LLM returned invalid JSON after repair attempt');
  }

  // Validate structure
  const validation = validateDesign(design, preferences.durationDays);
  if (!validation.ok) {
    console.warn('[V4 Designer] Validation issues:', validation.issues.join(', '));
    // Don't throw — partial results are better than nothing
  }

  return {
    design,
    latencyMs: Date.now() - t0,
    parseAttempts,
  };
}
