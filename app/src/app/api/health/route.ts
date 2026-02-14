/**
 * API Health Check — /api/health
 *
 * Teste chaque source de données (restaurants, attractions, transport)
 * et reporte le statut, la configuration, et les erreurs éventuelles.
 *
 * GET /api/health → statut de toutes les APIs
 * GET /api/health?test=true → test réel avec appels API (plus lent, ~10s)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isGeminiConfigured } from '@/lib/services/geminiSearch';
import { isTripAdvisorConfigured } from '@/lib/services/tripadvisor';
import { isSerpApiPlacesConfigured } from '@/lib/services/serpApiPlaces';
import { isFoursquareConfigured } from '@/lib/services/foursquare';
import { isViatorConfigured } from '@/lib/services/viator';
import { isOverpassConfigured } from '@/lib/services/overpassAttractions';
import { requireAdmin } from '@/lib/server/adminAuth';

// ============================================
// Types
// ============================================

interface ApiStatus {
  name: string;
  configured: boolean;
  envVar: string;
  usage: string;
  status: 'ok' | 'not_configured' | 'error' | 'quota_exceeded' | 'untested';
  error?: string;
  latencyMs?: number;
  details?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type TestProbeResult = Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>;

// ============================================
// Lightweight API tests (minimal calls)
// ============================================

async function testGemini(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Minimal test: list models endpoint (no tokens consumed)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    const latencyMs = Date.now() - start;

    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429)' };
    }
    if (response.status === 403) {
      return { status: 'error', latencyMs, error: 'API key invalid or disabled (403)' };
    }
    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const modelCount = data.models?.length || 0;
    return { status: 'ok', latencyMs, details: `${modelCount} models available` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

async function testRapidApi(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Minimal test: TripAdvisor search with tiny limit
    const response = await fetch(
      'https://tripadvisor16.p.rapidapi.com/api/v1/restaurant/searchLocation?query=Paris',
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'tripadvisor16.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(8000),
      }
    );

    const latencyMs = Date.now() - start;

    if (response.status === 429) {
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429) — vérifier quota RapidAPI' };
    }
    if (response.status === 403) {
      return { status: 'error', latencyMs, error: 'API key invalid ou quota dépassé (403)' };
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

async function testSerpApi(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Check account info (doesn't count toward search quota)
    const response = await fetch(
      `https://serpapi.com/account.json?api_key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const remaining = data.total_searches_left;
    const plan = data.plan_name || 'unknown';

    if (remaining !== undefined && remaining <= 0) {
      return { status: 'quota_exceeded', latencyMs, error: `0 recherches restantes (plan: ${plan})` };
    }

    return {
      status: remaining !== undefined && remaining < 10 ? 'ok' : 'ok',
      latencyMs,
      details: remaining !== undefined
        ? `${remaining} recherches restantes (plan: ${plan})`
        : `plan: ${plan}`,
    };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

async function testGooglePlaces(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Minimal test: geocode a well-known place
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=Eiffel+Tower&inputtype=textquery&fields=name&key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    );

    const latencyMs = Date.now() - start;
    const data = await response.json();

    if (data.status === 'REQUEST_DENIED') {
      return { status: 'error', latencyMs, error: 'API key denied — vérifier restrictions' };
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      return { status: 'quota_exceeded', latencyMs, error: 'Quota dépassé' };
    }
    if (data.status === 'OK') {
      return { status: 'ok', latencyMs };
    }
    return { status: 'error', latencyMs, error: `Status: ${data.status}` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

async function testOverpass(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const start = Date.now();
  try {
    // Tiny query: count restaurants near Eiffel Tower in 100m radius
    const query = `[out:json][timeout:5];node["amenity"="restaurant"](around:100,48.8584,2.2945);out count;`;
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
    return { status: 'ok', latencyMs, details: `${count} restaurants trouvés (test)` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

async function testViator(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.VIATOR_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Use the same endpoint the app actually calls: /partner/search/freetext
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
    const destCount = data?.destinations?.results?.length || 0;
    return { status: 'ok', latencyMs, details: `${destCount} destinations trouvées (test)` };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

async function testAnthropic(): Promise<Pick<ApiStatus, 'status' | 'error' | 'latencyMs' | 'details'>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 'not_configured' };

  const start = Date.now();
  try {
    // Minimal test: count tokens endpoint or just check auth
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
      return { status: 'quota_exceeded', latencyMs, error: 'Rate limited (429) — vérifier crédits' };
    }
    if (!response.ok && response.status !== 200) {
      // count_tokens might not exist, try to get useful info
      const text = await response.text().catch(() => '');
      if (text.includes('not_found')) {
        // endpoint doesn't exist, but auth worked
        return { status: 'ok', latencyMs, details: 'Auth OK' };
      }
      return { status: 'error', latencyMs, error: `HTTP ${response.status}` };
    }

    return { status: 'ok', latencyMs };
  } catch (error: unknown) {
    return { status: 'error', latencyMs: Date.now() - start, error: getErrorMessage(error) };
  }
}

// ============================================
// Handler
// ============================================

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const doTest = request.nextUrl.searchParams.get('test') === 'true';

  // Re-read env vars at request time (not import time)
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();

  const apis: ApiStatus[] = [
    {
      name: 'Anthropic (Claude)',
      configured: !!anthropicKey,
      envVar: 'ANTHROPIC_API_KEY',
      usage: 'Génération itinéraire, curation, chat',
      status: 'untested',
    },
    {
      name: 'Gemini + Google Search',
      configured: isGeminiConfigured(),
      envVar: 'GOOGLE_AI_API_KEY',
      usage: 'Restaurants (priorité 1), geocoding',
      status: 'untested',
    },
    {
      name: 'TripAdvisor (RapidAPI)',
      configured: isTripAdvisorConfigured(),
      envVar: 'RAPIDAPI_KEY',
      usage: 'Restaurants (priorité 2), hôtels, Michelin',
      status: 'untested',
    },
    {
      name: 'SerpAPI',
      configured: isSerpApiPlacesConfigured(),
      envVar: 'SERPAPI_KEY',
      usage: 'Restaurants (priorité 3), attractions Google Maps',
      status: 'untested',
    },
    {
      name: 'Google Places',
      configured: !!process.env.GOOGLE_PLACES_API_KEY,
      envVar: 'GOOGLE_PLACES_API_KEY',
      usage: 'Restaurants (priorité 4)',
      status: 'untested',
    },
    {
      name: 'Overpass (OSM)',
      configured: isOverpassConfigured(),
      envVar: '(aucune clé requise)',
      usage: 'Restaurants (priorité 5), attractions',
      status: 'untested',
    },
    {
      name: 'Viator',
      configured: isViatorConfigured(),
      envVar: 'VIATOR_API_KEY',
      usage: 'Activités réservables, durées',
      status: 'untested',
    },
    {
      name: 'Foursquare',
      configured: isFoursquareConfigured(),
      envVar: 'FOURSQUARE_CLIENT_ID + FOURSQUARE_CLIENT_SECRET',
      usage: 'Restaurants (fallback)',
      status: 'untested',
    },
  ];

  // Set configured/not_configured status
  for (const api of apis) {
    if (!api.configured) {
      api.status = 'not_configured';
    }
  }

  // If test mode, run actual API calls in parallel
  if (doTest) {
    const tests: PromiseSettledResult<TestProbeResult>[] = await Promise.allSettled([
      testAnthropic(),
      testGemini(),
      testRapidApi(),
      testSerpApi(),
      testGooglePlaces(),
      testOverpass(),
      testViator(),
    ]);

    const testNames = ['Anthropic (Claude)', 'Gemini + Google Search', 'TripAdvisor (RapidAPI)', 'SerpAPI', 'Google Places', 'Overpass (OSM)', 'Viator'];
    for (let i = 0; i < tests.length; i++) {
      const api = apis.find(a => a.name === testNames[i]);
      if (!api) continue;
      const test = tests[i];
      if (!test) continue;

      if (test.status === 'fulfilled') {
        const result = test.value;
        // Don't override not_configured
        if (api.configured) {
          api.status = result.status;
          api.error = result.error;
          api.latencyMs = result.latencyMs;
          api.details = result.details;
        }
      } else {
        if (api.configured) {
          api.status = 'error';
          api.error = getErrorMessage(test.reason);
        }
      }
    }
  }

  // Summary
  const configured = apis.filter(a => a.configured).length;
  const errors = apis.filter(a => a.status === 'error' || a.status === 'quota_exceeded').length;
  const restaurantSources = apis.filter(a => a.usage.includes('Restaurant') && a.configured);

  const summary = {
    timestamp: new Date().toISOString(),
    mode: doTest ? 'test (appels API réels)' : 'config_only (ajouter ?test=true pour tester)',
    totalApis: apis.length,
    configured,
    notConfigured: apis.length - configured,
    errors,
    restaurantSourcesActive: restaurantSources.length,
    overallStatus: errors > 0 ? 'degraded' : configured >= 4 ? 'healthy' : 'minimal',
  };

  return NextResponse.json({ summary, apis }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
