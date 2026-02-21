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
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  hamlet?: string;
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
  subtitle?: string;
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

function splitDisplayName(displayName: string): string[] {
  return displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const normalized = (part || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function buildSubtitle(label: string, parts: Array<string | undefined>): string | undefined {
  const labelKey = label.trim().toLowerCase();
  const filtered = uniqParts(parts).filter((part) => part.toLowerCase() !== labelKey);
  return filtered.length > 0 ? filtered.join(', ') : undefined;
}

function buildCityPresentation(item: NominatimSearchResult): { label: string; subtitle?: string } {
  const city = getCityName(item.address);
  const country = item.address?.country;
  if (city) {
    return { label: uniqParts([city, country]).join(', ') || city };
  }

  const parts = splitDisplayName(item.display_name);
  const label = parts[0] || item.display_name;
  const subtitle = buildSubtitle(label, [parts[1], country]);
  return { label, subtitle };
}

function buildAddressPresentation(item: NominatimSearchResult): { label: string; subtitle?: string } {
  const address = item.address;
  const street = uniqParts([address?.house_number, address?.road]).join(' ').trim();
  const parts = splitDisplayName(item.display_name);
  const label = street || parts[0] || item.display_name;
  const subtitle = buildSubtitle(label, [
    address?.suburb || address?.neighbourhood || address?.hamlet,
    getCityName(address),
    address?.country,
    ...parts.slice(1, 4),
  ]);
  return { label, subtitle };
}

export async function GET(request: NextRequest) {
  // Rate limiting: 30 req/min
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

  const rateLimit = checkRateLimit(ip, { windowMs: 60_000, maxRequests: 30 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) }
      }
    );
  }

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
        const presentation = mode === 'city' ? buildCityPresentation(item) : buildAddressPresentation(item);
        return {
          displayName: item.display_name,
          label: presentation.label,
          subtitle: presentation.subtitle,
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
