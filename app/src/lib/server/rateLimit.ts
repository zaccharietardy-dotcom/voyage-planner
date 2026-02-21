// Simple in-memory rate limiter per IP
// Resets every window period, uses a sliding window approach

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000); // cleanup every 60s

interface RateLimitOptions {
  windowMs?: number;    // Time window in ms (default: 60s)
  maxRequests?: number; // Max requests per window (default: 5)
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  ip: string,
  options: RateLimitOptions = {}
): RateLimitResult {
  const { windowMs = 60_000, maxRequests = 5 } = options;
  const now = Date.now();

  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}
