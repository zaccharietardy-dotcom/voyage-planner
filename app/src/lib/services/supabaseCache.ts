/**
 * Cache L2 persistant Supabase pour les appels Google API
 *
 * Architecture: L1 (in-memory) -> L2 (Supabase search_cache) -> Google API
 * Si Supabase est down/lent -> timeout 5s, fallback transparent sur Google API
 */

import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_TIMEOUT_MS = 5000;

// Singleton Supabase admin client
let _supabaseAdmin: SupabaseClient | null | undefined;
let _warmupDone = false;

function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin !== undefined) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    _supabaseAdmin = null;
    return null;
  }
  _supabaseAdmin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabaseAdmin;
}

/**
 * Warmup: establish TCP+TLS connection with a lightweight query.
 * Called once on first cache access — avoids cold-start timeout on real queries.
 */
async function ensureWarm(supabase: SupabaseClient): Promise<void> {
  if (_warmupDone) return;
  _warmupDone = true;
  try {
    await withTimeout(
      supabase.from('search_cache').select('query_hash').limit(1),
      SUPABASE_TIMEOUT_MS
    );
  } catch {
    // Warmup failure is non-fatal
  }
}

export function toCacheHash(cacheKey: string): string {
  return crypto.createHash('sha256').update(cacheKey).digest('hex');
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number = SUPABASE_TIMEOUT_MS): Promise<T | null> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function getCachedResponse<T>(queryType: string, cacheKey: string): Promise<T | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    await ensureWarm(supabase);

    const queryHash = toCacheHash(cacheKey);
    const t0 = Date.now();

    const result = await withTimeout(
      supabase
        .from('search_cache')
        .select('results, expires_at')
        .eq('query_hash', queryHash)
        .single()
    );

    const elapsed = Date.now() - t0;

    if (!result) {
      console.log(`[Cache L2] TIMEOUT ${queryType} (${elapsed}ms)`);
      return null;
    }

    const { data, error } = result;

    if (error || !data) {
      return null;
    }

    // Check expiration
    if (new Date() > new Date(data.expires_at)) {
      console.log(`[Cache L2] EXPIRED ${queryType}`);
      return null;
    }

    console.log(`[Cache L2] HIT ${queryType} (${elapsed}ms)`);
    return data.results as T;
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  queryType: string,
  cacheKey: string,
  data: unknown,
  ttlDays: number,
  city?: string,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;

    const queryHash = toCacheHash(cacheKey);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const resultCount = Array.isArray(data) ? data.length : 1;

    await withTimeout(
      supabase.from('search_cache').upsert(
        {
          query_hash: queryHash,
          query_type: queryType,
          city: city || '',
          parameters: {},
          result_count: resultCount,
          results: data,
          source: 'google-api',
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'query_hash' }
      )
    );
  } catch {
    // Fire-and-forget — never block the pipeline
  }
}
