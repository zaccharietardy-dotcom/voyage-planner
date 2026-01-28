/**
 * ClaudeAdvisor - Appels Claude Haiku pour les décisions ambiguës
 *
 * Seulement appelé quand la logique déterministe ne suffit pas:
 * - Arrivée tardive: hôtel direct ou dîner ?
 * - Gap > 2h: quelle activité de remplissage ?
 * - Énergie basse: continuer ou arrêter ?
 *
 * Coût estimé: 1-3 appels Haiku par voyage (~0.02-0.05€)
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  AdvisorRequest,
  AdvisorResponse,
  AdvisorOption,
  TravelerStateSummary,
} from './types';
import { applyFallbackRules } from './FallbackRules';

// ============================================
// Cache de patterns courants
// ============================================

interface CacheKey {
  question: string;
  timeRange: string; // "morning" | "afternoon" | "evening" | "night"
  energy: string;
}

function getTimeRange(time: string): string {
  const hour = parseInt(time.split(':')[0]);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getCacheKey(request: AdvisorRequest): string {
  return `${request.question}:${getTimeRange(request.state.time)}:${request.state.energy}`;
}

// ============================================
// ClaudeAdvisor
// ============================================

export class ClaudeAdvisor {
  private client: Anthropic | null = null;
  private cache = new Map<string, AdvisorResponse>();
  private callCount = 0;
  private maxCalls: number;

  constructor(maxCalls: number = 5) {
    this.maxCalls = maxCalls;
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        this.client = new Anthropic({ apiKey });
      }
    } catch {
      console.log('[ClaudeAdvisor] API key non disponible, fallback rules activées');
    }
  }

  /**
   * Demande conseil à Claude pour une décision ambiguë
   */
  async advise(request: AdvisorRequest): Promise<AdvisorResponse> {
    // 1. Vérifier le cache
    const cacheKey = getCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[ClaudeAdvisor] Cache hit: ${cacheKey}`);
      return cached;
    }

    // 2. Si pas de client ou trop d'appels, fallback
    if (!this.client || this.callCount >= this.maxCalls) {
      console.log(`[ClaudeAdvisor] Fallback (client=${!!this.client}, calls=${this.callCount}/${this.maxCalls})`);
      return applyFallbackRules(request);
    }

    // 3. Appel Claude Haiku
    try {
      this.callCount++;
      const response = await this.askHaiku(request);

      // Mettre en cache
      this.cache.set(cacheKey, response);

      return response;
    } catch (error) {
      console.error('[ClaudeAdvisor] Erreur API:', error);
      return applyFallbackRules(request);
    }
  }

  private async askHaiku(request: AdvisorRequest): Promise<AdvisorResponse> {
    const prompt = this.buildPrompt(request);

    console.log(`[ClaudeAdvisor] Appel Haiku #${this.callCount}: ${request.question}`);

    const message = await this.client!.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    return this.parseResponse(text, request.options);
  }

  private buildPrompt(request: AdvisorRequest): string {
    const { question, state, options, constraints } = request;

    const optionsText = options
      .map(o => `- ${o.id}: ${o.label} (${o.duration}min)${o.description ? ` - ${o.description}` : ''}`)
      .join('\n');

    const constraintsText = constraints.length > 0
      ? `\nContraintes:\n${constraints.map(c => `- ${c}`).join('\n')}`
      : '';

    return `Tu es un conseiller voyage. Réponds UNIQUEMENT en JSON.

Situation du voyageur:
- Heure: ${state.time}
- Lieu: ${state.location}
- Temps disponible: ${state.availableHours}h
- Énergie: ${state.energy}
- Repas: ${state.meals}
- Type de journée: ${state.dayType}
- Attractions restantes: ${state.pendingCount}
${constraintsText}

Question: ${this.questionToText(question)}

Options:
${optionsText}

Réponds en JSON: {"chosenId": "id_choisi", "reasoning": "explication courte", "confidence": "high|medium|low"}`;
  }

  private questionToText(question: string): string {
    switch (question) {
      case 'late_arrival': return 'Le voyageur arrive tard. Que faire ?';
      case 'gap_fill': return 'Il y a du temps libre. Quelle activité choisir ?';
      case 'activity_order': return 'Dans quel ordre visiter ces lieux ?';
      case 'energy_check': return 'Le voyageur est fatigué. Continuer ou arrêter ?';
      case 'meal_decision': return 'Faut-il manger maintenant ou attendre ?';
      default: return question;
    }
  }

  private parseResponse(text: string, options: AdvisorOption[]): AdvisorResponse {
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Valider que l'ID choisi existe
        const validId = options.find(o => o.id === parsed.chosenId);
        if (validId) {
          return {
            chosenId: parsed.chosenId,
            reasoning: parsed.reasoning || 'Recommandation Claude',
            confidence: parsed.confidence || 'medium',
          };
        }
      }
    } catch {
      console.log('[ClaudeAdvisor] Parsing error, using fallback');
    }

    // Si parsing échoue, prendre la première option
    return {
      chosenId: options[0]?.id || '',
      reasoning: 'Parsing fallback: première option',
      confidence: 'low',
    };
  }

  /** Nombre d'appels API effectués */
  getCallCount(): number {
    return this.callCount;
  }

  /** Reset pour un nouveau voyage */
  reset(): void {
    this.cache.clear();
    this.callCount = 0;
  }
}
