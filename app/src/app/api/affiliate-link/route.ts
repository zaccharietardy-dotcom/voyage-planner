import { NextRequest, NextResponse } from 'next/server';

/**
 * API Route: Génération de liens affiliés via Travelpayouts Partner Links API
 *
 * POST /api/affiliate-link
 * Body: { url: string } ou { urls: string[] }
 *
 * Convertit un lien direct (ex: aviasales.com/search/...) en lien affilié tracké
 */

const TRAVELPAYOUTS_API_URL = 'https://api.travelpayouts.com/links/v1/create';

interface TravelpayoutsLink {
  url: string;
  code: string;
  partner_url: string;
  message?: string;
  campaign_id?: number;
}

interface TravelpayoutsResponse {
  result: {
    trs: number;
    marker: number;
    shorten: boolean;
    links: TravelpayoutsLink[];
  };
  code: string;
  status: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const token = process.env.TRAVELPAYOUTS_API_TOKEN;
    const marker = parseInt(process.env.TRAVELPAYOUTS_MARKER || '0');
    const trs = parseInt(process.env.TRAVELPAYOUTS_TRS || '0');

    if (!token || !marker || !trs) {
      return NextResponse.json(
        { error: 'Travelpayouts credentials not configured' },
        { status: 500 }
      );
    }

    // Accepter un seul URL ou un tableau
    const urls: string[] = body.urls || (body.url ? [body.url] : []);

    if (urls.length === 0) {
      return NextResponse.json(
        { error: 'No URL(s) provided. Send { url: "..." } or { urls: ["..."] }' },
        { status: 400 }
      );
    }

    if (urls.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 links per request' },
        { status: 400 }
      );
    }

    const payload = {
      trs,
      marker,
      shorten: true,
      links: urls.map((url: string) => ({ url })),
    };

    const response = await fetch(TRAVELPAYOUTS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': token,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Travelpayouts API] Error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Travelpayouts API error', details: errorText },
        { status: response.status }
      );
    }

    const data: TravelpayoutsResponse = await response.json();

    // Retourner un format simple
    const results = data.result.links.map((link) => ({
      original: link.url,
      affiliate: link.partner_url || link.url, // fallback sur l'original si échec
      success: link.code === 'success',
      error: link.code !== 'success' ? link.message : undefined,
    }));

    // Si un seul lien demandé, retourner directement
    if (urls.length === 1) {
      return NextResponse.json(results[0]);
    }

    return NextResponse.json({ links: results });
  } catch (error) {
    console.error('[Affiliate Link] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
