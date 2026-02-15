/**
 * Pipeline V2 — Step 6: LLM Day Balancing
 *
 * Single LLM call (Claude or Gemini) to add "human feel" to the algorithmically-built itinerary.
 * The LLM can ONLY reorder, theme, and narrate. It CANNOT add/remove activities.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TripPreferences, TransportOptionSummary, Accommodation } from '../types';
import type { ActivityCluster, MealAssignment, BalancedPlan, BalancedDay, FetchedData } from './types';
import { calculateDistance } from '../services/geocoding';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

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

/**
 * Helper: Get day of week name for a given day number.
 * Returns key matching openingHoursByDay format (e.g., 'monday', 'tuesday', etc.)
 */
function getDayOfWeek(startDate: Date, dayNumber: number): string {
  const date = new Date(startDate);
  date.setDate(startDate.getDate() + dayNumber - 1);
  const dayIndex = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return dayNames[dayIndex];
}

/**
 * Call Claude to balance and humanize the day plan.
 */
export async function balanceDaysWithClaude(
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  data: FetchedData
): Promise<BalancedPlan> {
  // Compute city center as average of all cluster centroids (used for day-trip detection)
  const cityCenter = clusters.length > 0
    ? {
        lat: clusters.reduce((s, c) => s + c.centroid.lat, 0) / clusters.length,
        lng: clusters.reduce((s, c) => s + c.centroid.lng, 0) / clusters.length,
      }
    : { lat: 0, lng: 0 };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Pipeline V2] No ANTHROPIC_API_KEY, using deterministic fallback');
    return buildDeterministicPlan(clusters, cityCenter);
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(clusters, meals, hotel, transport, preferences, data);

    const response = await Promise.race([
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Claude timeout (30s)')), 30000)
      ),
    ]);

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return validateAndFixThemes(parsePlan(text, clusters, cityCenter), clusters);
  } catch (error) {
    console.warn('[Pipeline V2] Claude balancing failed, using fallback:', error instanceof Error ? error.message : error);
    return validateAndFixThemes(buildDeterministicPlan(clusters, cityCenter), clusters);
  }
}

