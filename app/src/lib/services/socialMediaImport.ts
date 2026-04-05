/**
 * Service d'extraction de lieux depuis les réseaux sociaux
 * Utilise Gemini Flash pour l'extraction AI des noms de lieux
 * Supporte: Instagram, TikTok, YouTube, blogs
 *
 * ## Utilisation
 *
 * ### Via l'API
 * ```typescript
 * POST /api/import/social
 * {
 *   "url": "https://www.instagram.com/p/ABC123/",  // ou
 *   "text": "J'ai adoré manger à La Pergola à Rome..."
 * }
 * ```
 *
 * ### Via le service
 * ```typescript
 * import { extractPlacesFromSocialMedia } from '@/lib/services/socialMediaImport';
 *
 * // Depuis une URL
 * const places = await extractPlacesFromSocialMedia('https://instagram.com/p/ABC123/');
 *
 * // Depuis du texte
 * const places = await extractPlacesFromSocialMedia('Visite du Louvre à Paris...');
 * ```
 *
 * ## Comment ça marche
 *
 * 1. **Détection de la source**: URL ou texte brut
 * 2. **Extraction des métadonnées**: Open Graph pour les URLs (titre + description)
 * 3. **Analyse AI**: Gemini Flash extrait les noms de lieux, villes, pays
 * 4. **Géocodage**: Google Geocoding API pour obtenir les coordonnées GPS
 * 5. **Catégorisation**: Détection automatique du type (restaurant, monument, etc.)
 *
 * ## Limitations
 *
 * - Instagram/TikTok bloquent les bots → méthode recommandée: coller le texte directement
 * - Nécessite GOOGLE_AI_API_KEY (Gemini) et GOOGLE_PLACES_API_KEY
 * - Rate limit: 10 appels par heure par IP (configurable dans l'API route)
 * - Les lieux avec confiance < 0.5 sont ignorés
 * - Si le géocodage échoue, les coords sont mises à (0,0) avec une note
 */

import type { ImportedPlace } from '../types';
import { detectCategory } from './googleMapsImport';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';

export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'blog' | 'unknown';

export interface SocialMediaExtraction {
  platform: SocialPlatform;
  sourceUrl?: string;
  places: ImportedPlace[];
  rawText?: string;
  confidence: number;
}

interface ExtractedPlaceRaw {
  name: string;
  city?: string;
  country?: string;
  category?: string;
  confidence?: number;
  originalMention?: string;
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const SOCIAL_FETCH_TIMEOUT_MS = 10000;
const SOCIAL_FETCH_REDIRECT_LIMIT = 3;
const SOCIAL_USER_AGENT = 'Mozilla/5.0 (compatible; NaraeVoyage/1.0; +https://naraevoyage.com)';

const ALLOWED_SOCIAL_HOST_PATTERNS = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)medium\.com$/i,
  /(^|\.)wordpress\.com$/i,
  /(^|\.)blogger\.com$/i,
  /(^|\.)substack\.com$/i,
  /(^|\.)ghost\.io$/i,
];

function getGeminiApiKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function isPrivateOrReservedIPv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = octets;

  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // Loopback
  if (a === 169 && b === 254) return true; // Link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true; // "This network"
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && b === 18) return true; // Benchmarking
  if (a === 198 && b === 19) return true; // Benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast + reserved

  return false;
}

function isPrivateOrReservedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true; // Unspecified + loopback
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (
    normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  ) return true; // Link-local
  if (normalized.startsWith('ff')) return true; // Multicast
  if (normalized.startsWith('2001:db8')) return true; // Documentation range

  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedV4) return isPrivateOrReservedIPv4(mappedV4);

  return false;
}

export function isBlockedIpAddress(address: string): boolean {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isPrivateOrReservedIPv4(address);
  if (ipVersion === 6) return isPrivateOrReservedIPv6(address);
  return true;
}

export function isAllowedSocialHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return ALLOWED_SOCIAL_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  const normalized = normalizeHostname(hostname);
  const ipVersion = net.isIP(normalized);
  if (ipVersion > 0) {
    if (isBlockedIpAddress(normalized)) {
      throw new Error('Hôte non autorisé');
    }
    return;
  }

  let records: LookupAddress[];
  try {
    records = await dns.lookup(normalized, { all: true, verbatim: true });
  } catch {
    throw new Error('Hôte non résolu');
  }
  if (records.length === 0) {
    throw new Error('Hôte non résolu');
  }

  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error('Hôte non autorisé');
    }
  }
}

export async function validateSocialImportUrl(inputUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('URL invalide');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Seules les URLs HTTPS sont autorisées');
  }

  const normalizedHost = normalizeHostname(parsed.hostname);
  if (!isAllowedSocialHostname(normalizedHost)) {
    throw new Error('Domaine non autorisé pour l\'import social');
  }

  await assertHostIsPublic(normalizedHost);
  return parsed;
}

