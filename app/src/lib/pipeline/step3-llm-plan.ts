/**
 * Pipeline V2 — Step 3: LLM Planning (Claude / Gemini)
 *
 * Ce module utilise un LLM (Claude Sonnet ou Gemini Flash) pour créer un itinéraire
 * jour par jour intelligent basé sur les activités scorées, les restaurants disponibles,
 * et les contraintes du voyage.
 *
 * Modèles supportés:
 * - claude-sonnet-4-6   (~$0.14/gen, 50-60s)
 * - gemini-2.5-flash    (~$0.017/gen, 20-40s)
 *
 * Configurable via env: LLM_PLANNER_MODEL=gemini-2.5-flash (default: claude-sonnet-4-6)
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMPlannerInput,
  LLMPlannerOutput,
  LLMDayPlan,
  LLMDayItem,
} from './types';

// ============================================
// Gemini API types
// ============================================

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message?: string;
    code?: number;
  };
}

// ============================================
// Constants
// ============================================

const SYSTEM_PROMPT = `Tu es un expert en planification de voyages. Tu reçois des données structurées sur une destination (activités, restaurants, hôtel, distances, météo) et tu dois créer un itinéraire jour par jour optimal.

RÈGLES ABSOLUES :
1. N'utilise QUE les activités et restaurants fournis dans les listes (référence par "id" exact)
2. N'invente AUCUNE activité, restaurant, ou lieu — utilise uniquement les IDs fournis
3. Tous les must-see (mustSee: true) DOIVENT être planifiés — c'est non-négociable
4. Respecte les horaires d'ouverture (openingHours) — ne programme JAMAIS une visite quand c'est fermé
5. Minimise les distances à pied entre items consécutifs — utilise la matrice de distances fournie
6. Durées réalistes : grands musées 90-120min, monuments/églises 45-75min, parcs/quartiers 45-60min, points de vue 30-45min
7. Restaurants PROXIMITÉ STRICTE : petit-déjeuner < 1.2km de l'hôtel, déjeuner/dîner < 500m de l'activité précédente ou suivante. VÉRIFIE dans la matrice de distances que le restaurant est proche ! Si aucun restaurant n'est assez proche, choisis celui le plus proche dans la matrice.
8. Diversité cuisine : pas 2 restaurants du même type de cuisine sur le trip
9. Jour d'arrivée : si l'heure d'arrivée est donnée, commence les activités 30min après. Si aucune heure d'arrivée n'est fournie, suppose une arrivée vers midi → NE programme RIEN avant 14h00 sur le jour 1 (pas de petit-déjeuner, pas de visite matinale). Activités légères après le check-in → balades, quartiers, points de vue. Inclure un dîner.
10. Dernier jour : finir toutes les activités 90 minutes AVANT l'heure de départ (checkout + trajet gare/aéroport)
11. Soirées (après 18h) : quartiers animés, balades, viewpoints, bars/aperitivo — JAMAIS de musées
12. Météo : activités intérieures (musées, monuments couverts) les jours de pluie, extérieures (parcs, jardins, marchés, balades) les jours ensoleillés
13. Max 5 activités par jour plein, 1-3 pour jours d'arrivée/départ
14. Pas 2 musées longs (>90min) le même jour — alterner visites lourdes et légères
15. Chaque jour plein DOIT avoir : petit-déjeuner + 3 à 5 activités + déjeuner + dîner (6-8 items par jour)
16. Horaires arrondis aux quarts d'heure : :00, :15, :30, :45
17. Prévoir 15-20 minutes de déplacement entre items consécutifs (sauf si la matrice de distances montre plus)
18. Le petit-déjeuner commence entre 07:30 et 09:00, le déjeuner entre 12:00 et 13:30, le dîner entre 19:00 et 21:00
19. MINIMUM ACTIVITÉS : planifie un MINIMUM de 3 activités par jour plein et 1-2 par jour frontière (arrivée/départ)
20. DERNIER JOUR : le jour de départ DOIT inclure au moins 1 activité AVANT le checkout — jamais un jour vide
21. GAPS MAXIMUM : jamais plus de 2h30 entre deux items consécutifs pendant les heures actives (7h-20h)
22. VÉRIFICATION IDS : chaque activityId et restaurantId DOIT exister exactement dans les listes fournies — ne génère AUCUN ID inventé
23. DAY TRIPS : si des day trips sont fournis dans les données, dédie UN jour complet par day trip. Structure : transport aller (hôtel → destination, mode + durée indiqués), activités sur place, déjeuner SUR PLACE (restaurants taggés pour cette destination), transport retour. Départ tôt (08:00-08:30). Toutes les activités du day trip sur le MÊME jour. Si une date est forcée (forcedDate), place le day trip exactement ce jour-là. Marque le jour avec isDayTrip: true et dayTripDestination dans le JSON.
24. Sur les jours de day trip, NE PAS mettre d'activités de la ville principale. Seuls les restaurants et activités taggés pour cette destination.
25. Le dîner après un day trip : si retour avant 19h, le dîner peut être en ville principale.

FORMAT DE SORTIE — JSON strict, pas de texte avant ou après :
{
  "days": [
    {
      "dayNumber": 1,
      "theme": "Thème court (max 6 mots)",
      "narrative": "Description de la journée (2-3 phrases max)",
      "isDayTrip": false,
      "dayTripDestination": null,
      "items": [
        { "type": "activity", "activityId": "exact-id-from-list", "startTime": "09:00", "endTime": "10:30", "duration": 90 },
        { "type": "restaurant", "restaurantId": "exact-id-from-list", "mealType": "lunch", "startTime": "12:30", "endTime": "13:45", "duration": 75 }
      ]
    }
  ],
  "unusedActivities": ["id-1", "id-2"],
  "reasoning": "Explication courte de la logique de planification (2-3 phrases)"
}`;

// ============================================
// Main API Function
// ============================================

/**
 * Planifie un itinéraire complet en utilisant Claude Sonnet.
 *
 * @param input - Données structurées (trip, hotel, activities, restaurants, distances, weather)
 * @returns Plan jour par jour validé ou fallback déterministe
 */
