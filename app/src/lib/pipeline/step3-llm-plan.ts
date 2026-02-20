/**
 * Pipeline V2 — Step 3: LLM Planning avec Claude
 *
 * Ce module utilise Claude Sonnet pour créer un itinéraire jour par jour intelligent
 * basé sur les activités scorées, les restaurants disponibles, et les contraintes du voyage.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMPlannerInput,
  LLMPlannerOutput,
  LLMDayPlan,
  LLMDayItem,
} from './types';

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
7. Restaurants : petit-déjeuner < 1.2km de l'hôtel, déjeuner/dîner < 800m de l'activité précédente ou suivante
8. Diversité cuisine : pas 2 restaurants du même type de cuisine sur le trip
9. Jour d'arrivée : activités légères après le check-in, surtout après 16h → balades, quartiers, points de vue panoramiques. Inclure un dîner.
10. Dernier jour : finir toutes les activités 90 minutes AVANT l'heure de départ (checkout + trajet gare/aéroport)
11. Soirées (après 18h) : quartiers animés, balades, viewpoints, bars/aperitivo — JAMAIS de musées
12. Météo : activités intérieures (musées, monuments couverts) les jours de pluie, extérieures (parcs, jardins, marchés, balades) les jours ensoleillés
13. Max 5 activités par jour plein, 1-3 pour jours d'arrivée/départ
14. Pas 2 musées longs (>90min) le même jour — alterner visites lourdes et légères
15. Chaque jour plein DOIT avoir : petit-déjeuner + 3 à 5 activités + déjeuner + dîner (6-8 items par jour)
16. Horaires arrondis aux quarts d'heure : :00, :15, :30, :45
17. Prévoir 15-20 minutes de déplacement entre items consécutifs (sauf si la matrice de distances montre plus)
18. Le petit-déjeuner commence entre 07:30 et 09:00, le déjeuner entre 12:00 et 13:30, le dîner entre 19:00 et 21:00

FORMAT DE SORTIE — JSON strict, pas de texte avant ou après :
{
  "days": [
    {
      "dayNumber": 1,
      "theme": "Thème court (max 6 mots)",
      "narrative": "Description de la journée (2-3 phrases max)",
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
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 8000,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Claude planning timeout (60s)')), 60000)
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

    // Parse response
    const plan = parseLLMResponse(responseText, input);

    // Validate plan
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
        const revalidation = validateLLMPlan(correctedPlan, input);
        if (revalidation.valid) {
          logPlanSummary(correctedPlan);
          return correctedPlan;
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
// Prompt Building
// ============================================

function buildUserPrompt(input: LLMPlannerInput): string {
  const jsonData = JSON.stringify(input, null, 2);
  return `${jsonData}\n\nPlanifie cet itinéraire en respectant toutes les règles. Réponds UNIQUEMENT en JSON.`;
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

  // Parse JSON
  const parsed = JSON.parse(cleanText);

  // Validate basic structure
  if (!parsed.days || !Array.isArray(parsed.days)) {
    throw new Error('Invalid LLM response: missing "days" array');
  }

  // Type cast and return
  return parsed as LLMPlannerOutput;
}

// ============================================
// Validation
// ============================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateLLMPlan(plan: LLMPlannerOutput, input: LLMPlannerInput): ValidationResult {
  const errors: string[] = [];

  // Build lookup maps
  const activityIds = new Set(input.activities.map((a) => a.id));
  const restaurantIds = new Set(input.restaurants.map((r) => r.id));
  const mustSeeIds = input.activities.filter((a) => a.mustSee).map((a) => a.id);

  // Track scheduled activities
  const scheduledActivities = new Set<string>();
  const scheduledMustSees = new Set<string>();

  // Validate each day
  for (const day of plan.days) {
    if (!day.items || !Array.isArray(day.items)) {
      errors.push(`Day ${day.dayNumber} has no items array`);
      continue;
    }

    for (let i = 0; i < day.items.length; i++) {
      const item = day.items[i];

      // Check type
      if (item.type !== 'activity' && item.type !== 'restaurant') {
        errors.push(`Day ${day.dayNumber} item ${i}: invalid type "${item.type}"`);
        continue;
      }

      // Check activity reference
      if (item.type === 'activity') {
        if (!item.activityId) {
          errors.push(`Day ${day.dayNumber} item ${i}: missing activityId`);
        } else if (!activityIds.has(item.activityId)) {
          errors.push(`Day ${day.dayNumber} item ${i}: unknown activityId "${item.activityId}"`);
        } else {
          // Check for duplicates
          if (scheduledActivities.has(item.activityId)) {
            errors.push(
              `Day ${day.dayNumber} item ${i}: activity "${item.activityId}" scheduled twice`
            );
          }
          scheduledActivities.add(item.activityId);

          // Track must-sees
          if (mustSeeIds.includes(item.activityId)) {
            scheduledMustSees.add(item.activityId);
          }
        }
      }

      // Check restaurant reference
      if (item.type === 'restaurant') {
        if (!item.restaurantId) {
          errors.push(`Day ${day.dayNumber} item ${i}: missing restaurantId`);
        } else if (!restaurantIds.has(item.restaurantId)) {
          errors.push(
            `Day ${day.dayNumber} item ${i}: unknown restaurantId "${item.restaurantId}"`
          );
        }

        if (item.mealType && !['breakfast', 'lunch', 'dinner'].includes(item.mealType)) {
          errors.push(`Day ${day.dayNumber} item ${i}: invalid mealType "${item.mealType}"`);
        }
      }

      // Check times
      if (!isValidTime(item.startTime)) {
        errors.push(`Day ${day.dayNumber} item ${i}: invalid startTime "${item.startTime}"`);
      }
      if (!isValidTime(item.endTime)) {
        errors.push(`Day ${day.dayNumber} item ${i}: invalid endTime "${item.endTime}"`);
      }
    }
  }

  // Check all must-sees are scheduled
  const missingMustSees = mustSeeIds.filter((id) => !scheduledMustSees.has(id));
  if (missingMustSees.length > 0) {
    errors.push(`Missing must-see activities: ${missingMustSees.join(', ')}`);
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
        model: 'claude-sonnet-4-6-20250514',
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
        setTimeout(() => reject(new Error('Retry timeout')), 45000)
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
