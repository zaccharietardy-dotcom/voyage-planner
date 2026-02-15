import { NextRequest, NextResponse } from 'next/server';

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
};

type NominatimSearchResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
};

type AutocompleteResult = {
  displayName: string;
  label: string;
  city?: string;
  country?: string;
  lat: number;
  lng: number;
};

function normalizeLimit(input: string | null): number {
  const parsed = Number.parseInt(input || '', 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(parsed, 10));
}

function getCityName(address?: NominatimAddress): string | undefined {
  if (!address) return undefined;
  return address.city || address.town || address.village || address.municipality || address.county || address.state;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').trim();
    const mode = searchParams.get('mode') === 'address' ? 'address' : 'city';
    const limit = normalizeLimit(searchParams.get('limit'));

    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(limit),
      'accept-language': 'fr,en',
    });
    if (mode === 'city') {
      params.set('featuretype', 'city');
    }
    if (process.env.NOMINATIM_EMAIL) {
      params.set('email', process.env.NOMINATIM_EMAIL);
    }

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'voyage-planner/1.0',
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return NextResponse.json({ results: [] });
    }

    const rawResults = (await response.json()) as NominatimSearchResult[];
    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const mapped = rawResults
      .map((item): AutocompleteResult | null => {
        const lat = Number.parseFloat(item.lat);
        const lng = Number.parseFloat(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const city = getCityName(item.address);
        const country = item.address?.country;
        const cityLabel = [city, country].filter(Boolean).join(', ');
        const label = mode === 'city' ? (cityLabel || item.display_name) : item.display_name;
        return {
          displayName: item.display_name,
          label,
          city,
          country,
          lat,
          lng,
        };
      })
      .filter((value): value is AutocompleteResult => Boolean(value));

    const dedup = new Map<string, AutocompleteResult>();
    for (const item of mapped) {
      const key = `${item.label.toLowerCase()}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
      if (!dedup.has(key)) {
        dedup.set(key, item);
      }
    }

    return NextResponse.json({ results: [...dedup.values()].slice(0, limit) });
  } catch (error) {
    console.error('[Geocode autocomplete] error:', error);
    return NextResponse.json({ results: [] });
  }
}