function buildPrompt(
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  data: FetchedData
): string {
  const startDate = new Date(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);

  const clusterDesc = clusters
    .map(c => {
      const totalActivityMin = c.activities.reduce((sum, a) => sum + (a.duration || 60), 0);
      const heavyActivities = c.activities.filter((a) => (a.duration || 60) >= 90).length;
      const estimatedTravelMin = Math.round((c.totalIntraDistance || 0) * 12);
      const budgetHint = `    [BUDGET JOUR: activités=${totalActivityMin}min, déplacements≈${estimatedTravelMin}min, heavy=${heavyActivities}]`;
      const activitiesList = c.activities
        .map(a => {
          const durationStr = `${a.duration || 60}min`;
          const ratingStr = `${a.rating || '?'}★`;
          const reviewStr = `${a.reviewCount || 0} avis`;
          const gpsStr = `GPS: ${a.latitude?.toFixed(4) || '?'},${a.longitude?.toFixed(4) || '?'}`;

          // Opening hours info (if available from Google Places Details)
          let hoursInfo = '';
          if (a.openingHoursByDay) {
            const dayOfWeek = getDayOfWeek(startDate, c.dayNumber);
            const hours = a.openingHoursByDay[dayOfWeek];
            if (hours === null) {
              hoursInfo = ' [FERMÉ ce jour]';
            } else if (hours) {
              hoursInfo = ` [Horaires: ${hours.open}-${hours.close}]`;
            }
          } else if (a.openingHours) {
            hoursInfo = ` [Horaires: ${a.openingHours.open}-${a.openingHours.close}]`;
          }

          // Viator bookable flag
          const viatorFlag = a.providerName === 'Viator' ? ' [Viator]' : '';

          return `    - [${a.id}] ${a.name} (${a.type}, ${durationStr}, ${ratingStr}, ${reviewStr}, ${gpsStr}${hoursInfo}${viatorFlag})`;
        })
        .join('\n');
      return `  Cluster ${c.dayNumber} (centroïde: ${c.centroid.lat.toFixed(4)}, ${c.centroid.lng.toFixed(4)}, intra=${(c.totalIntraDistance || 0).toFixed(1)}km):\n${budgetHint}\n${activitiesList}`;
    })
    .join('\n\n');

  const mealDesc = meals
    .filter(m => m.restaurant)
    .map(m => `  Jour ${m.dayNumber} ${m.mealType}: ${m.restaurant!.name} (${m.restaurant!.rating || '?'}★)`)
    .join('\n');

  // Weather forecast per day (if available)
  let weatherDesc = '';
  if (data.weatherForecasts && data.weatherForecasts.length > 0) {
    weatherDesc = '\nMÉTÉO PRÉVUE:\n' + data.weatherForecasts
      .slice(0, preferences.durationDays)
      .map((w, idx) => {
        const dayNum = idx + 1;
        const temp = `${w.tempMin}°-${w.tempMax}°C`;
        return `  Jour ${dayNum} (${w.date}): ${w.condition} (${temp})`;
      })
      .join('\n');
  }

  return `Tu es un planificateur de voyage expert. Tu reçois un itinéraire pré-construit algorithmiquement avec des clusters géographiques d'activités. Ton rôle est UNIQUEMENT d'ajuster l'ordre et le rythme.

DONNÉES:
- Destination: ${preferences.destination}
- Durée: ${preferences.durationDays} jours (${startDate.toLocaleDateString('fr-FR')} au ${endDate.toLocaleDateString('fr-FR')})
- Groupe: ${preferences.groupType} (${preferences.groupSize} personnes)
- Budget: ${preferences.budgetLevel}
- Transport: ${transport?.mode || 'non défini'}
- Hôtel: ${hotel?.name || 'non défini'}

CLUSTERS D'ACTIVITÉS:
${clusterDesc}

RESTAURANTS ASSIGNÉS:
${mealDesc || '  (aucun)'}${weatherDesc}

RÈGLES STRICTES:
1. Tu NE PEUX PAS ajouter, supprimer ou inventer de nouvelles activités
2. Tu peux UNIQUEMENT réordonner les jours et l'ordre de visite dans chaque jour
3. Le Jour 1 = arrivée (suggérer un start plus tardif si vol)
4. Le dernier jour = départ (moins d'activités)
5. Musées/monuments le matin, quartiers/marchés l'après-midi
6. Par défaut, évite les pauses explicites: mets "restBreak": true uniquement pour une journée vraiment dense (>=5 activités ou charge très élevée)
7. Pas 2 musées longs le même jour
8. Optimise l'ordre géographique : utilise les coordonnées GPS pour minimiser les déplacements intra-journée
9. RESPECTE les horaires d'ouverture : évite de programmer des lieux fermés (marqués [FERMÉ ce jour])
10. ADAPTE selon la météo : privilégie les activités intérieures (musées, monuments couverts) les jours de pluie, et les activités extérieures (parcs, jardins, marchés) les jours ensoleillés
11. JAMAIS 2 activités expérientielles similaires (cours de cuisine, dégustation, food tour) le même jour — les répartir sur des jours différents
12. Respecte les budgets journaliers: charge globale équilibrée (durées + déplacements + activités lourdes)
13. Jours arrivée/départ: alléger fortement (moins d'activités et moins de déplacements)

IMPORTANT — THÈME ET NARRATIVE:
14. Le "theme" et "dayNarrative" doivent UNIQUEMENT mentionner les activités listées ci-dessus pour ce jour
15. NE MENTIONNE AUCUNE attraction qui n'est PAS dans la liste du cluster de ce jour
16. Si tu ne sais pas quel thème créer, utilise les noms exacts des 1-2 premières activités du jour
17. N'invente JAMAIS de noms de lieux, utilise uniquement ceux fournis dans les clusters

RÉPONDS EN JSON STRICT (pas de texte avant/après):
{
  "days": [
    {
      "dayNumber": 1,
      "theme": "Thème court (max 6 mots)",
      "dayNarrative": "Description de la journée (1-2 phrases)",
      "activityOrder": ["activity-id-1", "activity-id-2"],
      "suggestedStartTime": "10:00",
      "restBreak": false,
      "isDayTrip": false
    }
  ],
  "dayOrderReason": "Pourquoi cet ordre de jours (1 phrase)"
}`;
}

