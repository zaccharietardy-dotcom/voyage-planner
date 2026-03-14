import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/server/rateLimit';

const GOOGLE_PLACE_PHOTO_URL = 'https://maps.googleapis.com/maps/api/place/photo';
const PHOTO_REFERENCE_MAX_LENGTH = 2000;

function getGoogleApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip, { windowMs: 60_000, maxRequests: 60 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const photoReference =
    request.nextUrl.searchParams.get('photo_reference')
    || request.nextUrl.searchParams.get('photoreference');

  const normalizedPhotoReference = photoReference?.trim() || '';
  if (!normalizedPhotoReference) {
    return NextResponse.json({ error: 'photo_reference requis' }, { status: 400 });
  }
  if (normalizedPhotoReference.length > PHOTO_REFERENCE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `photo_reference trop long (max ${PHOTO_REFERENCE_MAX_LENGTH})` },
      { status: 400 }
    );
  }

  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY manquant' }, { status: 500 });
  }

  const parsedMaxWidth = Number(request.nextUrl.searchParams.get('maxwidth') || '800');
  const maxwidth = Number.isFinite(parsedMaxWidth)
    ? Math.max(100, Math.min(1600, Math.round(parsedMaxWidth)))
    : 800;

  const upstream = new URL(GOOGLE_PLACE_PHOTO_URL);
  upstream.searchParams.set('photoreference', normalizedPhotoReference);
  upstream.searchParams.set('maxwidth', String(maxwidth));
  upstream.searchParams.set('key', apiKey);

  const upstreamResponse = await fetch(upstream.toString(), {
    // Let the platform cache the binary response for hot routes.
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      { error: `Google Places photo error (${upstreamResponse.status})` },
      { status: upstreamResponse.status }
    );
  }

  const contentType = upstreamResponse.headers.get('content-type') || 'image/jpeg';
  const body = await upstreamResponse.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
