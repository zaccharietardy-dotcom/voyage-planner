import * as fs from 'fs';
import * as path from 'path';

function getGeminiApiKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY;
}

const USD_TO_EUR = 0.92;

interface ModelPricing {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
}

const PRICING: Record<string, ModelPricing> = {
  'gemini-3-flash-preview': { inputUsdPerMtok: 0.30, outputUsdPerMtok: 2.50 },
  'gemini-2.5-flash': { inputUsdPerMtok: 0.075, outputUsdPerMtok: 0.30 },
  'gemini-2.5-flash-lite': { inputUsdPerMtok: 0.05, outputUsdPerMtok: 0.20 },
  'gemini-2.5-pro': { inputUsdPerMtok: 1.25, outputUsdPerMtok: 10.0 },
  'gemini-2.5-flash-native-audio-latest': { inputUsdPerMtok: 3.0, outputUsdPerMtok: 12.0 },
};

const DEFAULT_MODEL = 'gemini-3-flash-preview';

function normalizeModel(model: string): string {
  return model.replace(/^models\//, '');
}

function lookupPricing(model: string): ModelPricing {
  const clean = normalizeModel(model);
  return PRICING[clean] ?? PRICING[DEFAULT_MODEL];
}

export function estimateCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const p = lookupPricing(model);
  const usd =
    (inputTokens / 1_000_000) * p.inputUsdPerMtok +
    (outputTokens / 1_000_000) * p.outputUsdPerMtok;
  return usd * USD_TO_EUR;
}

// ---------------------------------------------------------------------------
// Usage logging
// ---------------------------------------------------------------------------

const LOG_BASE = process.env.VERCEL ? '/tmp' : process.cwd();
const LOG_DIR = path.join(LOG_BASE, '.logs');
const LOG_FILE = path.join(LOG_DIR, 'gemini-usage.jsonl');

export interface GeminiUsage {
  ts: string;
  caller: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostEur: number;
  tripId?: string;
  status: number;
  retryAttempt?: number;
}

export function logGeminiUsage(usage: GeminiUsage): void {
  if (process.env.VERCEL) {
    console.log('[GeminiUsage]', JSON.stringify(usage));
    return;
  }

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(usage) + '\n');
  } catch (err) {
    console.warn('[GeminiUsage] Failed to write log file:', err);
  }
}

// ---------------------------------------------------------------------------
// Low-level Gemini call — single point of egress for generativelanguage API.
// Any other caller must go through this.
// ---------------------------------------------------------------------------

export interface CallGeminiParams {
  body: Record<string, unknown>;
  caller?: string;
  model?: string;
  tripId?: string;
  signal?: AbortSignal;
  retryAttempt?: number;
}

export async function callGemini(params: CallGeminiParams): Promise<Response> {
  const {
    body,
    caller = 'unknown',
    tripId,
    signal,
    retryAttempt,
  } = params;

  const model = normalizeModel(
    params.model || (typeof body.model === 'string' ? body.model : undefined) || DEFAULT_MODEL,
  );

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: { message: 'GOOGLE_AI_API_KEY not set', status: 'UNAUTHENTICATED' },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 200) {
    try {
      const cloned = response.clone();
      const data = (await cloned.json()) as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const usage = data?.usageMetadata;
      if (usage && typeof usage.promptTokenCount === 'number') {
        const inputTokens = usage.promptTokenCount ?? 0;
        const outputTokens = usage.candidatesTokenCount ?? 0;
        const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens;
        logGeminiUsage({
          ts: new Date().toISOString(),
          caller,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCostEur: estimateCostEur(model, inputTokens, outputTokens),
          tripId,
          status: response.status,
          retryAttempt,
        });
      }
    } catch {
      // Logging is best-effort; never break the hot path.
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Health probe — hits the ListModels endpoint. No tokens consumed.
// Shared by /api/health and integrations/providerProbes.
// ---------------------------------------------------------------------------

export interface ProbeResult {
  status: 'ok' | 'not_configured' | 'error' | 'quota_exceeded';
  latencyMs?: number;
  error?: string;
  details?: string;
}

export async function probeGeminiModels(timeoutMs: number = 5000): Promise<ProbeResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const latencyMs = Date.now() - start;

    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (response.status === 403) {
      return { status: 'error', latencyMs, error: 'API key invalid or disabled (403)' };
    }
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as { models?: unknown[] };
    const modelCount = data.models?.length ?? 0;
    return { status: 'ok', latencyMs, details: `${modelCount} models available` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', latencyMs: Date.now() - start, error: message };
  }
}
