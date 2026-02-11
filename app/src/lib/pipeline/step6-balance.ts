/**
 * Pipeline V2 — Step 6: Claude Day Balancing
 *
 * Single Claude Sonnet call to add "human feel" to the algorithmically-built itinerary.
 * Claude can ONLY reorder, theme, and narrate. It CANNOT add/remove activities.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TripPreferences, TransportOptionSummary, Accommodation } from '../types';
import type { ActivityCluster, MealAssignment, BalancedPlan, BalancedDay } from './types';
import { calculateDistance } from '../services/geocoding';

/**
 * Call Claude to balance and humanize the day plan.
 */
export async function balanceDaysWithClaude(
  clusters: ActivityCluster[],
  meals: MealAssignment[],
  hotel: Accommodation | null,
  transport: TransportOptionSummary | null,
  preferences: TripPreferences
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
    const prompt = buildPrompt(clusters, meals, hotel, transport, preferences);

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
  preferences: TripPreferences
): string {
  const startDate = new Date(preferences.startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + preferences.durationDays - 1);

  const clusterDesc = clusters
    .map(c => {
      const activitiesList = c.activities
        .map(a => `    - [${a.id}] ${a.name} (${a.type}, ${a.duration || 60}min, ${a.rating || '?'}★, ${a.reviewCount || 0} avis, GPS: ${a.latitude?.toFixed(4) || '?'},${a.longitude?.toFixed(4) || '?'})`)
        .join('\n');
      return `  Cluster ${c.dayNumber} (centroïde: ${c.centroid.lat.toFixed(4)}, ${c.centroid.lng.toFixed(4)}):\n${activitiesList}`;
    })
    .join('\n\n');

  const mealDesc = meals
    .filter(m => m.restaurant)
    .map(m => `  Jour ${m.dayNumber} ${m.mealType}: ${m.restaurant!.name} (${m.restaurant!.rating || '?'}★)`)
    .join('\n');

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
${mealDesc || '  (aucun)'}

RÈGLES STRICTES:
1. Tu NE PEUX PAS ajouter, supprimer ou inventer de nouvelles activités
2. Tu peux UNIQUEMENT réordonner les jours et l'ordre de visite dans chaque jour
3. Le Jour 1 = arrivée (suggérer un start plus tardif si vol)
4. Le dernier jour = départ (moins d'activités)
5. Musées/monuments le matin, quartiers/marchés l'après-midi
6. Alterner jours intenses et détendus si possible
7. Pas 2 musées longs le même jour
8. Optimise l'ordre géographique : utilise les coordonnées GPS pour minimiser les déplacements intra-journée

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

    const days: BalancedDay[] = parsed.days.map((d: any) => ({
      dayNumber: d.dayNumber || 1,
      theme: d.theme || '',
      dayNarrative: d.dayNarrative || '',
      activityOrder: Array.isArray(d.activityOrder) ? d.activityOrder : [],
      suggestedStartTime: d.suggestedStartTime || '09:00',
      restBreak: d.restBreak === true,
      isDayTrip: d.isDayTrip === true,
      dayTripDestination: d.dayTripDestination || undefined,
    }));

    return {
      days,
      dayOrderReason: parsed.dayOrderReason || '',
    };
  } catch (error) {
    console.warn('[Pipeline V2] Failed to parse Claude response, using fallback:', error);
    return buildDeterministicPlan(clusters, cityCenter);
  }
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
      restBreak: cluster.activities.length > 4,
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
