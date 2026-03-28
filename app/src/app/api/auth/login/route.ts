import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { checkAndIncrementRateLimit } from '@/lib/server/dbRateLimit';

// 5 login attempts per 15 minutes per IP
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900; // 15 minutes

export async function POST(request: NextRequest) {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    const rateLimitKey = `login:${ip}`;

    const supabase = await createRouteHandlerClient();

    const rateLimit = await checkAndIncrementRateLimit(
      supabase as any,
      rateLimitKey,
      MAX_ATTEMPTS,
      WINDOW_SECONDS,
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.', code: 'RATE_LIMIT_EXCEEDED' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    return NextResponse.json({ allowed: true, remaining: rateLimit.remaining });
  } catch (error) {
    console.error('[auth/login] Rate limit check failed:', error);
    // Fail open — don't block login if rate limit check fails
    return NextResponse.json({ allowed: true, remaining: -1 });
  }
}
