/**
 * Service Impact.com — Génération de liens affiliés trackés pour Omio
 *
 * API Impact.com Tracking Link (affiliate)
 * - Convertit un deep link Omio en lien tracké avec commission
 * - Appel server-side uniquement (credentials protégées)
 * - Cache fichier 30 jours (même route = même lien)
 *
 * Env vars requises:
 *   IMPACT_ACCOUNT_SID  — Account SID Impact (commence par IR)
 *   IMPACT_AUTH_TOKEN    — Auth token Impact
 *   IMPACT_OMIO_PROGRAM_ID — Program ID Omio (7385)
 */

import * as fs from 'fs';
import * as path from 'path';

const IMPACT_ACCOUNT_SID = process.env.IMPACT_ACCOUNT_SID?.trim();
const IMPACT_AUTH_TOKEN = process.env.IMPACT_AUTH_TOKEN?.trim();
const IMPACT_OMIO_PROGRAM_ID = process.env.IMPACT_OMIO_PROGRAM_ID?.trim();

// Cache fichier 30 jours (même trajet/date = même lien tracké)
const CACHE_DIR = path.join(process.cwd(), '.cache', 'impact');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/**
 * Vérifie que les credentials Impact sont configurées
 */
export function isImpactConfigured(): boolean {
  return !!(IMPACT_ACCOUNT_SID && IMPACT_AUTH_TOKEN && IMPACT_OMIO_PROGRAM_ID);
}

// ==================== Cache fichier ====================

function getCacheKey(url: string): string {
  // Hash l'URL en nom de fichier safe
  const key = url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9-]/g, '_');
  return key.substring(0, 200);
}

function readCache(key: string): string | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.trackingUrl || null;
  } catch {
    return null;
  }
}

function writeCache(key: string, trackingUrl: string): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify({ trackingUrl, createdAt: new Date().toISOString() })
    );
  } catch (error) {
    console.warn('[Impact Cache] Erreur écriture:', error);
  }
}

// ==================== API Impact ====================

/**
 * Crée un tracking link Impact pour une URL Omio.
 * Retourne l'URL trackée, ou null si l'API échoue (fallback URL directe).
 */
export async function createTrackingLink(deepLinkUrl: string): Promise<string | null> {
  if (!isImpactConfigured()) {
    return null;
  }

  // Vérifier le cache d'abord
  const cacheKey = getCacheKey(deepLinkUrl);
  const cached = readCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const authString = Buffer.from(`${IMPACT_ACCOUNT_SID}:${IMPACT_AUTH_TOKEN}`).toString('base64');

    const response = await fetch(
      `https://api.impact.com/Mediapartners/${IMPACT_ACCOUNT_SID}/Programs/${IMPACT_OMIO_PROGRAM_ID}/TrackingLinks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          DeepLink: deepLinkUrl,
          Type: 'Regular',
        }).toString(),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Impact API] Erreur ${response.status}: ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json() as { TrackingURL?: string };

    if (data.TrackingURL) {
      writeCache(cacheKey, data.TrackingURL);
      return data.TrackingURL;
    }

    console.warn('[Impact API] Pas de TrackingURL dans la réponse');
    return null;
  } catch (error) {
    console.error('[Impact API] Erreur:', error);
    return null;
  }
}

/**
 * Batch: convertit plusieurs URLs Omio en liens trackés, en parallèle.
 * Retourne une Map<urlOriginale, urlTrackée>.
 * Les URLs en erreur ne sont pas dans la Map → utiliser l'URL originale.
 */
export async function createTrackingLinks(
  urls: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (!isImpactConfigured() || urls.length === 0) return results;

  // Dédupliquer (même route = même URL)
  const uniqueUrls = [...new Set(urls)];
  const promises = uniqueUrls.map(async (url) => {
    const trackingUrl = await createTrackingLink(url);
    if (trackingUrl) {
      results.set(url, trackingUrl);
    }
  });

  await Promise.all(promises);
  return results;
}
