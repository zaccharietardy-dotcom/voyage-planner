import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';
import { getPublicEnv } from '@/lib/runtime-config';

export type RequestAuthMethod = 'bearer' | 'cookie' | 'none';

export interface RequestAuthResult {
  authMethod: RequestAuthMethod;
  supabase: SupabaseClient<Database>;
  user: User | null;
}

function extractBearerToken(request: Request | NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Validate a bearer token by calling the Supabase auth API directly.
 * This bypasses all SDK client state management issues.
 */
async function validateBearerToken(accessToken: string): Promise<User | null> {
  const publicEnv = getPublicEnv();

  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[requestAuth] Bearer validation failed:', response.status, body.substring(0, 100));
      return null;
    }

    const user = await response.json();
    return user as User;
  } catch (error) {
    console.error('[requestAuth] Bearer validation network error:', error);
    return null;
  }
}

function createAuthedClient(accessToken: string): SupabaseClient<Database> {
  const publicEnv = getPublicEnv();
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

export async function resolveRequestAuth(request: Request | NextRequest): Promise<RequestAuthResult> {
  const bearerToken = extractBearerToken(request);

  if (bearerToken) {
    // Validate token directly against Supabase auth API — no SDK quirks
    const user = await validateBearerToken(bearerToken);

    if (user) {
      // Create a client with the token for subsequent DB queries
      const supabase = createAuthedClient(bearerToken);
      return { authMethod: 'bearer', supabase, user };
    }

    // Bearer failed — try cookie fallback
    const cookieSupabase = await createRouteHandlerClient();
    const { data: cookieData } = await cookieSupabase.auth.getUser();
    if (cookieData.user) {
      return { authMethod: 'cookie', supabase: cookieSupabase, user: cookieData.user };
    }

    return { authMethod: 'none', supabase: createAuthedClient(bearerToken), user: null };
  }

  // No bearer token — cookie auth
  const supabase = await createRouteHandlerClient();
  const { data } = await supabase.auth.getUser();

  return {
    authMethod: data.user ? 'cookie' : 'none',
    supabase,
    user: data.user ?? null,
  };
}
