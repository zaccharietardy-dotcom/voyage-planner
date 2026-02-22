import { NextRequest, NextResponse } from 'next/server';
import { extractPlacesFromSocialMedia, detectPlatform, validateSocialImportUrl } from '@/lib/services/socialMediaImport';

// Rate limiting simple (en mémoire - perdu au redémarrage)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10; // Max 10 calls per hour per IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);

  if (!record || now > record.resetAt) {
    // Reset window
    rateLimitMap.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Limite de requêtes atteinte. Réessayez dans 1 heure.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { url, text, platform } = body as {
      url?: string;
      text?: string;
      platform?: string;
    };

    // Validation
    if (!url && !text) {
      return NextResponse.json(
        { error: 'Veuillez fournir une URL ou du texte' },
        { status: 400 }
      );
    }

    if (url) {
      try {
        await validateSocialImportUrl(url);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'URL non autorisée';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const input = url || text || '';

    // Extraction
    const places = await extractPlacesFromSocialMedia(input);

    // Détecter la plateforme si URL fournie
    const detectedPlatform = url ? detectPlatform(url) : (platform || 'unknown');

    return NextResponse.json({
      success: true,
      platform: detectedPlatform,
      places,
      count: places.length,
    });
  } catch (error) {
    console.error('[API /api/import/social] Error:', error);

    const message = error instanceof Error ? error.message : 'Erreur lors de l\'extraction des lieux';

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
