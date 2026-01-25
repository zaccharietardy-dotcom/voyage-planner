/**
 * LLM Coherence Checker - Utilise un modèle local (Ollama) pour analyser la cohérence
 *
 * Ce service formate un voyage en texte lisible et demande à un LLM
 * si le planning est cohérent (horaires, enchaînements, logique).
 *
 * Nécessite Ollama en local: https://ollama.ai
 * Installer: curl -fsSL https://ollama.ai/install.sh | sh
 * Lancer un modèle: ollama run llama3.2 (ou mistral, phi3, etc.)
 */

import { Trip, TripDay, TripItem } from '../types';

// Configuration Ollama
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

export interface LLMCoherenceResult {
  isCoherent: boolean;
  issues: string[];
  suggestions: string[];
  rawResponse: string;
  confidence: 'high' | 'medium' | 'low';
  model: string;
}

/**
 * Formate un voyage en texte lisible pour le LLM
 */
export function formatTripForLLM(trip: Trip): string {
  const lines: string[] = [];

  lines.push(`=== VOYAGE: ${trip.preferences.origin} → ${trip.preferences.destination} ===`);
  lines.push(`Date de départ: ${trip.preferences.startDate}`);
  lines.push(`Durée: ${trip.preferences.durationDays} jours`);
  lines.push(`Voyageurs: ${trip.preferences.groupSize} personne(s)`);
  lines.push('');

  for (const day of trip.days) {
    lines.push(`--- JOUR ${day.dayNumber} (${formatDate(day.date)}) ---`);

    // Trier les items par heure de début
    const sortedItems = [...day.items].sort((a, b) => {
      return parseTime(a.startTime) - parseTime(b.startTime);
    });

    for (const item of sortedItems) {
      const icon = getItemIcon(item.type);
      const duration = calculateDuration(item.startTime, item.endTime);
      lines.push(`  ${item.startTime}-${item.endTime} ${icon} ${item.title} (${duration})`);

      // Ajouter des détails pour certains types
      if (item.type === 'flight') {
        lines.push(`    → Transport aérien`);
      } else if (item.type === 'transport' && item.title.toLowerCase().includes('train')) {
        lines.push(`    → Transport ferroviaire`);
      } else if (item.type === 'hotel') {
        lines.push(`    → Hébergement - Check-in`);
      } else if (item.type === 'checkout') {
        lines.push(`    → Hébergement - Check-out`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Analyse la cohérence d'un voyage via Ollama
 */
export async function checkCoherenceWithLLM(trip: Trip): Promise<LLMCoherenceResult> {
  const formattedTrip = formatTripForLLM(trip);

  const prompt = `Tu es un expert en planification de voyages. Analyse ce planning de voyage et vérifie sa COHÉRENCE LOGIQUE.

${formattedTrip}

Vérifie les points suivants:
1. HORAIRES: Les heures sont-elles valides (entre 00:00 et 23:59)?
2. CHEVAUCHEMENTS: Y a-t-il des activités qui se chevauchent?
3. SÉQUENCE LOGIQUE:
   - Jour d'arrivée: le vol/train arrive-t-il AVANT les activités touristiques?
   - Jour de départ: le check-out est-il AVANT le transfert vers l'aéroport/gare?
4. TEMPS DE TRAJET: Y a-t-il assez de temps entre les activités pour se déplacer?
5. REPAS: Petit-déjeuner le matin, déjeuner le midi, dîner le soir?
6. ACTIVITÉS: Peut-on visiter une attraction AVANT d'être arrivé à destination?

Réponds UNIQUEMENT au format JSON suivant (pas de texte avant ou après):
{
  "coherent": true/false,
  "issues": ["liste des problèmes détectés"],
  "suggestions": ["liste de suggestions pour améliorer"],
  "confidence": "high/medium/low"
}`;

  try {
    const response = await callOllama(prompt);
    return parseOllamaResponse(response);
  } catch (error) {
    console.error('[LLMCoherenceChecker] Erreur Ollama:', error);
    return {
      isCoherent: true, // Par défaut, on considère cohérent si Ollama n'est pas disponible
      issues: [],
      suggestions: ['Impossible de vérifier avec le LLM: ' + (error as Error).message],
      rawResponse: '',
      confidence: 'low',
      model: OLLAMA_MODEL,
    };
  }
}

/**
 * Appelle l'API Ollama
 */
async function callOllama(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.1, // Réponses plus déterministes
        num_predict: 1000,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || '';
}

/**
 * Parse la réponse JSON du LLM
 */
function parseOllamaResponse(response: string): LLMCoherenceResult {
  try {
    // Extraire le JSON de la réponse (le LLM peut ajouter du texte avant/après)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LLMCoherenceChecker] Pas de JSON trouvé dans la réponse');
      return createFallbackResult(response);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      isCoherent: parsed.coherent === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      rawResponse: response,
      confidence: parsed.confidence || 'medium',
      model: OLLAMA_MODEL,
    };
  } catch (error) {
    console.warn('[LLMCoherenceChecker] Erreur parsing JSON:', error);
    return createFallbackResult(response);
  }
}

/**
 * Crée un résultat de fallback si le parsing échoue
 */
function createFallbackResult(response: string): LLMCoherenceResult {
  // Analyse basique du texte pour détecter des problèmes
  const lowerResponse = response.toLowerCase();
  const hasIssues =
    lowerResponse.includes('incohérent') ||
    lowerResponse.includes('problème') ||
    lowerResponse.includes('erreur') ||
    lowerResponse.includes('impossible') ||
    lowerResponse.includes('chevauchement');

  return {
    isCoherent: !hasIssues,
    issues: hasIssues ? ['Problèmes détectés (voir rawResponse)'] : [],
    suggestions: [],
    rawResponse: response,
    confidence: 'low',
    model: OLLAMA_MODEL,
  };
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculateDuration(start: string, end: string): string {
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const duration = endMin - startMin;

  if (duration < 60) {
    return `${duration}min`;
  }

  const hours = Math.floor(duration / 60);
  const mins = duration % 60;
  return mins > 0 ? `${hours}h${mins}` : `${hours}h`;
}

function getItemIcon(type: string): string {
  switch (type) {
    case 'flight':
      return '✈️';
    case 'transport':
      return '🚗';
    case 'hotel':
      return '🏨';
    case 'checkout':
      return '🏨';
    case 'checkin':
      return '📋';
    case 'activity':
      return '🎯';
    case 'restaurant':
      return '🍽️';
    case 'parking':
      return '🅿️';
    default:
      return '📍';
  }
}

/**
 * Vérifie si Ollama est disponible
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000), // 2s timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Liste les modèles disponibles sur Ollama
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) return [];

    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch {
    return [];
  }
}
