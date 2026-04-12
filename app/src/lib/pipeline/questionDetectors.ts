/**
 * Smart Question Detectors — rule-based + LLM-powered.
 *
 * Two phases:
 *   Phase A (pre-fetch): LLM questions about travel style, highlights, accommodation.
 *     Runs AFTER Step 0 region resolver, BEFORE Step 1 fetch.
 *   Phase B (post-scoring): rule-based + LLM questions about activities.
 *     Runs AFTER Step 2 scoring, BEFORE clustering.
 */

import type { PipelineQuestion, QuestionEffect } from '../types/pipelineQuestions';
import type { TripPreferences } from '../types';
import type { ScoredActivity, FetchedData } from './types';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';
import type { DestinationIntel, DestinationAnalysis } from './step0-destination-intel';
import { fetchGeminiWithRetry } from '../services/geminiSearch';

const MAX_QUESTIONS = 2;
const MAX_PRE_FETCH_QUESTIONS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Detector 1: Full-day activities (duration >= 240min)
// ---------------------------------------------------------------------------
function detectFullDayQuestions(activities: ScoredActivity[]): PipelineQuestion[] {
  const fullDay = activities.find(a => (a.duration || 0) >= 240 && !a.mustSee);
  if (!fullDay) return [];

  return [{
    questionId: `fullday-${fullDay.id || fullDay.name}`,
    sessionId: '', // filled by caller
    type: 'full_day_activity',
    title: fullDay.name,
    prompt: `Voulez-vous dédier une journée entière à ${fullDay.name} ?`,
    options: [
      { id: 'yes', label: 'Oui, une journée complète', emoji: '🎢', isDefault: true },
      { id: 'short', label: 'Juste une visite rapide', emoji: '⏱️', isDefault: false },
      { id: 'skip', label: 'Pas intéressé', emoji: '✕', isDefault: false },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { activityId: fullDay.id, activityName: fullDay.name },
  }];
}

// ---------------------------------------------------------------------------
// Detector 2: Day trips
// ---------------------------------------------------------------------------
function detectDayTripQuestions(
  suggestions: DayTripSuggestion[],
  preferences: TripPreferences,
): PipelineQuestion[] {
  if (suggestions.length === 0 || preferences.durationDays <= 2) return [];

  const best = suggestions[0];
  const transportLabel = best.transportMode === 'RER' ? 'RER' : best.transportMode;
  return [{
    questionId: `daytrip-${best.destination}`,
    sessionId: '',
    type: 'day_trip',
    title: `Excursion à ${best.destination}`,
    prompt: `On peut organiser une excursion à ${best.destination} (${transportLabel}, ${best.transportDurationMin} min). Ça vous tente ?`,
    options: [
      { id: 'include', label: `Oui, direction ${best.destination}`, emoji: '🚆', isDefault: true },
      { id: 'skip', label: 'Non, rester en ville', emoji: '🏙️', isDefault: false },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { destination: best.destination },
  }];
}

// ---------------------------------------------------------------------------
// Detector 3: Activity balance (culture vs outdoor ratio)
// ---------------------------------------------------------------------------
function detectBalanceQuestion(activities: ScoredActivity[]): PipelineQuestion | null {
  if (activities.length < 10) return null;

  const cultureKeywords = /museum|musée|gallery|galerie|cathedral|cathédrale|basilica|basilique|church|église|palace|palais|castle|château|monument|temple/i;
  const outdoorKeywords = /park|parc|garden|jardin|beach|plage|lake|lac|trail|randonnée|nature|forest|forêt|mountain|montagne|kayak|surf|hike|cycling|vélo/i;

  let culture = 0;
  let outdoor = 0;
  for (const a of activities) {
    const text = `${a.name} ${a.description || ''} ${a.type || ''}`;
    if (cultureKeywords.test(text)) culture++;
    if (outdoorKeywords.test(text)) outdoor++;
  }

  if (outdoor === 0) outdoor = 1; // avoid division by zero
  const ratio = culture / outdoor;

  if (ratio <= 2.5) return null;

  return {
    questionId: 'balance-style',
    sessionId: '',
    type: 'activity_balance',
    title: 'Votre style de visite',
    prompt: 'Beaucoup de musées et sites culturels détectés. Comment équilibrer ?',
    options: [
      { id: 'culture', label: 'Plutôt musées', emoji: '🏛️', isDefault: false },
      { id: 'balanced', label: 'Équilibré', emoji: '⚖️', isDefault: true },
      { id: 'outdoor', label: 'Plus de plein air', emoji: '🌿', isDefault: false },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { cultureCount: culture, outdoorCount: outdoor, ratio },
  };
}

function detectTravelStyleGateQuestion(
  preferences: TripPreferences,
  analysis: DestinationAnalysis | null,
): Omit<PipelineQuestion, 'sessionId'> | null {
  if (preferences.travelStyle && preferences.travelStyle !== 'auto') return null;
  const isRegional = analysis?.inputType && analysis.inputType !== 'city';
  const candidateCities = analysis?.resolvedCities?.length || 0;
  if (!isRegional && candidateCities <= 1) return null;

  const recommended: 'single_base' | 'road_trip' =
    preferences.durationDays >= 6 || candidateCities >= 3 || preferences.carRental
      ? 'road_trip'
      : 'single_base';

  return {
    questionId: 'travel-style-gate',
    type: 'travel_style_gate',
    title: 'Style du voyage',
    prompt: 'Tu préfères un séjour avec une base fixe ou un road trip multi-étapes ?',
    options: [
      {
        id: 'single_base',
        label: 'Base unique (moins de valises)',
        emoji: '🏨',
        isDefault: recommended === 'single_base',
        effect: { type: 'set_travel_mode', value: 'single_base' },
      },
      {
        id: 'road_trip',
        label: 'Road trip (plus de lieux)',
        emoji: '🚗',
        isDefault: recommended === 'road_trip',
        effect: { type: 'set_travel_mode', value: 'road_trip' },
      },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: {
      source: 'deterministic_pre_fetch',
      inputType: analysis?.inputType || 'unknown',
      candidateCities,
    },
  };
}

function detectMobilityQuestion(
  preferences: TripPreferences,
  analysis: DestinationAnalysis | null,
): Omit<PipelineQuestion, 'sessionId'> | null {
  if (preferences.transport && preferences.transport !== 'optimal') return null;
  const isRegional = analysis?.inputType && analysis.inputType !== 'city';
  const recommendsCar = Boolean(preferences.carRental || isRegional);

  return {
    questionId: 'mobility-on-site',
    type: 'pre_fetch_llm',
    title: 'Mobilité sur place',
    prompt: 'Sur place, tu veux plutôt transports publics ou voiture ?',
    options: [
      {
        id: 'public',
        label: 'Transports publics',
        emoji: '🚆',
        isDefault: !recommendsCar,
        effect: { type: 'set_transport', value: 'optimal' },
      },
      {
        id: 'car',
        label: 'Voiture',
        emoji: '🚗',
        isDefault: recommendsCar,
        effect: { type: 'set_transport', value: 'car' },
      },
      {
        id: 'flex',
        label: 'Flexible',
        emoji: '🧭',
        isDefault: false,
        effect: { type: 'noop' },
      },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { source: 'deterministic_pre_fetch' },
  };
}

function detectPaceQuestion(preferences: TripPreferences): Omit<PipelineQuestion, 'sessionId'> | null {
  if (preferences.pace) return null;
  return {
    questionId: 'pace-pref',
    type: 'pre_fetch_llm',
    title: 'Rythme du séjour',
    prompt: 'Quel rythme tu préfères pour ce voyage ?',
    options: [
      {
        id: 'relaxed',
        label: 'Chill / détente',
        emoji: '🌿',
        isDefault: false,
        effect: { type: 'set_preference', key: 'pace', value: 'relaxed' },
      },
      {
        id: 'moderate',
        label: 'Équilibré',
        emoji: '⚖️',
        isDefault: true,
        effect: { type: 'set_preference', key: 'pace', value: 'moderate' },
      },
      {
        id: 'intensive',
        label: 'Très actif',
        emoji: '⚡',
        isDefault: false,
        effect: { type: 'set_preference', key: 'pace', value: 'intensive' },
      },
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    metadata: { source: 'deterministic_pre_fetch' },
  };
}

function detectDeterministicPreFetchQuestions(
  preferences: TripPreferences,
  analysis: DestinationAnalysis | null,
): Omit<PipelineQuestion, 'sessionId'>[] {
  const questions: Omit<PipelineQuestion, 'sessionId'>[] = [];
  const travelStyleQ = detectTravelStyleGateQuestion(preferences, analysis);
  if (travelStyleQ) questions.push(travelStyleQ);
  if (questions.length < MAX_PRE_FETCH_QUESTIONS) {
    const mobilityQ = detectMobilityQuestion(preferences, analysis);
    if (mobilityQ) questions.push(mobilityQ);
  }
  if (questions.length < MAX_PRE_FETCH_QUESTIONS) {
    const paceQ = detectPaceQuestion(preferences);
    if (paceQ) questions.push(paceQ);
  }
  return questions.slice(0, MAX_PRE_FETCH_QUESTIONS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectQuestions(
  activities: ScoredActivity[],
  dayTripSuggestions: DayTripSuggestion[],
  preferences: TripPreferences,
): Omit<PipelineQuestion, 'sessionId'>[] {
  const questions: Omit<PipelineQuestion, 'sessionId'>[] = [];

  questions.push(...detectFullDayQuestions(activities));
  if (questions.length < MAX_QUESTIONS) {
    questions.push(...detectDayTripQuestions(dayTripSuggestions, preferences));
  }
  if (questions.length < MAX_QUESTIONS) {
    const balance = detectBalanceQuestion(activities);
    if (balance) questions.push(balance);
  }

  return questions.slice(0, MAX_QUESTIONS);
}

/**
 * Apply user answers by mutating the activities array and data in-place.
 * Handles both legacy hardcoded questions and new effect-based questions.
 */
export function applyQuestionAnswers(
  answers: Array<{ questionId: string; selectedOptionId: string }>,
  activities: ScoredActivity[],
  data: FetchedData,
  preferences?: TripPreferences,
): void {
  for (const { questionId, selectedOptionId } of answers) {
    // Full-day activity: short → downgrade to 120min, skip → remove entirely
    if (questionId.startsWith('fullday-')) {
      const activityId = questionId.replace('fullday-', '');
      const idx = activities.findIndex(a => (a.id || a.name) === activityId);
      if (idx !== -1) {
        if (selectedOptionId === 'skip') {
          console.log(`[SmartQ] Removing full-day activity: ${activities[idx].name}`);
          activities.splice(idx, 1);
        } else if (selectedOptionId === 'short') {
          console.log(`[SmartQ] Downgrading to short visit: ${activities[idx].name} (${activities[idx].duration}min → 120min)`);
          activities[idx].duration = 120;
        }
        // 'yes' → keep as-is (full day)
      }
    }

    // Day trip: skip → remove from suggestions so clustering ignores it
    if (questionId.startsWith('daytrip-') && selectedOptionId === 'skip') {
      const destination = questionId.replace('daytrip-', '');
      data.dayTripSuggestions = data.dayTripSuggestions.filter(
        s => s.destination !== destination
      );
      delete data.dayTripActivities[destination];
      delete data.dayTripRestaurants[destination];
      console.log(`[SmartQ] Skipping day trip: ${destination}`);
    }

    // Activity balance: adjust context bonus on cultural vs outdoor activities
    if (questionId === 'balance-style') {
      const cultureKeywords = /museum|musée|gallery|galerie|cathedral|cathédrale|basilica|basilique|church|église|palace|palais|castle|château|monument|temple/i;
      const outdoorKeywords = /park|parc|garden|jardin|beach|plage|lake|lac|trail|randonnée|nature|forest|forêt|mountain|montagne|kayak|surf|hike|cycling|vélo/i;

      const bonus = selectedOptionId === 'culture' ? 10 : selectedOptionId === 'outdoor' ? -10 : 0;

      if (bonus !== 0) {
        for (const a of activities) {
          const text = `${a.name} ${a.description || ''} ${a.type || ''}`;
          if (cultureKeywords.test(text)) {
            a.score += bonus;
          }
          if (outdoorKeywords.test(text)) {
            a.score -= bonus;
          }
        }
        // Re-sort by score descending
        activities.sort((a, b) => b.score - a.score);
        console.log(`[SmartQ] Balance adjusted: ${selectedOptionId} (bonus=${bonus})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase A: LLM-powered pre-fetch questions
// ---------------------------------------------------------------------------

interface LLMQuestionRaw {
  questionId: string;
  title: string;
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    emoji?: string;
    isDefault?: boolean;
    effect: QuestionEffect;
  }>;
}

/**
 * Generate contextual questions via LLM BEFORE the main pipeline fetch.
 * Context: destination type, budget, duration, group — but NO activity data yet.
 */
export async function detectPreFetchQuestions(
  preferences: TripPreferences,
  analysis: DestinationAnalysis | null,
  intel: DestinationIntel | null,
): Promise<Omit<PipelineQuestion, 'sessionId'>[]> {
  const deterministic = detectDeterministicPreFetchQuestions(preferences, analysis);
  if (deterministic.length >= MAX_PRE_FETCH_QUESTIONS) {
    return deterministic.slice(0, MAX_PRE_FETCH_QUESTIONS);
  }

  const dest = preferences.destination;
  const analysisContext = analysis
    ? `Type de destination : ${analysis.inputType}. Villes proposées : ${analysis.resolvedCities.map(c => `${c.name} (${c.stayDuration}j — ${c.highlights.join(', ')})`).join(' ; ')}.`
    : `Destination : ${dest} (ville).`;

  const intelContext = intel?.mustSeeAttractions
    ? `Activités phares : ${intel.mustSeeAttractions.slice(0, 5).map(a => a.name).join(', ')}.`
    : '';

  const prompt = `Tu es un conseiller voyage expert. Un utilisateur prépare un voyage :
- ${analysisContext}
- Durée : ${preferences.durationDays} jours
- Groupe : ${preferences.groupSize} personnes, ${preferences.groupType}
- Budget : ${preferences.budgetLevel}${preferences.budgetCustom ? ` (${preferences.budgetCustom}€${preferences.budgetIsPerPerson ? '/personne' : ' total'})` : ''}
- Transport : ${preferences.transport}${preferences.carRental ? ', avec voiture de location' : ''}
- Intérêts : ${preferences.activities?.join(', ') || 'non précisé'}
${intelContext ? `- ${intelContext}` : ''}

Génère 2-3 questions COURTES et pertinentes pour affiner ce voyage. Chaque question a 2-3 options.

TYPES D'EFFETS DISPONIBLES pour chaque option :
- {"type":"set_travel_mode","value":"single_base"} ou {"type":"set_travel_mode","value":"road_trip"}
- {"type":"set_transport","value":"optimal|plane|train|car|bus"}
- {"type":"set_car_rental","value":true|false}
- {"type":"add_day_trip","destination":"Nom du lieu"}
- {"type":"add_avoid","name":"Nom à éviter"}
- {"type":"adjust_scores","category":"culture|nature|adventure|food|nightlife","delta":10} (ou -10)
- {"type":"set_preference","key":"pace","value":"relaxed|moderate|intensive"}
- {"type":"noop"} (pas d'effet, option neutre)

RÈGLES :
- Ne pose PAS de questions sur ce qu'on sait déjà (budget, dates, taille du groupe)
- Pose des questions SPÉCIFIQUES à cette destination (pas génériques)
- Chaque option DOIT avoir un champ "effect" avec un des types ci-dessus
- Une seule option par question doit avoir "isDefault": true
- Les questions doivent être en français

Réponds en JSON strict : { "questions": [ { "questionId": string, "title": string, "prompt": string, "options": [{ "id": string, "label": string, "emoji": string, "isDefault": boolean, "effect": {...} }] } ] }`;

  try {
    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      } as any,
    });

    if (!response.ok) {
      console.warn(`[SmartQ LLM] Pre-fetch questions failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || '').join('').trim();
    if (!text) return [];

    const parsed = extractJsonQuestions(text);
    if (!parsed || parsed.length === 0) return [];

    // Convert to PipelineQuestion format
    const llmQuestions: Omit<PipelineQuestion, 'sessionId'>[] = parsed
      .slice(0, MAX_PRE_FETCH_QUESTIONS)
      .map(q => ({
        questionId: `llm-pre-${q.questionId}`,
        type: 'pre_fetch_llm' as const,
        title: q.title,
        prompt: q.prompt,
        options: q.options.map(o => ({
          id: o.id,
          label: o.label,
          emoji: o.emoji,
          isDefault: !!o.isDefault,
          effect: validateEffect(o.effect),
        })),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        metadata: { source: 'llm_pre_fetch' },
      }));

    const merged = [...deterministic];
    for (const q of llmQuestions) {
      if (merged.length >= MAX_PRE_FETCH_QUESTIONS) break;
      if (merged.some(existing => existing.questionId === q.questionId)) continue;
      merged.push(q);
    }
    console.log(`[SmartQ LLM] Generated ${llmQuestions.length} LLM pre-fetch questions (${merged.length} total with deterministic)`);
    return merged;
  } catch (e) {
    console.warn('[SmartQ LLM] Pre-fetch questions error:', e);
    return deterministic;
  }
}

/**
 * Apply effects from LLM question answers.
 * Mutates preferences and data based on structured effects.
 */
export function applyEffects(
  answers: Array<{ questionId: string; selectedOptionId: string; effect?: QuestionEffect }>,
  preferences: TripPreferences,
  data?: FetchedData,
  activities?: ScoredActivity[],
): void {
  for (const { questionId, selectedOptionId, effect } of answers) {
    if (!effect || effect.type === 'noop') continue;

    switch (effect.type) {
      case 'set_travel_mode':
        preferences.travelStyle = effect.value;
        console.log(`[SmartQ Effect] Travel mode → ${effect.value}`);
        break;

      case 'set_transport':
        preferences.transport = effect.value;
        if (effect.value === 'car') preferences.carRental = true;
        console.log(`[SmartQ Effect] Transport → ${effect.value}`);
        break;

      case 'set_car_rental':
        preferences.carRental = effect.value;
        if (effect.value && preferences.transport === 'optimal') {
          preferences.transport = 'car';
        }
        console.log(`[SmartQ Effect] Car rental → ${effect.value}`);
        break;

      case 'add_day_trip':
        // Add as a pre-purchased ticket so the pipeline properly integrates it as a day trip
        if (!preferences.prePurchasedTickets) preferences.prePurchasedTickets = [];
        if (!preferences.prePurchasedTickets.some(t => t.name === effect.destination)) {
          preferences.prePurchasedTickets.push({
            name: effect.destination,
            notes: 'Ajouté via suggestion voyage',
          });
        }
        console.log(`[SmartQ Effect] Added day trip as pre-purchased ticket: ${effect.destination}`);
        break;

      case 'add_avoid':
        // Persist in mustSee with AVOID: prefix — step 2 scoring reads this to penalize matching activities
        if (!preferences.mustSee) preferences.mustSee = '';
        const avoidTag = `AVOID:${effect.name}`;
        if (!preferences.mustSee.includes(avoidTag)) {
          preferences.mustSee = preferences.mustSee
            ? `${preferences.mustSee}, ${avoidTag}`
            : avoidTag;
        }
        // Also immediately penalize matching activities if available
        if (activities) {
          const avoidLower = effect.name.toLowerCase();
          for (const a of activities) {
            if (a.name.toLowerCase().includes(avoidLower)) {
              a.score -= 1000; // effectively removes it from selection
            }
          }
          activities.sort((x, y) => y.score - x.score);
        }
        console.log(`[SmartQ Effect] Added to avoid list: ${effect.name}`);
        break;

      case 'adjust_scores':
        if (activities) {
          const cat = effect.category.toLowerCase();
          const keywords = getCategoryKeywords(cat);
          if (keywords) {
            for (const a of activities) {
              const text = `${a.name} ${a.description || ''} ${a.type || ''}`.toLowerCase();
              if (keywords.test(text)) {
                a.score += effect.delta;
              }
            }
            activities.sort((x, y) => y.score - x.score);
            console.log(`[SmartQ Effect] Scores adjusted: ${cat} ${effect.delta > 0 ? '+' : ''}${effect.delta}`);
          }
        }
        break;

      case 'set_preference':
        if (effect.key === 'pace' && (effect.value === 'relaxed' || effect.value === 'moderate' || effect.value === 'intensive')) {
          preferences.pace = effect.value;
          console.log(`[SmartQ Effect] Pace → ${effect.value}`);
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCategoryKeywords(category: string): RegExp | null {
  const map: Record<string, RegExp> = {
    culture: /museum|musée|gallery|galerie|cathedral|cathédrale|church|église|palace|palais|castle|château|monument|temple|opera|théâtre/i,
    nature: /park|parc|garden|jardin|beach|plage|lake|lac|trail|randonnée|nature|forest|forêt|mountain|montagne/i,
    adventure: /kayak|surf|hike|cycling|vélo|rafting|climbing|escalade|zipline|diving|plongée|paragliding/i,
    food: /restaurant|food|cuisine|gastronomy|gastronomie|marché|market|cooking|dégustation|tasting/i,
    nightlife: /bar|club|nightlife|pub|rooftop|cocktail|jazz|concert|live music/i,
  };
  return map[category] || null;
}

function validateEffect(effect: any): QuestionEffect {
  if (!effect || typeof effect !== 'object') return { type: 'noop' };

  const validTypes = [
    'set_travel_mode',
    'set_transport',
    'set_car_rental',
    'add_day_trip',
    'add_avoid',
    'adjust_scores',
    'set_preference',
    'noop',
  ];
  if (!validTypes.includes(effect.type)) return { type: 'noop' };

  return effect as QuestionEffect;
}

function extractJsonQuestions(text: string): LLMQuestionRaw[] | null {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.questions) ? parsed.questions : null;
  } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      return Array.isArray(parsed?.questions) ? parsed.questions : null;
    } catch { /* continue */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(text.substring(braceStart, braceEnd + 1));
      return Array.isArray(parsed?.questions) ? parsed.questions : null;
    } catch { /* continue */ }
  }

  return null;
}
