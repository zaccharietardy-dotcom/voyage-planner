import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

let cached: { data: Record<string, number>; at: number } | null = null;
const CACHE_TTL = 3600_000; // 1 hour

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  }

  try {
    const [tripsRes, usersRes, countriesRes] = await Promise.all([
      getSupabase().from('trips').select('*', { count: 'exact', head: true }),
      getSupabase().from('profiles').select('*', { count: 'exact', head: true }),
      getSupabase().from('trips').select('destination'),
    ]);

    const uniqueDestinations = new Set(
      (countriesRes.data || []).map((t: { destination: string }) =>
        t.destination?.split(',')[0]?.trim().toLowerCase()
      ).filter(Boolean)
    );

    const data = {
      trips: tripsRes.count || 0,
      users: usersRes.count || 0,
      destinations: uniqueDestinations.size || 0,
    };

    cached = { data, at: Date.now() };

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('[stats/public] Error:', error);
    return NextResponse.json({ trips: 0, users: 0, destinations: 0 });
  }
}
