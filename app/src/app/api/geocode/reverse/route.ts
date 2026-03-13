import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
};

type NominatimReverseResult = {
  display_name?: string;
  address?: NominatimAddress;
};

function parseCoordinate(input: string | null, kind: 'lat' | 'lng'): number | null {
  if (!input) return null;
  const value = Number.parseFloat(input);
  if (!Number.isFinite(value)) return null;
  if (kind === 'lat' && (value < -90 || value > 90)) return null;
  if (kind === 'lng' && (value < -180 || value > 180)) return null;
  return value;
}

function getCityName(address?: NominatimAddress): string | undefined {
  if (!address) return undefined;
  return address.city || address.town || address.village || address.municipality || address.county || address.state;
}

export async function GET(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  const rateLimit = checkRateLimit(ip, { windowMs: 60_000, maxRequests: 30 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const lat = parseCoordinate(searchParams.get('lat'), 'lat');
    const lng = parseCoordinate(searchParams.get('lng'), 'lng');

    if (lat === null || lng === null) {
      return NextResponse.json({ displayName: null, city: null, country: null }, { status: 400 });
    }

    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'fr,en',
      lat: String(lat),
      lon: String(lng),
    });
    if (process.env.NOMINATIM_EMAIL) {
      params.set('email', process.env.NOMINATIM_EMAIL);
    }

    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        'User-Agent': 'voyage-planner/1.0',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json({ displayName: null, city: null, country: null });
    }

    const payload = (await response.json()) as NominatimReverseResult;
    const displayName = typeof payload.display_name === 'string' ? payload.display_name : null;
    const city = getCityName(payload.address) || null;
    const country = payload.address?.country || null;

    return NextResponse.json({
      displayName,
      city,
      country,
      lat,
      lng,
    });
  } catch (error) {
    console.error('[Geocode reverse] error:', error);
    return NextResponse.json({ displayName: null, city: null, country: null });
  }
}