export async function planWithClaude(input: LLMPlannerInput): Promise<LLMPlannerOutput> {
  // Check API key availability
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[Pipeline V2 LLM] No ANTHROPIC_API_KEY — falling back to deterministic planner');
    return buildFallbackPlan(input);
  }

  try {
    // Build user prompt
    const userPrompt = buildUserPrompt(input);

    // Initialize Anthropic client
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Make API call with timeout
    console.log('[Pipeline V2 LLM] Calling Claude Sonnet for trip planning...');
    const startTime = Date.now();

    const response = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Claude planning timeout (120s)')), 120000)
      ),
    ]);

    const durationMs = Date.now() - startTime;

    // Log token usage and cost
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    console.log(
      `[Pipeline V2 LLM] Claude planning: ${inputTokens} in + ${outputTokens} out, ~$${costUsd.toFixed(4)}, ${durationMs}ms`
    );

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.warn('[Pipeline V2 LLM] No text block in Claude response — falling back');
      return buildFallbackPlan(input);
    }

    const responseText = textBlock.text;

    // Parse, sanitize, and enrich response
    const rawPlan = parseLLMResponse(responseText, input);
    const sanitized = sanitizeLLMPlan(rawPlan, input);
    const plan = enrichSparseDays(sanitized, input);

    // Validate plan (only hard errors after sanitization + enrichment)
    const validation = validateLLMPlan(plan, input);

    if (!validation.valid) {
      console.warn('[Pipeline V2 LLM] Initial plan has errors:', validation.errors);

      // Try one retry with correction prompt
      const correctedPlan = await retryWithCorrections(
        client,
        responseText,
        validation.errors,
        input
      );

      if (correctedPlan) {
        const enrichedRetry = enrichSparseDays(sanitizeLLMPlan(correctedPlan, input), input);
        const revalidation = validateLLMPlan(enrichedRetry, input);
        if (revalidation.valid) {
          logPlanSummary(enrichedRetry);
          return enrichedRetry;
        }
        console.warn('[Pipeline V2 LLM] Retry still has errors — falling back');
      }

      // Fallback to deterministic
      return buildFallbackPlan(input);
    }

    // Success
    logPlanSummary(plan);
    return plan;
  } catch (error) {
    console.error('[Pipeline V2 LLM] Claude API error:', error);
    console.warn('[Pipeline V2 LLM] Falling back to deterministic planner');
    return buildFallbackPlan(input);
  }
}

// ============================================
// Gemini Flash Planning
// ============================================

/**
 * Planifie un itinéraire complet en utilisant Gemini 2.5 Flash.
 * Même prompt que Claude, ~8x moins cher.
 */
