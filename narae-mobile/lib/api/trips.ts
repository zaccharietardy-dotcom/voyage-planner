import { supabase } from '@/lib/supabase/client';
import { api } from './client';
import type { Trip, TripPreferences } from '@/lib/types/trip';

// ---------- Types for list items (DB row shape) ----------

export interface TripListItem {
  id: string;
  name: string | null;
  title: string | null;
  destination: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  preferences: TripPreferences | null;
  visibility: 'public' | 'friends' | 'private';
  created_at: string;
  updated_at: string;
  owner_id: string;
  // Derived on the client
  userRole?: 'owner' | 'editor' | 'viewer';
}

export interface TripRow extends TripListItem {
  data: Trip | null;
  share_code: string | null;
}

// ---------- Queries ----------

export async function fetchMyTrips(): Promise<TripListItem[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('trips')
    .select('id, name, title, destination, start_date, end_date, duration_days, preferences, visibility, created_at, updated_at, owner_id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ ...t, userRole: 'owner' as const }));
}

export async function fetchTrip(id: string): Promise<TripRow> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(error.message);
  return data as TripRow;
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- Generation (API route — needs server-side pipeline) ----------

export interface GenerateProgress {
  step: number;
  label: string;
  total: number;
}

export async function generateTrip(
  preferences: TripPreferences,
  onProgress?: (p: GenerateProgress) => void,
): Promise<Trip> {
  // Serialize dates for JSON transport
  const payload = {
    ...preferences,
    startDate: preferences.startDate instanceof Date
      ? preferences.startDate.toISOString()
      : preferences.startDate,
  };

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`https://naraevoyage.com/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Generation failed (${res.status})`);
  }

  // The generate endpoint may stream SSE or return JSON directly.
  // Handle both cases.
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    return parseSSEStream(res, onProgress);
  }

  // Plain JSON response
  return res.json() as Promise<Trip>;
}

async function parseSSEStream(
  res: Response,
  onProgress?: (p: GenerateProgress) => void,
): Promise<Trip> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: Trip | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;

      try {
        const event = JSON.parse(raw);
        if (event.type === 'progress' && onProgress) {
          onProgress({ step: event.step, label: event.label, total: event.total });
        }
        if (event.type === 'complete' && event.trip) {
          result = event.trip as Trip;
        }
        if (event.type === 'result' && event.data) {
          result = event.data as Trip;
        }
      } catch {
        // skip malformed events
      }
    }
  }

  if (!result) throw new Error('Generation produced no result');
  return result;
}
