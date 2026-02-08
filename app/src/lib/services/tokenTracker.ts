/**
 * Token Tracker - Compteur de tokens pour l'API Claude
 *
 * Suit la consommation de tokens pour chaque requête et fournit
 * des statistiques cumulées pour la session.
 *
 * Usage:
 *   import { tokenTracker } from './services/tokenTracker';
 *   tokenTracker.track(response.usage);
 *   console.log(tokenTracker.getStats());
 */

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface RequestLog {
  timestamp: Date;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  operation?: string;
}

export interface TokenStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  averageTokensPerRequest: number;
  sessionStartTime: Date;
  sessionDurationMinutes: number;
  history: RequestLog[];
}

// Prix Claude (janvier 2025) - Claude 3.5 Sonnet
// https://www.anthropic.com/pricing
const PRICING = {
  // Prix par million de tokens
  input: 3.00, // $3.00 / MTok input
  output: 15.00, // $15.00 / MTok output
  cache_write: 3.75, // $3.75 / MTok cache write
  cache_read: 0.30, // $0.30 / MTok cache read
};

class TokenTracker {
  private history: RequestLog[] = [];
  private sessionStart: Date;

  constructor() {
    this.sessionStart = new Date();
  }

  /**
   * Enregistre l'utilisation de tokens d'une requête
   */
  track(usage: TokenUsage, operation?: string): RequestLog {
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;

    // Calculer le coût
    const inputCost = (inputTokens / 1_000_000) * PRICING.input;
    const outputCost = (outputTokens / 1_000_000) * PRICING.output;
    const cacheWriteCost = (cacheWrite / 1_000_000) * PRICING.cache_write;
    const cacheReadCost = (cacheRead / 1_000_000) * PRICING.cache_read;

    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    const log: RequestLog = {
      timestamp: new Date(),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: totalCost,
      operation,
    };

    this.history.push(log);

    return log;
  }

  /**
   * Retourne les statistiques de la session
   */
  getStats(): TokenStats {
    const totalInputTokens = this.history.reduce((sum, r) => sum + r.input_tokens, 0);
    const totalOutputTokens = this.history.reduce((sum, r) => sum + r.output_tokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const estimatedCostUSD = this.history.reduce((sum, r) => sum + r.estimated_cost_usd, 0);

    const now = new Date();
    const durationMs = now.getTime() - this.sessionStart.getTime();
    const durationMinutes = durationMs / (1000 * 60);

    return {
      totalRequests: this.history.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      estimatedCostUSD,
      averageTokensPerRequest: this.history.length > 0 ? totalTokens / this.history.length : 0,
      sessionStartTime: this.sessionStart,
      sessionDurationMinutes: Math.round(durationMinutes * 10) / 10,
      history: [...this.history],
    };
  }

  /**
   * Affiche un résumé formaté
   */
  printSummary(): void {
    const stats = this.getStats();

    // Summary is available via getStats() — no console output
  }

  /**
   * Réinitialise les statistiques
   */
  reset(): void {
    this.history = [];
    this.sessionStart = new Date();
  }

  /**
   * Retourne l'historique complet
   */
  getHistory(): RequestLog[] {
    return [...this.history];
  }

  /**
   * Retourne le dernier log
   */
  getLastRequest(): RequestLog | undefined {
    return this.history[this.history.length - 1];
  }
}

// Singleton pour utilisation globale
export const tokenTracker = new TokenTracker();

/**
 * Wrapper pour appeler l'API Claude avec tracking automatique
 * @example
 * const response = await trackApiCall(
 *   () => anthropic.messages.create({ ... }),
 *   'generateTrip'
 * );
 */
export async function trackApiCall<T extends { usage?: TokenUsage }>(
  apiCall: () => Promise<T>,
  operation?: string
): Promise<T> {
  const response = await apiCall();

  if (response.usage) {
    tokenTracker.track(response.usage, operation);
  }

  return response;
}

/**
 * Estime le nombre de tokens pour un texte
 * (approximation: 1 token ≈ 4 caractères en anglais, 3 en français)
 */
export function estimateTokens(text: string): number {
  // Moyenne conservatrice: 1 token ≈ 3.5 caractères
  return Math.ceil(text.length / 3.5);
}

/**
 * Estime le coût d'une requête avant de l'envoyer
 */
export function estimateCost(inputText: string, expectedOutputTokens: number = 1000): {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUSD: number;
} {
  const inputTokens = estimateTokens(inputText);
  const inputCost = (inputTokens / 1_000_000) * PRICING.input;
  const outputCost = (expectedOutputTokens / 1_000_000) * PRICING.output;

  return {
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: expectedOutputTokens,
    estimatedCostUSD: inputCost + outputCost,
  };
}
