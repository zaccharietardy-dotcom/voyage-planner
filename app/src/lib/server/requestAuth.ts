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

async function createBearerClient(accessToken: string): Promise<SupabaseClient<Database>> {
  const publicEnv = getPublicEnv();

  const client = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  // Inject the access token into the client's internal session state.
  // This is necessary because getUser() reads from internal state, NOT from global.headers.
  await client.auth.setSession({
    access_token: accessToken,
    refresh_token: '',
  });

  return client;
}

export async function resolveRequestAuth(request: Request | NextRequest): Promise<RequestAuthResult> {
  const bearerToken = extractBearerToken(request);

  if (bearerToken) {
    const supabase = await createBearerClient(bearerToken);
    const { data, error } = await supabase.auth.getUser();

    if (!error && data.user) {
      return {
        authMethod: 'bearer',
        supabase,
        user: data.user,
      };
    }

    if (error) {
      console.error('[requestAuth] Bearer auth failed:', error.message);
    }

    // Bearer failed — try cookie fallback
    const cookieSupabase = await createRouteHandlerClient();
    const { data: cookieData } = await cookieSupabase.auth.getUser();
    if (cookieData.user) {
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