function parsePlan(text: string, clusters: ActivityCluster[], cityCenter?: { lat: number; lng: number }): BalancedPlan {
  try {
    // Extract JSON from response (may have markdown code fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.days || !Array.isArray(parsed.days)) {
      throw new Error('Invalid plan structure');
    }

    const totalDays = clusters.length;
    const clustersByDay = new Map(clusters.map((cluster) => [cluster.dayNumber, cluster]));
    const days: BalancedDay[] = parsed.days.map((d: any) => {
      const dayNumber = d.dayNumber || 1;
      const cluster = clustersByDay.get(dayNumber);
      return {
        dayNumber,
        theme: d.theme || '',
        dayNarrative: d.dayNarrative || '',
        activityOrder: Array.isArray(d.activityOrder) ? d.activityOrder : [],
        suggestedStartTime: d.suggestedStartTime || '09:00',
        restBreak: shouldKeepRestBreak(d.restBreak === true, cluster, dayNumber, totalDays),
        isDayTrip: d.isDayTrip === true,
        dayTripDestination: d.dayTripDestination || undefined,
      };
    });

    return {
      days,
      dayOrderReason: parsed.dayOrderReason || '',
    };
  } catch (error) {
    console.warn('[Pipeline V2] Failed to parse Claude response, using fallback:', error);
    return buildDeterministicPlan(clusters, cityCenter);
  }
}

function shouldKeepRestBreak(
  requested: boolean,
  cluster: ActivityCluster | undefined,
  dayNumber: number,
  totalDays: number
): boolean {
  if (!requested || !cluster) return false;

  // Keep rest breaks exceptional and mostly user-driven: never on boundary days,
  // and only for genuinely dense schedules.
  if (dayNumber === 1 || dayNumber === totalDays) return false;

  const totalActivityMin = cluster.activities.reduce((sum, activity) => sum + (activity.duration || 60), 0);
  const heavyActivities = cluster.activities.filter((activity) => (activity.duration || 60) >= 120).length;
  return cluster.activities.length >= 5 || heavyActivities >= 3 || totalActivityMin >= 420;
}

/**
 * Deterministic fallback when Claude is unavailable.
 * Detects day-trips by checking if a cluster's centroid is >30km from city center.
 */
function buildDeterministicPlan(
  clusters: ActivityCluster[],
  cityCenter?: { lat: number; lng: number }
): BalancedPlan {
  const totalDays = clusters.length;
  const days: BalancedDay[] = clusters.map((cluster) => {
    const isFirstDay = cluster.dayNumber === 1;
    const isLastDay = cluster.dayNumber === totalDays;

    // Detect day-trip: cluster centroid >30km from city center
    let isDayTrip = false;
    let dayTripDestination: string | undefined;
    if (cityCenter && cityCenter.lat !== 0 && cityCenter.lng !== 0) {
      const distFromCenter = calculateDistance(
        cityCenter.lat, cityCenter.lng,
        cluster.centroid.lat, cluster.centroid.lng
      );
      if (distFromCenter > 30) {
        isDayTrip = true;
        // Use the first activity's name as a hint for the day-trip destination
        dayTripDestination = cluster.activities[0]?.name || undefined;
        console.log(`[Pipeline V2] Deterministic fallback: Day ${cluster.dayNumber} detected as day-trip (${distFromCenter.toFixed(1)}km from center)`);
      }
    }

    return {
      dayNumber: cluster.dayNumber,
      theme: generateTheme(cluster),
      dayNarrative: isFirstDay
        ? `Arrivée et premières découvertes — ${cluster.activities.length} activités prévues.`
        : isLastDay
          ? `Dernières visites avant le départ — ${cluster.activities.length} activités prévues.`
          : isDayTrip
            ? `Excursion à la journée — ${cluster.activities.length} activités prévues.`
            : `Journée de découverte — ${cluster.activities.length} activités prévues.`,
      activityOrder: cluster.activities.map(a => a.id),
      suggestedStartTime: isFirstDay ? '10:00' : isDayTrip ? '08:00' : '09:00',
      restBreak: false,
      isDayTrip,
      dayTripDestination,
    };
  });

  return {
    days,
    dayOrderReason: 'Ordre par clusters géographiques (fallback déterministe)',
  };
}

function generateTheme(cluster: ActivityCluster): string {
  const types = cluster.activities.map(a => (a.type || '').toLowerCase());

  if (types.some(t => t.includes('museum') || t.includes('gallery'))) return 'Culture & Musées';
  if (types.some(t => t.includes('park') || t.includes('garden') || t.includes('nature'))) return 'Nature & Jardins';
  if (types.some(t => t.includes('market') || t.includes('souk') || t.includes('bazaar'))) return 'Marchés & Shopping';
  if (types.some(t => t.includes('palace') || t.includes('castle') || t.includes('historic'))) return 'Histoire & Patrimoine';
  if (types.some(t => t.includes('religious') || t.includes('mosque') || t.includes('church'))) return 'Spiritualité & Architecture';

  return 'Exploration & Découverte';
}

