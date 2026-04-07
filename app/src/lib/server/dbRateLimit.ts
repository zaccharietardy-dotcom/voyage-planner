interface RateLimitRpcRow {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  reset_at: string;
}

type Awaitable<T> = PromiseLike<T> | Promise<T>;

export interface RateLimitSupabaseLike {
  rpc: (
    fn: string,
    params: Record<string, unknown>
  ) => Awaitable<{ data: unknown; error: { message?: string } | null }>;
}

export interface DbRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: string;
}

export async function checkAndIncrementRateLimit(
  supabase: RateLimitSupabaseLike,
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

  const row = Array.isArray(data) ? (data[0] as RateLimitRpcRow | undefined) : undefined;
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
