/**
 * API Route pour rechercher des attractions
 * Priorite: 1. Local DB, 2. SerpAPI (Google), 3. Cache, 4. Claude AI
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Attraction, getAttractions, getMustSeeAttractions } from '@/lib/services/attractions';
import { normalizeCity } from '@/lib/services/cityNormalization';
import { ActivityType } from '@/lib/types';
import { tokenTracker } from '@/lib/services/tokenTracker';
import { searchAttractionsWithSerpApi, isSerpApiPlacesConfigured } from '@/lib/services/serpApiPlaces';
import { getCityCenterCoords } from '@/lib/services/geocoding';
import * as fs from 'fs';
import * as path from 'path';

// Cache file path
const CACHE_DIR = path.join(process.cwd(), 'data', 'attractions-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'attractions.json');

interface AttractionsCache {
  [destination: string]: {
    attractions: Attraction[];
    fetchedAt: string;
    version: number;
  };
}

function loadCache(): AttractionsCache {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Erreur lecture cache attractions:', error);
  }
  return {};
}

function saveCache(cache: AttractionsCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Erreur sauvegarde cache attractions:', error);
  }
}

function normalizeDestination(dest: string): string {
  return dest.toLowerCase().trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-');
}

function validateActivityType(type: string): ActivityType {
  const validTypes: ActivityType[] = [
    'culture', 'nature', 'gastronomy', 'beach',
    'shopping', 'nightlife', 'adventure', 'wellness'
  ];
  const normalized = type?.toLowerCase().trim() as ActivityType;
  return validTypes.includes(normalized) ? normalized : 'culture';
}

async function fetchAttractionsFromClaude(
  destination: string,
  types?: ActivityType[]
): Promise<Attraction[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const client = new Anthropic({ apiKey });

  const typesList = types?.length
    ? types.join(', ')
    : 'culture, nature, gastronomy, beach, shopping, nightlife, adventure, wellness';

  const prompt = `Tu es un expert en voyage. Génère une liste de 10-15 attractions touristiques RÉELLES et populaires pour ${destination}.

Pour chaque attraction, fournis les informations au format JSON suivant:
{
  "id": "identifiant-unique-en-kebab-case",
  "name": "Nom officiel de l'attraction",
  "type": "culture|nature|gastronomy|beach|shopping|nightlife|adventure|wellness",
  "description": "Description courte et attrayante (1-2 phrases)",
  "duration": 90, // durée de visite recommandée en minutes
  "estimatedCost": 15, // coût estimé en euros par personne (0 si gratuit)
  "latitude": 41.4036, // coordonnées GPS exactes
  "longitude": 2.1744,
  "rating": 4.5, // note moyenne sur 5
  "mustSee": true, // true si c'est un incontournable
  "bookingRequired": true, // true si réservation recommandée
  "bookingUrl": "https://...", // URL de réservation officielle si disponible
  "openingHours": { "open": "09:00", "close": "20:00" },
  "tips": "Conseil pratique pour les visiteurs"
}

Types d'activités à inclure prioritairement: ${typesList}

IMPORTANT:
- Utilise UNIQUEMENT des attractions qui EXISTENT VRAIMENT
- Les coordonnées GPS doivent être EXACTES et RÉELLES
- Inclus les prix d'entrée actuels (approximatifs)
- Inclus les horaires d'ouverture typiques
- Donne des URLs de réservation officielles quand disponibles
- Varie les types d'attractions (musées, monuments, quartiers, restaurants emblématiques, parcs, etc.)

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ou après.`;

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  // Tracker les tokens consommés
  if (response.usage) {
    tokenTracker.track(response.usage, `API Attractions: ${destination}`);
  }

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Réponse Claude invalide');
  }

  // Parser le JSON
  let jsonStr = content.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  const attractions: Attraction[] = JSON.parse(jsonStr);

  // Valider et nettoyer
  return attractions.map((a, index) => ({
    id: a.id || `${normalizeDestination(destination)}-${index}`,
    name: a.name,
    type: validateActivityType(a.type),
    description: a.description || '',
    duration: Math.max(30, Math.min(300, a.duration || 90)),
    estimatedCost: Math.max(0, a.estimatedCost || 0),
    latitude: a.latitude || 0,
    longitude: a.longitude || 0,
    rating: Math.max(1, Math.min(5, a.rating || 4)),
    mustSee: Boolean(a.mustSee),
    bookingRequired: Boolean(a.bookingRequired),
    bookingUrl: a.bookingUrl || undefined,
    openingHours: a.openingHours || { open: '09:00', close: '18:00' },
    tips: a.tips || undefined,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const destination = searchParams.get('destination') || searchParams.get('city');
  const forceRefresh = searchParams.get('forceRefresh') === 'true';
  const typesParam = searchParams.get('types');
  const mustSeeOnly = searchParams.get('mustSee') === 'true';

  if (!destination) {
    return NextResponse.json({ error: 'destination requise' }, { status: 400 });
  }

  // Normaliser la ville (supporte toutes les langues)
  const normalizedCity = await normalizeCity(destination);
  // Si mustSee=true, retourner uniquement les incontournables de la base locale
  if (mustSeeOnly) {
    const localAttractions = getMustSeeAttractions(normalizedCity.displayName);

    if (localAttractions.length > 0) {
      return NextResponse.json({
        attractions: localAttractions.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          description: a.description,
          duration: a.duration,
          estimatedCost: a.estimatedCost,
          mustSee: a.mustSee,
          latitude: a.latitude,
          longitude: a.longitude,
        })),
        source: 'local',
        city: normalizedCity.displayName,
      });
    }

    // Pas d'attractions locales, fallback vers cache/Claude
  }

  const types = typesParam ? typesParam.split(',') as ActivityType[] : undefined;
  const normalizedDest = normalizeDestination(destination);
  const cache = loadCache();
  const cacheMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 jours

  // Vérifier le cache
  const cached = cache[normalizedDest];
  if (
    cached &&
    !forceRefresh &&
    new Date().getTime() - new Date(cached.fetchedAt).getTime() < cacheMaxAge
  ) {
    return NextResponse.json({
      attractions: cached.attractions,
      source: 'cache',
      cachedAt: cached.fetchedAt,
    });
  }

  try {
    let attractions: Attraction[] = [];

    // Priorite 1: SerpAPI (Google Places) - gratuit 100 req/mois
    if (isSerpApiPlacesConfigured()) {
      try {
        attractions = await searchAttractionsWithSerpApi(destination, { limit: 15 });
      } catch (serpError) {
        console.warn('[API Attractions] SerpAPI erreur:', serpError);
      }
    }

    // Priorite 2: Claude AI (si SerpAPI echoue ou retourne peu de resultats)
    if (attractions.length < 5) {
      const claudeAttractions = await fetchAttractionsFromClaude(destination, types);
      // Merger sans doublons
      const existingIds = new Set(attractions.map(a => a.id));
      for (const a of claudeAttractions) {
        if (!existingIds.has(a.id)) {
          attractions.push(a);
        }
      }
    }

    // Sauvegarder en cache
    cache[normalizedDest] = {
      attractions,
      fetchedAt: new Date().toISOString(),
      version: 1,
    };
    saveCache(cache);

    return NextResponse.json({
      attractions,
      source: 'claude',
      cachedAt: cache[normalizedDest].fetchedAt,
    });
  } catch (error) {
    console.error('Erreur recherche attractions:', error);

    // Retourner le cache expiré si disponible
    if (cached) {
      console.warn('Utilisation du cache expiré pour', destination);
      return NextResponse.json({
        attractions: cached.attractions,
        source: 'cache-expired',
        cachedAt: cached.fetchedAt,
        error: 'Claude API error, using expired cache',
      });
    }

    return NextResponse.json(
      { error: 'Impossible de récupérer les attractions', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Permet aussi de rechercher via POST avec body
  const body = await request.json();
  const { destination, forceRefresh, types } = body;

  if (!destination) {
    return NextResponse.json({ error: 'destination requise' }, { status: 400 });
  }

  // Rediriger vers la logique GET
  const url = new URL(request.url);
  url.searchParams.set('destination', destination);
  if (forceRefresh) url.searchParams.set('forceRefresh', 'true');
  if (types) url.searchParams.set('types', types.join(','));

  const getRequest = new NextRequest(url);
  return GET(getRequest);
}
