interface RateLimitRpcRow {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  reset_at: string;
}

export interface DbRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
}

export async function checkAndIncrementRateLimit(
  supabase: {
    rpc: (
      fn: string,
      params: Record<string, unknown>
    ) => Promise<{ data: RateLimitRpcRow[] | null; error: { message?: string } | null }>;
  },
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<DbRateLimitResult> {
  const { data, error } = await supabase.rpc('check_and_increment_rate_limit', {
    p_key: key,
    p_limit: maxRequests,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error(error.message || 'Rate limit RPC failed');
  }

  const row = data?.[0];
  if (!row) {
    throw new Error('Rate limit RPC returned no data');
  }

  return {
    allowed: row.allowed,
    remaining: Number(row.remaining) || 0,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
    resetAt: row.reset_at,
  };
}
