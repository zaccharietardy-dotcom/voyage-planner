import type { ExternalProbeResult } from '@/lib/integrations/types';
import { probeGeminiModels } from '@/lib/services/geminiClient';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeGemini(): Promise<ExternalProbeResult> {
  return probeGeminiModels();
}

export async function probeRapidApiTripadvisor(): Promise<ExternalProbeResult> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch(
      'https://tripadvisor16.p.rapidapi.com/api/v1/restaurant/searchLocation?query=Paris',
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'tripadvisor16.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    const latencyMs = Date.now() - start;

    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (response.status === 403) {
      return { status: 'error', latencyMs, error: 'API key invalid or quota exceeded (403)' };
    }
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    if (data.error) {
      return { status: 'error', latencyMs, error: data.error.message || 'Unknown error' };
    }
    return { status: 'ok', latencyMs, details: `${data.data?.length || 0} results` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

export async function probeSerpApi(): Promise<ExternalProbeResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch(
      `https://serpapi.com/account.json?api_key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );

    const latencyMs = Date.now() - start;
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const remaining = data.total_searches_left;
    const plan = data.plan_name || 'unknown';

    if (remaining !== undefined && remaining <= 0) {
      return { status: 'quota_exceeded', latencyMs, error: `0 searches left (plan: ${plan})` };
    }

    return {
      status: 'ok',
      latencyMs,
      details: remaining !== undefined
        ? `${remaining} searches left (plan: ${plan})`
        : `plan: ${plan}`,
    };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

export async function probeGooglePlaces(): Promise<ExternalProbeResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=Eiffel+Tower&inputtype=textquery&fields=name&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );

    const latencyMs = Date.now() - start;
    const data = await response.json();

    if (data.status === 'REQUEST_DENIED') {
      return { status: 'error', latencyMs, error: 'API key denied - verify restrictions' };
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      return { status: 'quota_exceeded', latencyMs, error: 'Quota exceeded' };
    }
    if (data.status === 'OK') {
      return { status: 'ok', latencyMs };
    }
    return { status: 'error', latencyMs, error: `Status: ${data.status}` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

export async function probeOverpass(): Promise<ExternalProbeResult> {
  const start = Date.now();
  try {
    const query = '[out:json][timeout:5];node["amenity"="restaurant"](around:100,48.8584,2.2945);out count;';
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;

    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const count = data.elements?.[0]?.tags?.total || data.elements?.length || 0;
    return { status: 'ok', latencyMs, details: `${count} restaurants found (test)` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

export async function probeViator(): Promise<ExternalProbeResult> {
  const apiKey = process.env.VIATOR_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch('https://api.viator.com/partner/search/freetext', {
      method: 'POST',
      headers: {
        'exp-api-key': apiKey,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchTerm: 'Paris',
        searchTypes: [{ searchType: 'DESTINATIONS', pagination: { start: 1, count: 1 } }],
        currency: 'EUR',
      }),
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Date.now() - start;

    if (response.status === 401 || response.status === 403) {
      return { status: 'error', latencyMs, error: 'API key invalid (401/403)' };
    }
    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const count = data?.destinations?.results?.length || 0;
    return { status: 'ok', latencyMs, details: `${count} destinations found (test)` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

export async function probeAnthropic(): Promise<ExternalProbeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'test' }],
      }),
      signal: AbortSignal.timeout(5000),
    });

    const latencyMs = Date.now() - start;

    if (response.status === 401) {
      return { status: 'error', latencyMs, error: 'API key invalid (401)' };
    }
    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (!response.ok && response.status !== 200) {
      const text = await response.text().catch(() => '');
      if (text.includes('not_found')) {
        return { status: 'ok', latencyMs, details: 'Auth OK' };
      }
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    return { status: 'ok', latencyMs };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}