export async function planWithGemini(input: LLMPlannerInput): Promise<LLMPlannerOutput> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[Pipeline V2 LLM] No GOOGLE_AI_API_KEY — falling back to deterministic planner');
    return buildFallbackPlan(input);
  }

  try {
    const userPrompt = buildUserPrompt(input);
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;

    console.log('[Pipeline V2 LLM] Calling Gemini 2.5 Flash for trip planning...');
    const startTime = Date.now();

    const response = await Promise.race([
      fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 16000,
            responseMimeType: 'application/json',
            // Small thinking budget: lets Gemini reason about constraints
            // before outputting JSON. Thinking tokens billed at input rate ($0.15/1M).
            // Cost impact: ~$0.0003 for 2048 thinking tokens.
            thinkingConfig: { thinkingBudget: 2048 },
          },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini planning timeout (120s)')), 120000)
      ),
    ]);

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Pipeline V2 LLM] Gemini API error: ${response.status} — ${errorText}`);
      return buildFallbackPlan(input);
    }

    const geminiData: GeminiResponse = await response.json();

    if (geminiData.error) {
      console.error(`[Pipeline V2 LLM] Gemini error: ${geminiData.error.message}`);
      return buildFallbackPlan(input);
    }

    // Log token usage and cost
    const usage = geminiData.usageMetadata;
    if (usage) {
      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;
      // Gemini 2.5 Flash pricing: $0.15/1M input, $0.60/1M output (thinking tokens billed at input rate)
      const costUsd = (inputTokens * 0.15 + outputTokens * 0.60) / 1_000_000;
      console.log(
        `[Pipeline V2 LLM] Gemini Flash: ${inputTokens} in + ${outputTokens} out, ~$${costUsd.toFixed(4)}, ${durationMs}ms`
      );
    } else {
      console.log(`[Pipeline V2 LLM] Gemini Flash: ${durationMs}ms (no usage metadata)`);
    }

    // Extract text
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[Pipeline V2 LLM] Gemini returned no text — falling back');
      console.warn('[Pipeline V2 LLM] Gemini raw response:', JSON.stringify(geminiData).slice(0, 500));
      return buildFallbackPlan(input);
    }

    // Log first 200 chars of response for debugging
    console.log(`[Pipeline V2 LLM] Gemini response preview: ${text.slice(0, 200)}...`);

    // Parse, sanitize, and enrich response
    const rawPlan = parseLLMResponse(text, input);
    const sanitized = sanitizeLLMPlan(rawPlan, input);
    const plan = enrichSparseDays(sanitized, input);

    // Validate plan (only hard errors after sanitization + enrichment)
    const validation = validateLLMPlan(plan, input);

    if (!validation.valid) {
      console.warn('[Pipeline V2 LLM] Gemini plan has errors:', validation.errors);

      // Try one retry with correction prompt
      const correctedPlan = await retryGeminiWithCorrections(
        apiKey,
        fullPrompt,
        text,
        validation.errors,
        input
      );

      if (correctedPlan) {
        const enrichedRetry = enrichSparseDays(sanitizeLLMPlan(correctedPlan, input), input);
        const revalidation = validateLLMPlan(enrichedRetry, input);
        if (revalidation.valid) {
          logPlanSummary(enrichedRetry);
          return enrichedRetry;
        }
        console.warn('[Pipeline V2 LLM] Gemini retry still has errors — falling back');
      }

      return buildFallbackPlan(input);
    }

    // Success
    logPlanSummary(plan);
    return plan;
  } catch (error) {
    console.error('[Pipeline V2 LLM] Gemini API error:', error);
    console.warn('[Pipeline V2 LLM] Falling back to deterministic planner');
    return buildFallbackPlan(input);
  }
}

/**
 * Retry Gemini with correction prompt.
 */
async function retryGeminiWithCorrections(
  apiKey: string,
  originalPrompt: string,
  originalResponse: string,
  errors: string[],
  input: LLMPlannerInput
): Promise<LLMPlannerOutput | null> {
  try {
    const correctionPrompt = `Your plan has the following errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nPlease fix these errors and return the corrected JSON plan.`;

    console.log('[Pipeline V2 LLM] Retrying Gemini with corrections...');

    const response = await Promise.race([
      fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: originalPrompt }] },
            { role: 'model', parts: [{ text: originalResponse }] },
            { role: 'user', parts: [{ text: correctionPrompt }] },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 16000,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 2048 },
          },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini retry timeout (90s)')), 90000)
      ),
    ]);

    if (!response.ok) {
      console.warn(`[Pipeline V2 LLM] Gemini retry HTTP error: ${response.status}`);
      return null;
    }

    const geminiData: GeminiResponse = await response.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const correctedPlan = parseLLMResponse(text, input);
    console.log('[Pipeline V2 LLM] Gemini retry completed');
    return correctedPlan;
  } catch (error) {
    console.error('[Pipeline V2 LLM] Gemini retry failed:', error);
    return null;
  }
}

// ============================================
// LLM Router
// ============================================

export type LLMPlannerModel = 'claude-sonnet-4-6' | 'gemini-2.5-flash';

/**
 * Routes to the appropriate LLM planner based on LLM_PLANNER_MODEL env var.
 * Default: gemini-2.5-flash
 */
export async function planWithLLM(input: LLMPlannerInput): Promise<LLMPlannerOutput> {
  const model = (process.env.LLM_PLANNER_MODEL || 'gemini-2.5-flash') as LLMPlannerModel;

  console.log(`[Pipeline V2 LLM] Using model: ${model}`);

  switch (model) {
    case 'gemini-2.5-flash':
      return planWithGemini(input);
    case 'claude-sonnet-4-6':
    default:
      return planWithClaude(input);
  }
}

// ============================================
// Prompt Building
// ============================================

function buildUserPrompt(input: LLMPlannerInput): string {
  // Send distances in compact form (no pretty-print) to save tokens
  // Activities and restaurants still get pretty-print for readability
  const { distances, ...rest } = input;
  const compactDistances = JSON.stringify(distances);
  const prettyRest = JSON.stringify(rest, null, 2);

  const d = input.trip.durationDays;
  const minActivities = d * 3 + 2; // 17 pour 5j
  const lastDay = d;
  const fullDayRange = d > 2 ? `jours 2 à ${d - 1}` : 'jours pleins';

  // Build day trips section for prompt
  const dayTrips = input.trip.dayTrips || [];
  let dayTripsSection = '';
  if (dayTrips.length > 0) {
    dayTripsSection = `\n\nDAY TRIPS À PLANIFIER :\n`;
    for (const dt of dayTrips) {
      dayTripsSection += `- ${dt.name} (excursion depuis ${input.trip.destination}): ${dt.distanceKm}km, ${dt.transportMode} ~${dt.transportDurationMin}min, ~${dt.transportCostPerPerson}€/pers\n`;
      dayTripsSection += `  Activités sur place: [${dt.activityIds.join(', ')}]\n`;
      dayTripsSection += `  Restaurants sur place: [${dt.restaurantIds.join(', ')}]\n`;
      dayTripsSection += `  Journée complète: ${dt.fullDayRequired ? 'oui' : 'non'}\n`;
      dayTripsSection += `  Date forcée: ${dt.forcedDate || 'aucune'}\n`;
    }
    dayTripsSection += `\nIMPORTANT: Pour chaque day trip, marque le jour avec "isDayTrip": true et "dayTripDestination": "${dayTrips[0]?.destination}" dans le JSON.`;
  }

  return `DONNÉES DU VOYAGE:
