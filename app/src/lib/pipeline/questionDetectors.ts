/**
 * Smart Question Detectors — rule-based, no LLM.
 *
 * Runs BETWEEN pipeline steps (after step 2, before clustering).
 * Pure functions that inspect scored activities and day trip suggestions.
 */

import type { PipelineQuestion } from '../types/pipelineQuestions';
import type { TripPreferences } from '../types';
import type { ScoredActivity, FetchedData } from './types';
import type { DayTripSuggestion } from '../services/dayTripSuggestions';

const MAX_QUESTIONS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

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
 */
export function applyQuestionAnswers(
  answers: Array<{ questionId: string; selectedOptionId: string }>,
  activities: ScoredActivity[],
  data: FetchedData,
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
