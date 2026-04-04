import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { SITE_URL } from '@/lib/constants';

function isSessionStale(session: Session, minTtlSeconds = 60): boolean {
  if (!session.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return session.expires_at - now <= minTtlSeconds;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...headers };
}

export async function getValidSession(options?: {
  forceRefresh?: boolean;
  minTtlSeconds?: number;
}): Promise<Session | null> {
  const { forceRefresh = false, minTtlSeconds = 60 } = options ?? {};
  const { data: { session } } = await supabase.auth.getSession();

  if (!forceRefresh && session?.access_token && !isSessionStale(session, minTtlSeconds)) {
    return session;
  }

  const { data, error } = await supabase.auth.refreshSession();

  if (!error && data.session?.access_token) {
    return data.session;
  }

  if (session?.access_token && !isSessionStale(session, 0)) {
    return session;
  }

  return null;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await getValidSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function fetchWithAuth(
  input: string,
  init: RequestInit = {},
  retried = false,
  accessToken?: string,
): Promise<Response> {
  // On first call, always try to get a fresh token
  if (!accessToken && !retried) {
    const fresh = await getValidSession({ forceRefresh: true, minTtlSeconds: 30 });
    accessToken = fresh?.access_token ?? undefined;
  }

  const response = await fetch(input, {
    ...init,
    headers: {
      ...normalizeHeaders(init.headers),
      ...(accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : await getAuthHeaders()),
    },
  });

  if (response.status === 401 && !retried) {
    // Force full refresh
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
      return fetchWithAuth(input, init, true, data.session.access_token);
    }
    // If refresh fails, sign out to clear corrupted session
    await supabase.auth.signOut();
  }

  return response;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${SITE_URL}${path}`;
  const res = await fetchWithAuth(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: (path: string) => request<void>('DELETE', path),
};