export async function fetchUrlWithSafeRedirects(inputUrl: string): Promise<Response> {
  let current = await validateSocialImportUrl(inputUrl);

  for (let redirects = 0; redirects <= SOCIAL_FETCH_REDIRECT_LIMIT; redirects += 1) {
    const response = await fetch(current.toString(), {
      headers: {
        'User-Agent': SOCIAL_USER_AGENT,
      },
      signal: AbortSignal.timeout(SOCIAL_FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirection invalide');
    }

    if (redirects >= SOCIAL_FETCH_REDIRECT_LIMIT) {
      throw new Error('Trop de redirections');
    }

    const nextUrl = new URL(location, current);
    current = await validateSocialImportUrl(nextUrl.toString());
  }

  throw new Error('Trop de redirections');
}

/**
 * Détecte la plateforme à partir d'une URL
 */
export function detectPlatform(url: string): SocialPlatform {
  try {
    const urlObj = new URL(url);
    const hostname = normalizeHostname(urlObj.hostname);

    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';

    // Blogs populaires
    if (
      hostname.includes('medium.com') ||
      hostname.includes('wordpress.com') ||
      hostname.includes('blogger.com') ||
      hostname.includes('substack.com') ||
      hostname.includes('ghost.io')
    ) {
      return 'blog';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Tente d'extraire les métadonnées Open Graph d'une URL
 * Retourne le texte extrait (titre + description)
 */
async function fetchOpenGraphMetadata(url: string): Promise<string | null> {
  try {
    const response = await fetchUrlWithSafeRedirects(url);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extraire les meta tags Open Graph
    const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);

    const title = ogTitleMatch?.[1] || titleMatch?.[1] || '';
    const description = ogDescMatch?.[1] || descMatch?.[1] || '';

    const combined = [title, description].filter(Boolean).join('\n');
    return combined || null;
  } catch (error) {
    console.warn('[Social Media Import] Fetch metadata failed:', error);
    return null;
  }
}

/**
 * Extrait des lieux depuis une URL Instagram
 */
export async function extractFromInstagramUrl(url: string): Promise<ImportedPlace[]> {
  // Instagram bloque les bots, on essaie juste les métadonnées
  const metadata = await fetchOpenGraphMetadata(url);

  if (!metadata) {
    throw new Error('Impossible de récupérer les données depuis Instagram. Essayez de coller directement le texte de la légende.');
  }

  return extractFromText(metadata, 'instagram', url);
}

/**
 * Extrait des lieux depuis une URL TikTok
 */
export async function extractFromTikTokUrl(url: string): Promise<ImportedPlace[]> {
  // TikTok bloque aussi les bots
  const metadata = await fetchOpenGraphMetadata(url);

  if (!metadata) {
    throw new Error('Impossible de récupérer les données depuis TikTok. Essayez de coller directement le texte de la description.');
  }

  return extractFromText(metadata, 'tiktok', url);
}

/**
 * Extrait des lieux depuis une URL YouTube
 */
export async function extractFromYouTubeUrl(url: string): Promise<ImportedPlace[]> {
  const metadata = await fetchOpenGraphMetadata(url);

  if (!metadata) {
    throw new Error('Impossible de récupérer les données depuis YouTube. Essayez de coller directement le texte de la description.');
  }

  return extractFromText(metadata, 'youtube', url);
}

/**
 * Extrait des lieux depuis une URL de blog
 */
export async function extractFromBlogUrl(url: string): Promise<ImportedPlace[]> {
  const metadata = await fetchOpenGraphMetadata(url);

  if (!metadata) {
    throw new Error('Impossible de récupérer les données depuis ce site. Essayez de coller directement le texte.');
  }

  return extractFromText(metadata, 'blog', url);
}

/**
 * Parse le JSON généré par Gemini de manière résiliente
 */
function parseGeminiJson(text: string): any {
  // Nettoyer le markdown si présent
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  // Remplacer les guillemets typographiques
  cleaned = cleaned
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // Supprimer les trailing commas
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('[Social Media Import] JSON parse error:', error);
    throw new Error('Réponse AI invalide - impossible de parser le JSON');
  }
}

/**
 * Utilise Gemini Flash pour extraire les lieux depuis du texte
 */
export async function extractFromText(
  text: string,
  platform: SocialPlatform = 'unknown',
  sourceUrl?: string
): Promise<ImportedPlace[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Configuration manquante: GOOGLE_AI_API_KEY non défini');
  }

  if (!text.trim()) {
    throw new Error('Le texte est vide');
  }

  const platformLabels: Record<SocialPlatform, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    blog: 'un blog de voyage',
    unknown: 'les réseaux sociaux',
  };

  const prompt = `Analyse ce contenu provenant de ${platformLabels[platform]}. Extrais tous les lieux mentionnés (restaurants, hôtels, attractions, monuments, quartiers, villes, plages, parcs, etc.).

Pour chaque lieu, identifie:
- Le nom exact du lieu
- La ville où il se trouve
- Le pays
- Le type de lieu (restaurant, hotel, museum, attraction, neighborhood, cafe, bar, park, beach, shop, monument, viewpoint, etc.)
- Ta confiance dans l'extraction (0.0 à 1.0)

Retourne UNIQUEMENT un JSON valide (pas de markdown, pas de texte avant ou après):
{
  "places": [
    {
      "name": "Tour Eiffel",
      "city": "Paris",
      "country": "France",
      "category": "monument",
      "confidence": 0.95,
      "originalMention": "la phrase exacte qui mentionne ce lieu"
    }
  ]
}

IMPORTANT:
- Ne retourne que les lieux SPÉCIFIQUES (pas "un restaurant" mais "La Pergola")
- Ignore les mentions vagues ou génériques
- Si tu n'es pas sûr de la ville/pays, mets "Unknown"
- Catégories valides: restaurant, hotel, museum, attraction, monument, church, park, beach, viewpoint, shopping, market, cafe, bar, theater, castle, neighborhood, other

Contenu à analyser:
${text}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Social Media Import] Gemini API error:', response.status, errorText);
      throw new Error(`Erreur API Gemini (${response.status})`);
    }

    const data = await response.json();

    if (data.error) {
      console.error('[Social Media Import] Gemini error:', data.error);
      throw new Error(`Erreur Gemini: ${data.error.message || 'Erreur inconnue'}`);
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error('Aucune réponse de l\'IA');
    }

    // Parser le JSON
    const parsed = parseGeminiJson(textContent);
    const rawPlaces: ExtractedPlaceRaw[] = parsed.places || [];

    if (rawPlaces.length === 0) {
      return [];
    }

    // Géocoder chaque lieu
    const places: ImportedPlace[] = [];

    for (const raw of rawPlaces) {
      // Skip si pas de nom ou confiance trop basse
      if (!raw.name || (raw.confidence && raw.confidence < 0.5)) {
        continue;
      }

      try {
        // Géocoder via Google Places API
        const coords = await geocodePlaceWithGoogle(raw.name, raw.city, raw.country);

        if (coords) {
          places.push({
            name: raw.name,
            lat: coords.lat,
            lng: coords.lng,
            address: coords.address,
            category: raw.category || detectCategory(raw.name),
            notes: raw.originalMention,
            sourceUrl,
            source: 'manual', // On marque comme 'manual' car c'est un import utilisateur
          });
        } else {
          // Si géocodage échoue, on ajoute quand même avec coords à 0
          // L'utilisateur pourra vérifier manuellement
          console.warn(`[Social Media Import] Geocoding failed for: ${raw.name}`);
          places.push({
            name: raw.name,
            lat: 0,
            lng: 0,
            category: raw.category || detectCategory(raw.name),
            notes: `${raw.originalMention || ''} (Coordonnées à vérifier - géocodage échoué)`.trim(),
            sourceUrl,
            source: 'manual',
          });
        }
      } catch (geoError) {
        console.warn(`[Social Media Import] Geocoding error for ${raw.name}:`, geoError);
        // Continuer avec le prochain lieu
      }
    }

    return places;
  } catch (error) {
    console.error('[Social Media Import] Extraction error:', error);
    throw error;
  }
}

/**
 * Géocode un lieu via Google Places API
 */
async function geocodePlaceWithGoogle(
  placeName: string,
  city?: string,
  country?: string
): Promise<{ lat: number; lng: number; address?: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('[Social Media Import] Google Places API key not configured');
    return null;
  }

  // Construire la query
  let query = placeName;
  if (city && city !== 'Unknown') {
    query += `, ${city}`;
  }
  if (country && country !== 'Unknown') {
    query += `, ${country}`;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status === 'OK' && data.results?.[0]) {
      const result = data.results[0];
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        address: result.formatted_address,
      };
    }

    return null;
  } catch (error) {
    console.warn('[Social Media Import] Geocoding error:', error);
    return null;
  }
}

/**
 * Point d'entrée principal: extrait des lieux depuis une URL ou du texte
 */
export async function extractPlacesFromSocialMedia(input: string): Promise<ImportedPlace[]> {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('Veuillez saisir une URL ou du texte');
  }

  // Essayer de détecter si c'est une URL
  let isUrl = false;
  let platform: SocialPlatform = 'unknown';

  try {
    new URL(trimmed);
    isUrl = true;
    platform = detectPlatform(trimmed);
  } catch {
    isUrl = false;
  }

  // Si c'est une URL, essayer d'extraire via la plateforme
  if (isUrl) {
    const validatedUrl = await validateSocialImportUrl(trimmed);
    const safeUrl = validatedUrl.toString();

    switch (platform) {
      case 'instagram':
        return extractFromInstagramUrl(safeUrl);
      case 'tiktok':
        return extractFromTikTokUrl(safeUrl);
      case 'youtube':
        return extractFromYouTubeUrl(safeUrl);
      case 'blog':
        return extractFromBlogUrl(safeUrl);
      default:
        // URL inconnue, essayer quand même de fetch les métadonnées
        const metadata = await fetchOpenGraphMetadata(safeUrl);
        if (metadata) {
          return extractFromText(metadata, 'unknown', safeUrl);
        }
        throw new Error('Plateforme non reconnue. Essayez de coller directement le texte.');
    }
  }

  // Sinon, traiter comme du texte brut
  return extractFromText(trimmed);
}
