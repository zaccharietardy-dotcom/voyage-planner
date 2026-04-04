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

function createBearerClient(accessToken: string): SupabaseClient<Database> {
  const publicEnv = getPublicEnv();

  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );
}

export async function resolveRequestAuth(request: Request | NextRequest): Promise<RequestAuthResult> {
  const bearerToken = extractBearerToken(request);

  if (bearerToken) {
    const supabase = createBearerClient(bearerToken);
    const { data, error } = await supabase.auth.getUser(bearerToken);

    if (error) {
      console.error('[requestAuth] Bearer getUser failed:', error.message, '| token prefix:', bearerToken.substring(0, 20));
    }

    if (!error && data.user) {
      return {
        authMethod: 'bearer',
        supabase,
        user: data.user,
      };
    }

    // Bearer failed — try cookie as fallback (mobile might have stale token but valid cookie)
    const cookieSupabase = await createRouteHandlerClient();
    const { data: cookieData } = await cookieSupabase.auth.getUser();
    if (cookieData.user) {
      console.log('[requestAuth] Bearer failed but cookie auth succeeded for user:', cookieData.user.id);
      return {
        authMethod: 'cookie',
        supabase: cookieSupabase,
        user: cookieData.user,
      };
    }

    return {
      authMethod: 'none',
      supabase,
      user: null,
    };
  }

  const supabase = await createRouteHandlerClient();
  const { data } = await supabase.auth.getUser();

  return {
    authMethod: data.user ? 'cookie' : 'none',
    supabase,
    user: data.user ?? null,
  };
}
