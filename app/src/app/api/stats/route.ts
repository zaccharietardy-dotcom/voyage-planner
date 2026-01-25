/**
 * API Route pour voir la consommation de tokens en temps réel
 * GET /api/stats - Retourne les statistiques de consommation
 * DELETE /api/stats - Réinitialise les statistiques
 */

import { NextRequest, NextResponse } from 'next/server';
import { tokenTracker } from '@/lib/services/tokenTracker';

export async function GET() {
  const stats = tokenTracker.getStats();

  // Formater pour l'affichage
  const response = {
    session: {
      startTime: stats.sessionStartTime.toISOString(),
      durationMinutes: stats.sessionDurationMinutes,
    },
    usage: {
      totalRequests: stats.totalRequests,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      totalTokens: stats.totalTokens,
      averageTokensPerRequest: Math.round(stats.averageTokensPerRequest),
    },
    cost: {
      estimatedUSD: stats.estimatedCostUSD,
      formatted: `$${stats.estimatedCostUSD.toFixed(4)}`,
    },
    // Limites Claude API (tier 1)
    limits: {
      tier: 'Tier 1 (défaut)',
      maxTokensPerMinute: 40000,
      maxRequestsPerMinute: 50,
      maxTokensPerDay: 1000000,
      remainingEstimate: {
        tokensPerMinute: Math.max(0, 40000 - stats.totalTokens),
        note: 'Estimation basée sur la session courante',
      },
    },
    // Historique des 10 dernières requêtes
    recentRequests: stats.history.slice(-10).map(r => ({
      timestamp: r.timestamp.toISOString(),
      operation: r.operation || 'Unknown',
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      totalTokens: r.total_tokens,
      cost: `$${r.estimated_cost_usd.toFixed(4)}`,
    })),
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function DELETE() {
  tokenTracker.reset();

  return NextResponse.json({
    message: 'Statistiques réinitialisées',
    timestamp: new Date().toISOString(),
  });
}
