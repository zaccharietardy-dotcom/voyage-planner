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
    // Pass token explicitly — getUser() without args may not use the global header
    const { data, error } = await supabase.auth.getUser(bearerToken);

    if (!error && data.user) {
      return {
        authMethod: 'bearer',
        supabase,
        user: data.user,
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
