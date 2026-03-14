import { NextRequest, NextResponse } from 'next/server';
import { getDirections } from '@/lib/services/directions';
import { checkRateLimit } from '@/lib/server/rateLimit';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = checkRateLimit(ip, { windowMs: 60_000, maxRequests: 30 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const fromLat = parseFloat(searchParams.get('fromLat') || '');
  const fromLng = parseFloat(searchParams.get('fromLng') || '');
  const toLat = parseFloat(searchParams.get('toLat') || '');
  const toLng = parseFloat(searchParams.get('toLng') || '');
  const mode = (searchParams.get('mode') || 'transit') as 'transit' | 'walking' | 'driving';

  if (isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
    return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
  }

  try {
    const result = await getDirections({
      from: { lat: fromLat, lng: fromLng },
      to: { lat: toLat, lng: toLng },
      mode,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=3600' }, // Cache 1h
    });
  } catch (error) {
    console.error('[Directions API]', error);
    return NextResponse.json(
      { error: 'Failed to fetch directions' },
      { status: 500 }
    );
  }
}
