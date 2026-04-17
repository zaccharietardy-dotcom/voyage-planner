/**
 * Pipeline V4 — Step 1: LLM Trip Designer
 *
 * Gemini designs the complete trip.
 * In "classic" mode (no catalog), the LLM invents place names.
 * In "catalog" mode, the LLM picks aliases from a pre-fetched Google Places catalog,
 * which guarantees that every selected place exists (grounding rate ~100%).
 */

import type { TripPreferences } from '../types';
import type { LLMTripDesign, LLMTripItem } from './types';
import type { Catalog, CatalogEntry } from './catalog-types';
import { fetchGeminiWithRetry } from '../services/geminiSearch';
import { trackEstimatedCost } from '../services/apiCostGuard';
import { GROUP_TYPE_LABELS, ACTIVITY_LABELS, BUDGET_LABELS } from '../types';

function formatPreferencesHeader(preferences: TripPreferences): string {
  const destination = preferences.destination || 'Europe';
  const origin = preferences.origin || 'Paris';
  const days = preferences.durationDays || 3;
  const transport = preferences.transport || 'car';
  const groupSize = preferences.groupSize || 2;
  const groupType = GROUP_TYPE_LABELS[preferences.groupType] || preferences.groupType || 'amis';
  const budget = BUDGET_LABELS[preferences.budgetLevel as keyof typeof BUDGET_LABELS]?.label || preferences.budgetLevel || 'modéré';
  const travelStyle = preferences.travelStyle || 'auto';
  const hotelStayPolicy = preferences.hotelStayPolicy || 'balanced';
  const cityPlan = Array.isArray(preferences.cityPlan) && preferences.cityPlan.length > 0
    ? preferences.cityPlan.map((stage) => `${stage.city} (${stage.days} jours)`).join(' → ')
    : '';
  const activities = (preferences.activities || [])
    .map((a) => ACTIVITY_LABELS[a] || a)
    .join(', ') || 'culture, nature, gastronomie';
  const mustSee = preferences.mustSee?.trim() || '';
  const startDate = preferences.startDate
    ? new Date(preferences.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  return `Planifie un voyage de ${days} jours en ${destination}.
Départ de ${origin} en ${transport}. ${startDate ? `Date de départ : ${startDate}.` : ''}
Groupe : ${groupSize} personnes (${groupType}). Budget : ${budget}.
Centres d'intérêt : ${activities}.
Style de voyage: ${travelStyle}.
Politique hôtel: ${hotelStayPolicy}.
${cityPlan ? `Répartition villes/nuits imposée: ${cityPlan}.` : ''}
${mustSee ? `Incontournables demandés : ${mustSee}.` : ''}`;
}

function buildClassicPrompt(preferences: TripPreferences): string {
  const header = formatPreferencesHeader(preferences);
  const origin = preferences.origin || 'Paris';
  const budget = BUDGET_LABELS[preferences.budgetLevel as keyof typeof BUDGET_LABELS]?.label || preferences.budgetLevel || 'modéré';

  return `Tu es un expert voyage reconnu. ${header}

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
13. Si "Répartition villes/nuits imposée" est fournie, respecte-la EXACTEMENT
14. Si style=single_base, propose UNE SEULE ville hub pour tous les jours
15. Si politique hôtel=minimize_changes, évite les changements quotidiens de logement (minimum 2 nuits/hôtel quand possible)

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

// ---------------------------------------------------------------------------
// Catalog mode — compact entry packing
// ---------------------------------------------------------------------------

function compactCatalogEntry(entry: CatalogEntry): Record<string, unknown> {
  const { alias, name, coords, rating, userRatingCount, priceLevel, cuisines, mealSuitable, openingHoursByDay, subtype } = entry;
  const out: Record<string, unknown> = {
    id: alias,
    n: name,
    lat: Number(coords.lat.toFixed(4)),
    lng: Number(coords.lng.toFixed(4)),
  };
  if (rating != null) out.r = rating;
  if (userRatingCount != null) out.rv = userRatingCount;
  if (priceLevel != null) out.p = priceLevel;
  if (cuisines?.length) out.c = cuisines.join('/');
  if (mealSuitable?.length) out.m = mealSuitable.join('/');
  if (subtype) out.t = subtype;
  if (openingHoursByDay) {
    const oh: Record<string, string> = {};
    for (const [day, hours] of Object.entries(openingHoursByDay)) {
      if (hours) oh[day.slice(0, 3)] = `${hours.open}-${hours.close}`;
    }
    if (Object.keys(oh).length > 0) out.oh = oh;
  }
  return out;
}

const PROMPT_TOP_N = {
  attractions: 30,
  restaurants: 25,
  breakfast: 8,
  bars: 6,
} as const;

function packCatalog(catalog: Catalog): string {
  const cities: Record<string, unknown> = {};
  for (const cityCatalog of Object.values(catalog)) {
    cities[cityCatalog.city] = {
      attractions: cityCatalog.attractions.slice(0, PROMPT_TOP_N.attractions).map(compactCatalogEntry),
      restaurants: cityCatalog.restaurants.slice(0, PROMPT_TOP_N.restaurants).map(compactCatalogEntry),
      breakfast: cityCatalog.breakfast.slice(0, PROMPT_TOP_N.breakfast).map(compactCatalogEntry),
      bars: cityCatalog.bars.slice(0, PROMPT_TOP_N.bars).map(compactCatalogEntry),
    };
  }
  return JSON.stringify(cities);
}

function buildCatalogPrompt(preferences: TripPreferences, catalog: Catalog): string {
  const header = formatPreferencesHeader(preferences);
  const origin = preferences.origin || 'Paris';
  const budget = BUDGET_LABELS[preferences.budgetLevel as keyof typeof BUDGET_LABELS]?.label || preferences.budgetLevel || 'modéré';
  const catalogJson = packCatalog(catalog);

  return `Tu es un expert voyage reconnu. ${header}

CATALOGUE (entrées réelles Google Places — tu ne dois citer QUE des \`id\` listés ici) :
${catalogJson}

Légende des clés : id=alias, n=nom, lat/lng=coords, r=rating/5, rv=nb avis, p=niveau prix 0-4, c=cuisines, m=mealSuitable (breakfast/lunch/dinner), t=sous-type (museum/park/etc), oh=horaires par jour (sun/mon/…).

RÈGLES STRICTES :
1. Circuit logique sans zigzag (progression géographique cohérente)
2. Tous les \`alias\` retournés DOIVENT exister dans le catalogue ci-dessus — tout alias inconnu invalide la réponse
3. 1 hub/ville de base par nuit (ou 2 jours si la ville le mérite)
4. Horaires réalistes (activités 9h-18h, déjeuner 12h-14h, dîner 19h-21h), respecte \`oh\` si fourni
5. Budget ${budget} : privilégie les p adaptés au budget
6. Jour 1 : intégrer un trajet depuis ${origin} (arrivée réaliste)
7. Dernier jour : prévoir le retour vers ${origin} en fin de journée
8. Pour CHAQUE item : un "tip" contextuel prudent (1 phrase), pas de faits non vérifiables
9. Pour CHAQUE jour : "theme" (titre 8-12 mots) + "narrative" (2 phrases immersives)
10. Chaque jour DOIT avoir un déjeuner ET un dîner (restaurant du catalogue, mealType adapté à \`m\`)
11. Petit-déjeuner optionnel (préférer une entrée breakfast du catalogue)
12. Diversité cuisines entre déjeuner et dîner (familles \`c\` différentes quand possible)
13. Si cityPlan fourni, respecte-le EXACTEMENT
14. Si style=single_base, propose UNE SEULE ville hub pour tous les jours
15. Si politique hôtel=minimize_changes, minimum 2 nuits/hôtel quand possible

Réponds UNIQUEMENT en JSON valide — chaque item cite un \`alias\` du catalogue, pas de name/address :
{
  "hubs": [
    { "day": 1, "city": "Nom de la ville du catalogue", "sleepHere": true }
  ],
  "days": [
    {
      "day": 1,
      "hub": "Nom de la ville",
      "theme": "Titre évocateur",
      "narrative": "Deux phrases immersives.",
      "items": [
        { "type": "activity", "alias": "a3", "startTime": "10:00", "duration": 90, "estimatedCost": 15, "tip": "Conseil prudent" },
        { "type": "restaurant", "alias": "r5", "startTime": "12:30", "duration": 75, "estimatedCost": 25, "mealType": "lunch", "tip": "Spécialité" }
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
// JSON extraction & post-processing
// ---------------------------------------------------------------------------

interface RawDesign {
  hubs?: LLMTripDesign['hubs'];
  days?: Array<{
    day?: number;
    hub?: string;
    theme?: string;
    narrative?: string;
    items?: Array<Record<string, unknown>>;
    drives?: LLMTripDesign['days'][number]['drives'];
  }>;
}

function extractJson(raw: string): RawDesign | null {
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
}

function resolveAliasedDesign(raw: RawDesign, catalog: Catalog | undefined): LLMTripDesign {
  const aliasMap = new Map<string, CatalogEntry>();
  if (catalog) {
    for (const city of Object.values(catalog)) {
      for (const entry of [...city.attractions, ...city.restaurants, ...city.breakfast, ...city.bars]) {
        aliasMap.set(entry.alias, entry);
      }
    }
  }

  const days: LLMTripDesign['days'] = (raw.days || []).map((day) => {
    const items: LLMTripItem[] = [];
    for (const rawItem of day.items || []) {
      const alias = typeof rawItem.alias === 'string' ? rawItem.alias : undefined;
      const explicitName = typeof rawItem.name === 'string' ? rawItem.name : undefined;
      let name = explicitName || '';
      let address = typeof rawItem.address === 'string' ? rawItem.address : undefined;

      if (alias && aliasMap.has(alias)) {
        const entry = aliasMap.get(alias)!;
        name = entry.name;
        address = entry.address || address;
      } else if (alias && catalog) {
        // Catalog mode but alias unknown — drop this item (LLM hallucinated).
        console.warn(`[V4 Designer] Dropping item with unknown alias "${alias}"`);
        continue;
      }

      if (!name) {
        // Neither alias nor name present → skip
        continue;
      }

      const type = (rawItem.type === 'restaurant' || rawItem.type === 'bar') ? rawItem.type : 'activity';
      items.push({
        type,
        name,
        address,
        startTime: typeof rawItem.startTime === 'string' ? rawItem.startTime : '10:00',
        duration: typeof rawItem.duration === 'number' ? rawItem.duration : 60,
        estimatedCost: typeof rawItem.estimatedCost === 'number' ? rawItem.estimatedCost : undefined,
        tip: typeof rawItem.tip === 'string' ? rawItem.tip : undefined,
        mealType: rawItem.mealType === 'breakfast' || rawItem.mealType === 'lunch' || rawItem.mealType === 'dinner'
          ? rawItem.mealType
          : undefined,
        catalogAlias: alias,
      });
    }

    return {
      day: day.day ?? 1,
      hub: day.hub ?? '',
      theme: day.theme ?? '',
      narrative: day.narrative ?? '',
      items,
      drives: day.drives || [],
    };
  });

  return {
    hubs: raw.hubs || [],
    days,
  };
}

function validateDesign(design: LLMTripDesign, expectedDays: number): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(design.days) || design.days.length === 0) issues.push('no_days');
  if (!Array.isArray(design.hubs) || design.hubs.length === 0) issues.push('no_hubs');
  if (design.days?.length !== expectedDays) issues.push(`day_count_mismatch:${design.days?.length}/${expectedDays}`);

  for (const day of design.days || []) {
    if (!day.hub || !day.theme) issues.push(`day_${day.day}_missing_hub_or_theme`);
    if (!Array.isArray(day.items) || day.items.length === 0) issues.push(`day_${day.day}_no_items`);
    const hasLunch = day.items?.some((i) => i.mealType === 'lunch');
    const hasDinner = day.items?.some((i) => i.mealType === 'dinner');
    if (!hasLunch && !hasDinner) issues.push(`day_${day.day}_no_meals`);
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function designTrip(
  preferences: TripPreferences,
  onProgress?: (label: string) => void,
  catalog?: Catalog,
): Promise<{ design: LLMTripDesign; latencyMs: number; parseAttempts: number }> {
  const t0 = Date.now();
  let parseAttempts = 0;
  const useCatalog = catalog && Object.keys(catalog).length > 0;

  const prompt = useCatalog ? buildCatalogPrompt(preferences, catalog!) : buildClassicPrompt(preferences);
  trackEstimatedCost('v4_llm_designer', useCatalog ? 0.008 : 0.005);
  onProgress?.(useCatalog ? 'LLM designing trip from catalog...' : 'LLM designing trip...');

  parseAttempts++;
  const response = await fetchGeminiWithRetry(
    {
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: useCatalog ? 8000 : 5000,
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    },
    3,
    useCatalog ? 'v4_designer_catalog' : 'v4_designer',
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let rawDesign = extractJson(rawText);

  if (!rawDesign && rawText.length > 50) {
    parseAttempts++;
    onProgress?.('Repairing LLM response...');
    const repairPrompt = buildRepairPrompt(rawText);
    const repairResponse = await fetchGeminiWithRetry(
      {
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: repairPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: useCatalog ? 8000 : 5000,
          thinkingConfig: { thinkingBudget: 0 },
        } as any,
      },
      3,
      'v4_repair',
    );

    if (repairResponse.ok) {
      const repairData = await repairResponse.json();
      const repairText = repairData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawDesign = extractJson(repairText);
    }
  }

  if (!rawDesign) {
    throw new Error('LLM returned invalid JSON after repair attempt');
  }

  const design = resolveAliasedDesign(rawDesign, catalog);

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