${prettyRest}

MATRICE DE DISTANCES (format: "from→to": {"km":X,"walkMin":Y}):
${compactDistances}

CONTRAINTES CRITIQUES POUR CE VOYAGE (${d} jours):
- Minimum ${minActivities} activités au total (${input.activities.length} disponibles — utilise leurs IDs exacts)
- ${input.restaurants.length} restaurants disponibles — utilise leurs IDs exacts
- ${fullDayRange}: minimum 3 activités + 3 repas = 6 items par jour
- Jour ${lastDay} (départ): minimum 1 activité AVANT le checkout
- Aucun gap > 2h30 entre items consécutifs${dayTripsSection}

Planifie cet itinéraire en respectant toutes les règles. Réponds UNIQUEMENT en JSON strict selon le schéma:
{
  "days": [{ "dayNumber": N, "theme": "...", "narrative": "...", "isDayTrip": false, "dayTripDestination": null, "items": [{ "type": "activity"|"restaurant", "activityId?": "act-N", "restaurantId?": "rest-N", "mealType?": "breakfast"|"lunch"|"dinner", "startTime": "HH:mm", "endTime": "HH:mm", "duration": N }] }],
  "unusedActivities": ["act-N", ...],
  "reasoning": "..."
}`;
}

// ============================================
// Response Parsing
// ============================================

function parseLLMResponse(text: string, input: LLMPlannerInput): LLMPlannerOutput {
  // Remove markdown code fences if present
  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  // Try parsing directly first
  let parsed: LLMPlannerOutput;
  try {
    parsed = JSON.parse(cleanText);
  } catch (firstError) {
    // Attempt JSON repair for common LLM quirks:
    // 1. Single quotes → double quotes (careful with apostrophes inside values)
    // 2. Trailing commas before ] or }
    // 3. Unescaped newlines in strings
    console.warn('[Pipeline V2 LLM] JSON parse failed, attempting repair...');
    let repaired = cleanText
      // Fix trailing commas: ,] or ,}
      .replace(/,\s*([\]}])/g, '$1')
      // Fix single-quoted keys: 'key': → "key":
      .replace(/'([^']+)'(\s*:)/g, '"$1"$2')
      // Fix single-quoted string values: : 'value' → : "value"
      // This regex is careful to not break apostrophes inside double-quoted strings
      .replace(/:\s*'([^']*)'/g, ': "$1"');

    try {
      parsed = JSON.parse(repaired);
      console.log('[Pipeline V2 LLM] JSON repair succeeded');
    } catch (secondError) {
      // Last resort: try to extract JSON object from text
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
          console.log('[Pipeline V2 LLM] JSON extraction from text succeeded');
        } catch {
          // Re-throw original error for clarity
          throw firstError;
        }
      } else {
        throw firstError;
      }
    }
  }

  // Validate basic structure
  if (!parsed.days || !Array.isArray(parsed.days)) {
    throw new Error('Invalid LLM response: missing "days" array');
  }

  // Type cast and return
  return parsed as LLMPlannerOutput;
}

// ============================================
// Sanitization — Remove invalid items before validation
// ============================================

/**
 * Removes invalid items from the plan (unknown IDs, duplicates) instead of
 * failing validation entirely. This is important for Gemini which sometimes
 * hallucinates 1-2 IDs but produces an otherwise good plan.
 */
function sanitizeLLMPlan(plan: LLMPlannerOutput, input: LLMPlannerInput): LLMPlannerOutput {
  const activityIds = new Set(input.activities.map((a) => a.id));
  const restaurantIds = new Set(input.restaurants.map((r) => r.id));
  const scheduledActivities = new Set<string>();
  let removedCount = 0;

  const sanitizedDays = plan.days.map((day) => {
    if (!day.items || !Array.isArray(day.items)) {
      return { ...day, items: [] };
    }

    const validItems = day.items.filter((item) => {
      // Check type
      if (item.type !== 'activity' && item.type !== 'restaurant') {
        removedCount++;
        return false;
      }

      // Check activity reference
      if (item.type === 'activity') {
        if (!item.activityId || !activityIds.has(item.activityId)) {
          console.warn(`[Pipeline V2 LLM] Sanitize: removed unknown activity "${item.activityId}" from day ${day.dayNumber}`);
          removedCount++;
          return false;
        }
        if (scheduledActivities.has(item.activityId)) {
          console.warn(`[Pipeline V2 LLM] Sanitize: removed duplicate activity "${item.activityId}" from day ${day.dayNumber}`);
          removedCount++;
          return false;
        }
        scheduledActivities.add(item.activityId);
      }

      // Check restaurant reference
      if (item.type === 'restaurant') {
        if (!item.restaurantId || !restaurantIds.has(item.restaurantId)) {
          console.warn(`[Pipeline V2 LLM] Sanitize: removed unknown restaurant "${item.restaurantId}" from day ${day.dayNumber}`);
          removedCount++;
          return false;
        }
      }

      // Check times
      if (!isValidTime(item.startTime) || !isValidTime(item.endTime)) {
        removedCount++;
        return false;
      }

      return true;
    });

    return { ...day, items: validItems };
  });

  if (removedCount > 0) {
    console.log(`[Pipeline V2 LLM] Sanitized plan: removed ${removedCount} invalid items`);
  }

  return {
    ...plan,
    days: sanitizedDays,
  };
}

// ============================================
// Post-Sanitization Enrichment — Safety Net
// ============================================

/**
 * Enrichit les jours creux en injectant des activités du pool inutilisé.
 * Tourne APRÈS sanitization, AVANT validation — modifie le LLMPlannerOutput directement.
 *
 * Cas traités :
 * 0. Overlap jour 1 : supprime items planifiés avant l'heure d'arrivée estimée
 * 1. Dernier jour vide (0 activité) → injecte 1 activité avant checkout
 * 2. Jour plein sparse (< 3 activités) → injecte dans le plus grand gap
 * 3. Gros trous (> 90min) → injecte 1 activité dans le gap
 */
function enrichSparseDays(
  plan: LLMPlannerOutput,
  input: LLMPlannerInput
): LLMPlannerOutput {
  const activityMap = new Map(input.activities.map((a) => [a.id, a]));
  const scheduledIds = new Set<string>();

  // Collect scheduled IDs
  for (const day of plan.days) {
    for (const item of day.items || []) {
      if (item.type === 'activity' && item.activityId) {
        scheduledIds.add(item.activityId);
      }
    }
  }

  // Build unused pool sorted by quality (must-see first, then score)
  const unusedPool = input.activities
    .filter((a) => !scheduledIds.has(a.id))
    .sort((a, b) => {
      if (a.mustSee && !b.mustSee) return -1;
      if (!a.mustSee && b.mustSee) return 1;
      const scoreA = a.rating * Math.log2(a.reviewCount + 2);
      const scoreB = b.rating * Math.log2(b.reviewCount + 2);
      return scoreB - scoreA;
    });

  // CAS 0: Fix arrival-day overlaps — remove items before estimated arrival
  // When arrivalTime is known, use it + 30min buffer.
  // When arrivalTime is null (no flight/transport found), assume noon arrival → earliest activity at 14:00.
  // This prevents overlaps with fallback transport injected by step8 (150min before first item).
  {
    const arrivalMin = input.trip.arrivalTime
      ? parseHHMMLocal(input.trip.arrivalTime)
      : 12 * 60; // default: noon
    const checkinBuffer = input.trip.arrivalTime ? 30 : 120; // 30min with known arrival, 2h with assumed noon
    const earliestActivityMin = arrivalMin + checkinBuffer;
    const firstDay = plan.days[0];

    if (firstDay) {
      const itemsBefore = (firstDay.items || []).filter((item) => {
        if (item.type !== 'activity' && item.type !== 'restaurant') return false;
        const itemStart = parseHHMMLocal(item.startTime);
        return itemStart < earliestActivityMin;
      });
      if (itemsBefore.length > 0) {
        firstDay.items = (firstDay.items || []).filter((item) => {
          if (item.type !== 'activity' && item.type !== 'restaurant') return true;
          const itemStart = parseHHMMLocal(item.startTime);
          if (itemStart < earliestActivityMin) {
            if (item.type === 'activity' && item.activityId) {
              const act = activityMap.get(item.activityId);
              if (act) {
                unusedPool.push(act);
                scheduledIds.delete(item.activityId);
              }
            }
            const arrivalLabel = input.trip.arrivalTime || 'assumed 12:00';
            console.log(
              `[Pipeline V2 LLM] Enrichment: removed pre-arrival item "${item.activityId || item.restaurantId}" at ${item.startTime} (arrival: ${arrivalLabel})`
            );
            return false;
          }
          return true;
        });
      }
    }
  }

  if (unusedPool.length === 0) return plan;

  let enrichmentCount = 0;
  const numDays = plan.days.length;

  for (const day of plan.days) {
    const dayNum = day.dayNumber;
    const isLastDay = dayNum === numDays;
    const isFirstDay = dayNum === 1;
    const isFullDay = !isFirstDay && !isLastDay;

    // Skip enrichment on day-trip days (transport takes time, gaps are normal)
    if (day.isDayTrip) continue;

    const activities = (day.items || []).filter((i) => i.type === 'activity');
    const activityCount = activities.length;

    // CAS 1: Dernier jour avec 0 activité
    if (isLastDay && activityCount === 0 && unusedPool.length > 0) {
      // Find time window: after breakfast, before latest departure
      const breakfastItem = (day.items || []).find(
        (i) => i.type === 'restaurant' && i.mealType === 'breakfast'
      );
      const afterBreakfast = breakfastItem ? parseHHMMLocal(breakfastItem.endTime) + 15 : 570; // 09:30
      const departureLimit = input.trip.departureTime
        ? parseHHMMLocal(input.trip.departureTime) - 90
        : 660; // 11:00

      const available = departureLimit - afterBreakfast;
      if (available >= 45) {
        const activity = unusedPool.shift()!;
        const duration = Math.min(activity.duration, available - 15);
        day.items.push({
          type: 'activity',
          activityId: activity.id,
          startTime: minutesToHHMMLocal(afterBreakfast),
          endTime: minutesToHHMMLocal(afterBreakfast + duration),
          duration,
        });
        scheduledIds.add(activity.id);
        enrichmentCount++;
        console.log(
          `[Pipeline V2 LLM] Enrichment: added "${activity.name}" to empty last day`
        );
      }
    }

    // CAS 2: Jour plein avec < 3 activités
    if (isFullDay && activityCount < 3 && unusedPool.length > 0) {
      const needed = Math.min(3 - activityCount, unusedPool.length);
      for (let i = 0; i < needed; i++) {
        const gaps = findLargestGaps(day);
        const activity = unusedPool[0];
        if (!activity) break;

        const bestGap = gaps.find((g) => g.gapMinutes >= activity.duration + 30);
        if (!bestGap) break;

        unusedPool.shift();
        const startMin = bestGap.startMinutes + 15;
        day.items.push({
          type: 'activity',
          activityId: activity.id,
          startTime: minutesToHHMMLocal(startMin),
          endTime: minutesToHHMMLocal(startMin + activity.duration),
          duration: activity.duration,
        });
        scheduledIds.add(activity.id);
        enrichmentCount++;
        console.log(
          `[Pipeline V2 LLM] Enrichment: added "${activity.name}" to sparse day ${dayNum} (was ${activityCount} activities)`
        );
      }
    }

    // CAS 3: Gros trous (> 90min) — fill ALL big gaps, max 3 insertions per day
    // After each insertion, re-compute gaps since new item splits remaining gaps
    if (unusedPool.length > 0) {
      const MAX_GAP_FILLS_PER_DAY = 3;
      let gapFillsThisDay = 0;

      while (gapFillsThisDay < MAX_GAP_FILLS_PER_DAY && unusedPool.length > 0) {
        day.items.sort((a, b) => a.startTime.localeCompare(b.startTime));
        const gaps = findLargestGaps(day);
        const bigGap = gaps.find((g) => g.gapMinutes >= 90);
        if (!bigGap) break;

        const activity = unusedPool.shift()!;
        const duration = Math.min(activity.duration, bigGap.gapMinutes - 30);
        const startMin = bigGap.startMinutes + 15;
        day.items.push({
          type: 'activity',
          activityId: activity.id,
          startTime: minutesToHHMMLocal(startMin),
          endTime: minutesToHHMMLocal(startMin + duration),
          duration,
        });
        scheduledIds.add(activity.id);
        enrichmentCount++;
        gapFillsThisDay++;
        console.log(
          `[Pipeline V2 LLM] Enrichment: filled ${bigGap.gapMinutes}min gap on day ${dayNum} with "${activity.name}" (fill ${gapFillsThisDay}/${MAX_GAP_FILLS_PER_DAY})`
        );
      }
    }

    // Re-sort items by time
    day.items.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // Update unused list
  plan.unusedActivities = unusedPool.map((a) => a.id);

  if (enrichmentCount > 0) {
    console.log(
      `[Pipeline V2 LLM] Enrichment complete: added ${enrichmentCount} activities`
    );
  }

  return plan;
}

/**
 * Find gaps between consecutive items in a day, sorted by size desc.
 */
function findLargestGaps(
  day: LLMDayPlan
): Array<{ startMinutes: number; gapMinutes: number }> {
  if (!day.items || day.items.length < 2) return [];

  const sorted = [...day.items].sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );
  const gaps: Array<{ startMinutes: number; gapMinutes: number }> = [];

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = parseHHMMLocal(sorted[i - 1].endTime);
    const currStart = parseHHMMLocal(sorted[i].startTime);
    const gapMinutes = currStart - prevEnd;
    if (gapMinutes > 45) {
      gaps.push({ startMinutes: prevEnd, gapMinutes });
    }
  }

  return gaps.sort((a, b) => b.gapMinutes - a.gapMinutes);
}

/** Parse "HH:mm" to total minutes */
function parseHHMMLocal(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Convert minutes to "HH:mm", rounded to :15 */
function minutesToHHMMLocal(totalMinutes: number): string {
  // Round to nearest 15
  const rounded = Math.round(totalMinutes / 15) * 15;
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ============================================
// Validation (post-sanitization — only hard errors)
// ============================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the plan after sanitization. Only checks for hard errors:
 * - Missing must-see activities
 * - Empty days
 * - Structural issues
 */
function validateLLMPlan(plan: LLMPlannerOutput, input: LLMPlannerInput): ValidationResult {
  const errors: string[] = [];

  const mustSeeIds = input.activities.filter((a) => a.mustSee).map((a) => a.id);
  const scheduledActivities = new Set<string>();

  // Check each day has items
  for (const day of plan.days) {
    if (!day.items || day.items.length === 0) {
      errors.push(`Day ${day.dayNumber} has no items`);
    }
    for (const item of (day.items || [])) {
      if (item.type === 'activity' && item.activityId) {
        scheduledActivities.add(item.activityId);
      }
    }
  }

  // Check all must-sees are scheduled
  const missingMustSees = mustSeeIds.filter((id) => !scheduledActivities.has(id));
  if (missingMustSees.length > 0) {
    errors.push(`Missing must-see activities: ${missingMustSees.join(', ')}`);
  }

  // Check plan has at least 60% of expected items
  const totalItems = plan.days.reduce((s, d) => s + (d.items?.length || 0), 0);
  const minExpectedItems = input.trip.durationDays * 4; // ~4 items/day minimum
  if (totalItems < minExpectedItems) {
    errors.push(`Plan too sparse: only ${totalItems} items for ${input.trip.durationDays} days (expected ≥${minExpectedItems})`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function isValidTime(time: string): boolean {
  if (!time) return false;
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.test(time);
  return match;
}

// ============================================
// Retry Logic
// ============================================

async function retryWithCorrections(
  client: Anthropic,
  originalResponse: string,
  errors: string[],
  input: LLMPlannerInput
): Promise<LLMPlannerOutput | null> {
  try {
    const correctionPrompt = `Your plan has the following errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\nPlease fix these errors and return the corrected JSON plan.`;

    console.log('[Pipeline V2 LLM] Retrying with corrections...');

    const response = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserPrompt(input) },
          { role: 'assistant', content: originalResponse },
          { role: 'user', content: correctionPrompt },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Retry timeout (90s)')), 90000)
      ),
    ]);

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    const correctedPlan = parseLLMResponse(textBlock.text, input);
    console.log('[Pipeline V2 LLM] Retry completed');
    return correctedPlan;
  } catch (error) {
    console.error('[Pipeline V2 LLM] Retry failed:', error);
    return null;
  }
}

// ============================================
// Deterministic Fallback
// ============================================

/**
 * Génère un plan déterministe simple quand Claude n'est pas disponible
 * ou échoue à produire un plan valide.
 */
export function buildFallbackPlan(input: LLMPlannerInput): LLMPlannerOutput {
  console.log('[Pipeline V2 LLM] Building deterministic fallback plan...');

  const { trip, hotel, activities, restaurants } = input;
  const durationDays = trip.durationDays;

  // Sort activities by priority: must-see first, then by quality score
  const sortedActivities = [...activities].sort((a, b) => {
    if (a.mustSee && !b.mustSee) return -1;
    if (!a.mustSee && b.mustSee) return 1;
    const scoreA = a.rating * Math.log2(a.reviewCount + 2);
    const scoreB = b.rating * Math.log2(b.reviewCount + 2);
    return scoreB - scoreA;
  });

  // Determine activities per day
  const totalActivities = Math.min(sortedActivities.length, durationDays * 4);
  const activitiesPerDay: number[] = [];

  if (durationDays === 1) {
    activitiesPerDay.push(Math.min(totalActivities, 3));
  } else if (durationDays === 2) {
    activitiesPerDay.push(2, Math.min(totalActivities - 2, 4));
  } else {
    // First day: 2 activities (arrival)
    activitiesPerDay.push(2);
    // Last day: 2 activities (departure)
    const lastDayActivities = 2;
    // Middle days: distribute remaining
    const remaining = totalActivities - 2 - lastDayActivities;
    const fullDays = durationDays - 2;
    const perFullDay = Math.min(Math.ceil(remaining / fullDays), 5);

    for (let i = 0; i < fullDays; i++) {
      activitiesPerDay.push(perFullDay);
    }
    activitiesPerDay.push(lastDayActivities);
  }

  // Build days
  const days: LLMDayPlan[] = [];
  let activityIndex = 0;

  for (let dayNum = 1; dayNum <= durationDays; dayNum++) {
    const numActivities = activitiesPerDay[dayNum - 1] || 0;
    const dayActivities = sortedActivities.slice(activityIndex, activityIndex + numActivities);
    activityIndex += numActivities;

    // Calculate day centroid for restaurant selection
    const centroid = calculateCentroid(dayActivities);

    // Select restaurants
    const breakfast = selectClosestRestaurant(
      restaurants,
      hotel ? { lat: hotel.lat, lng: hotel.lng } : centroid,
      'breakfast'
    );
    const lunch = selectClosestRestaurant(restaurants, centroid, 'lunch');
    const dinner = selectClosestRestaurant(restaurants, centroid, 'dinner');

    // Build items with simple timing
    const items: LLMDayItem[] = [];
    let currentTime = dayNum === 1 ? '10:00' : '08:30';

    // Breakfast
    if (breakfast) {
      items.push({
        type: 'restaurant',
        restaurantId: breakfast.id,
        mealType: 'breakfast',
        startTime: currentTime,
        endTime: addMinutes(currentTime, 45),
        duration: 45,
      });
      currentTime = addMinutes(currentTime, 60);
    }

    // Morning activities
    const morningCount = Math.ceil(dayActivities.length / 2);
    for (let i = 0; i < morningCount && i < dayActivities.length; i++) {
      const activity = dayActivities[i];
      items.push({
        type: 'activity',
        activityId: activity.id,
        startTime: currentTime,
        endTime: addMinutes(currentTime, activity.duration),
        duration: activity.duration,
      });
      currentTime = addMinutes(currentTime, activity.duration + 20);
    }

    // Lunch
    if (lunch) {
      currentTime = ensureTimeAfter(currentTime, '12:15');
      items.push({
        type: 'restaurant',
        restaurantId: lunch.id,
        mealType: 'lunch',
        startTime: currentTime,
        endTime: addMinutes(currentTime, 75),
        duration: 75,
      });
      currentTime = addMinutes(currentTime, 90);
    }

    // Afternoon activities
    for (let i = morningCount; i < dayActivities.length; i++) {
      const activity = dayActivities[i];
      items.push({
        type: 'activity',
        activityId: activity.id,
        startTime: currentTime,
        endTime: addMinutes(currentTime, activity.duration),
        duration: activity.duration,
      });
      currentTime = addMinutes(currentTime, activity.duration + 20);
    }

    // Dinner
    if (dinner) {
      currentTime = ensureTimeAfter(currentTime, '19:00');
      items.push({
        type: 'restaurant',
        restaurantId: dinner.id,
        mealType: 'dinner',
        startTime: currentTime,
        endTime: addMinutes(currentTime, 90),
        duration: 90,
      });
    }

    // Create day theme from top activities
    const topActivities = dayActivities.slice(0, 2).map((a) => a.name);
    const theme = topActivities.join(' & ') || `Jour ${dayNum}`;

    days.push({
      dayNumber: dayNum,
      theme,
      narrative: `Journée ${dayNum}: ${theme}`,
      items,
    });
  }

  // Collect unused activities
  const unusedActivities = sortedActivities.slice(activityIndex).map((a) => a.id);

  const plan: LLMPlannerOutput = {
    days,
    unusedActivities,
    reasoning: 'Plan déterministe généré automatiquement (fallback mode)',
  };

  logPlanSummary(plan);
  return plan;
}

// ============================================
// Utility Functions
// ============================================

function calculateCentroid(
  activities: { lat: number; lng: number }[]
): { lat: number; lng: number } {
  if (activities.length === 0) {
    return { lat: 0, lng: 0 };
  }

  const sum = activities.reduce(
    (acc, a) => ({ lat: acc.lat + a.lat, lng: acc.lng + a.lng }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: sum.lat / activities.length,
    lng: sum.lng / activities.length,
  };
}

function selectClosestRestaurant(
  restaurants: { id: string; lat: number; lng: number; suitableFor: string[] }[],
  coords: { lat: number; lng: number },
  mealType: string
): { id: string } | null {
  const suitable = restaurants.filter((r) => r.suitableFor.includes(mealType));
  if (suitable.length === 0) return null;

  // Find closest
  let closest = suitable[0];
  let minDist = haversineDistance(coords, closest);

  for (let i = 1; i < suitable.length; i++) {
    const dist = haversineDistance(coords, suitable[i]);
    if (dist < minDist) {
      minDist = dist;
      closest = suitable[i];
    }
  }

  return { id: closest.id };
}

function haversineDistance(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function ensureTimeAfter(time: string, minTime: string): string {
  const [h1, m1] = time.split(':').map(Number);
  const [h2, m2] = minTime.split(':').map(Number);
  const minutes1 = h1 * 60 + m1;
  const minutes2 = h2 * 60 + m2;

  if (minutes1 >= minutes2) {
    return time;
  }
  return minTime;
}

function logPlanSummary(plan: LLMPlannerOutput): void {
  const totalActivities = plan.days.reduce(
    (sum, day) => sum + day.items.filter((item) => item.type === 'activity').length,
    0
  );
  const totalRestaurants = plan.days.reduce(
    (sum, day) => sum + day.items.filter((item) => item.type === 'restaurant').length,
    0
  );

  console.log(
    `[Pipeline V2 LLM] Plan: ${plan.days.length} days, ${totalActivities} activities, ${totalRestaurants} meals`
  );
}
