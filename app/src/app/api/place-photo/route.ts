import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_PLACE_PHOTO_URL = 'https://maps.googleapis.com/maps/api/place/photo';

function getGoogleApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

export async function GET(request: NextRequest) {
  const photoReference =
    request.nextUrl.searchParams.get('photo_reference')
    || request.nextUrl.searchParams.get('photoreference');

  if (!photoReference) {
    return NextResponse.json({ error: 'photo_reference requis' }, { status: 400 });
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
  upstream.searchParams.set('photoreference', photoReference);
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