/**
 * Post-validation: ensure each day's theme/narrative actually matches its activities.
 * Claude sometimes hallucinates themes that describe activities from other days.
 * If a theme doesn't reference any of the day's actual activities, regenerate it.
 */
function validateAndFixThemes(plan: BalancedPlan, clusters: ActivityCluster[]): BalancedPlan {
  for (const day of plan.days) {
    const cluster = clusters.find(c => c.dayNumber === day.dayNumber);
    if (!cluster || cluster.activities.length === 0) continue;

    // Extract keywords from activity names (words longer than 3 chars)
    const activityKeywords = cluster.activities
      .map(a => (a.name || '').toLowerCase())
      .filter(Boolean);

    // Check if the theme mentions at least one activity keyword
    const themeLower = (day.theme || '').toLowerCase();
    const themeMatchesContent = activityKeywords.some(kw =>
      kw.split(/\s+/).some(word => word.length > 3 && themeLower.includes(word))
    );

    if (!themeMatchesContent && activityKeywords.length > 0) {
      const mainNames = cluster.activities
        .slice(0, 3)
        .map(a => a.name)
        .filter(Boolean);

      const oldTheme = day.theme;
      day.theme = mainNames.length > 1
        ? `${mainNames[0]} et ${mainNames[1]}`
        : mainNames[0] || 'Exploration & Découverte';

      day.dayNarrative = `Journée consacrée à ${mainNames.join(', ')}. ${cluster.activities.length} activités prévues.`;

      console.log(`[Pipeline V2] Theme mismatch fixed for day ${day.dayNumber}: "${oldTheme}" → "${day.theme}"`);
    }
  }
  return plan;
}

/**
 * Call Gemini Flash to balance and humanize the day plan.
 * Uses the same prompt as Claude for consistency.
 */
export async function balanceDaysWithGemini(
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  data: FetchedData
): Promise<BalancedPlan> {
  // Compute city center as average of all cluster centroids (used for day-trip detection)
  const cityCenter = clusters.length > 0
    ? {
        lat: clusters.reduce((s, c) => s + c.centroid.lat, 0) / clusters.length,
        lng: clusters.reduce((s, c) => s + c.centroid.lng, 0) / clusters.length,
      }
    : { lat: 0, lng: 0 };

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[Pipeline V2] No GOOGLE_AI_API_KEY, fallback to Claude');
    return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
  }

  try {
    const prompt = buildPrompt(clusters, meals, hotel, transport, preferences, data);

    const response = await Promise.race([
      fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000,
          },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout (30s)')), 30000)
      ),
    ]);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[Pipeline V2] Gemini API error:', response.status, errorText);
      console.warn('[Pipeline V2] Falling back to Claude');
      return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
    }

    const geminiData: GeminiResponse = await response.json();

    if (geminiData.error) {
      console.warn('[Pipeline V2] Gemini error:', geminiData.error.message);
      console.warn('[Pipeline V2] Falling back to Claude');
      return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
    }

    // Log token usage
    const usage = geminiData.usageMetadata;
    if (usage) {
      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;
      // Gemini Flash pricing (approx $0.075/1M input, $0.30/1M output)
      const costUsd = (inputTokens * 0.075 + outputTokens * 0.30) / 1_000_000;
      console.log(`[Pipeline V2] Gemini Flash tokens: ${inputTokens} in + ${outputTokens} out, ~$${costUsd.toFixed(4)}`);
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn('[Pipeline V2] Gemini returned no text, falling back to Claude');
      return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
    }

    return validateAndFixThemes(parsePlan(text, clusters, cityCenter), clusters);
  } catch (error) {
    console.warn('[Pipeline V2] Gemini balancing failed, falling back to Claude:', error instanceof Error ? error.message : error);
    return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
  }
}

/**
 * Router function: selects Gemini or Claude based on environment variable.
 * Defaults to Claude for safety.
 */
export async function balanceDays(
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences,
  data: FetchedData
): Promise<BalancedPlan> {
  const useGemini = process.env.USE_GEMINI_BALANCE === 'true';

  if (useGemini) {
    console.log('[Pipeline V2] Using Gemini Flash for day balancing');
    return balanceDaysWithGemini(clusters, meals, hotel, transport, preferences, data);
  }

  console.log('[Pipeline V2] Using Claude for day balancing');
  return balanceDaysWithClaude(clusters, meals, hotel, transport, preferences, data);
}
