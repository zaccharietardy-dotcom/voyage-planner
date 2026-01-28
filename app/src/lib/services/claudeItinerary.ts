/**
 * Claude Itinerary Curation Service
 *
 * Reçoit un gros pool d'attractions SerpAPI (50+) et utilise Claude Sonnet
 * pour concevoir un itinéraire intelligent:
 * - Regroupement par quartier/zone géographique
 * - Day trips (Mt. Fuji, Versailles, Pompéi...)
 * - Saisonnalité (cerisiers, illuminations...)
 * - Narratif de guide de voyage
 *
 * Coût estimé: 1 appel Sonnet par voyage (~$0.05-0.15)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Attraction } from './attractions';
import { ActivityType } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Types
// ============================================

export interface AttractionSummary {
  id: string;
  name: string;
  type: string;
  rating: number;
  description: string;
  latitude: number;
  longitude: number;
  estimatedDuration: number;
  estimatedCost: number;
}

export interface ClaudeItineraryRequest {
  destination: string;
  durationDays: number;
  startDate: string;
  activities: string[];
  budgetLevel: string;
  mustSee?: string;
  groupType?: string;
  attractionPool: AttractionSummary[];
}

export interface ClaudeItineraryDay {
  dayNumber: number;
  theme: string;
  isDayTrip: boolean;
  dayTripDestination?: string;
  dayTripTransport?: string;
  selectedAttractionIds: string[];
  additionalSuggestions: {
    name: string;
    whyVisit: string;
    estimatedDuration: number;
    estimatedCost: number;
    area: string;
  }[];
  dayNarrative: string;
}

export interface ClaudeItineraryResponse {
  days: ClaudeItineraryDay[];
  seasonalTips: string[];
  excludedReasons: { id: string; reason: string }[];
}

// ============================================
// Cache
// ============================================

const CACHE_DIR = path.join(process.cwd(), '.cache', 'itineraries');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function getCacheKey(req: ClaudeItineraryRequest): string {
  const key = `${req.destination}-${req.durationDays}-${req.activities.sort().join(',')}-${req.budgetLevel}-${req.mustSee || ''}`;
  return key.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 200);
}

function readCache(key: string): ClaudeItineraryResponse | null {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(key: string, data: ClaudeItineraryResponse): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch (error) {
    console.warn('[ClaudeItinerary] Cache write error:', error);
  }
}

// ============================================
// Season detection
// ============================================

function getSeason(dateStr: string): string {
  const month = new Date(dateStr).getMonth() + 1;
  if (month >= 3 && month <= 5) return 'printemps';
  if (month >= 6 && month <= 8) return 'été';
  if (month >= 9 && month <= 11) return 'automne';
  return 'hiver';
}

// ============================================
// Main function
// ============================================

export async function generateClaudeItinerary(
  request: ClaudeItineraryRequest
): Promise<ClaudeItineraryResponse | null> {
  // Check cache
  const cacheKey = getCacheKey(request);
  const cached = readCache(cacheKey);
  if (cached) {
    console.log('[ClaudeItinerary] Cache hit');
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[ClaudeItinerary] ANTHROPIC_API_KEY non configurée, fallback');
    return null;
  }

  const client = new Anthropic({ apiKey });
  const season = getSeason(request.startDate);

  // Compact attraction pool for the prompt
  const poolCompact = request.attractionPool.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    rating: a.rating,
    desc: a.description.substring(0, 80),
    lat: +a.latitude.toFixed(4),
    lng: +a.longitude.toFixed(4),
    dur: a.estimatedDuration,
    cost: a.estimatedCost,
  }));

  const prompt = `Tu es un guide de voyage expert. Conçois un itinéraire de ${request.durationDays} jours à ${request.destination}.

Date: ${request.startDate} (saison: ${season})
Voyageurs: ${request.groupType || 'couple'}, budget ${request.budgetLevel}
Activités souhaitées: ${request.activities.join(', ')}
Must-see: ${request.mustSee || 'aucun'}

Voici ${poolCompact.length} attractions récupérées sur place (données vérifiées avec GPS, horaires, prix).
Sélectionne les MEILLEURES et organise-les intelligemment:

${JSON.stringify(poolCompact)}

RÈGLES:
1. Sélectionne 4-6 attractions par jour complet, 2-3 pour jour d'arrivée/départ
2. Groupe par quartier/zone géographique (attractions proches le même jour)
3. Si le voyage fait 4+ jours, propose un day trip hors de la ville si pertinent (ex: Mt. Fuji depuis Tokyo, Versailles depuis Paris, Pompéi depuis Naples)
4. Considère la saison: cerisiers au printemps, illuminations en hiver, etc.
5. EXCLUE les cinémas, arcades, salles de sport, immeubles résidentiels
6. INCLUE le must-see du voyageur en priorité absolue
7. Si une attraction ESSENTIELLE manque du pool (ex: Senso-ji à Tokyo), ajoute-la dans additionalSuggestions
8. Pour chaque jour, écris un "dayNarrative" (1-2 phrases) comme un vrai guide

Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de backticks).
Format:
{
  "days": [
    {
      "dayNumber": 1,
      "theme": "Titre du jour",
      "isDayTrip": false,
      "dayTripDestination": null,
      "dayTripTransport": null,
      "selectedAttractionIds": ["id1", "id2"],
      "additionalSuggestions": [
        {"name": "Nom", "whyVisit": "Pourquoi", "estimatedDuration": 90, "estimatedCost": 10, "area": "Quartier"}
      ],
      "dayNarrative": "Description du jour"
    }
  ],
  "seasonalTips": ["Conseil saisonnier"],
  "excludedReasons": [{"id": "id", "reason": "Pourquoi exclu"}]
}`;

  try {
    console.log(`[ClaudeItinerary] Appel Claude Sonnet pour ${request.destination} (${request.durationDays}j, ${poolCompact.length} attractions)...`);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ClaudeItinerary] Pas de JSON dans la réponse');
      return null;
    }

    const parsed: ClaudeItineraryResponse = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!parsed.days || !Array.isArray(parsed.days) || parsed.days.length === 0) {
      console.error('[ClaudeItinerary] Structure invalide');
      return null;
    }

    console.log(`[ClaudeItinerary] ✅ Itinéraire généré: ${parsed.days.length} jours`);
    for (const day of parsed.days) {
      console.log(`  Jour ${day.dayNumber}: ${day.theme} (${day.selectedAttractionIds.length} attractions${day.isDayTrip ? ', DAY TRIP: ' + day.dayTripDestination : ''})`);
    }

    // Cache the result
    writeCache(cacheKey, parsed);

    return parsed;
  } catch (error) {
    console.error('[ClaudeItinerary] Erreur:', error);
    return null;
  }
}

/**
 * Convertit le pool d'attractions en format résumé pour Claude
 */
export function summarizeAttractions(attractions: Attraction[]): AttractionSummary[] {
  return attractions.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    rating: a.rating || 4.0,
    description: a.description || a.name,
    latitude: a.latitude || 0,
    longitude: a.longitude || 0,
    estimatedDuration: a.duration,
    estimatedCost: a.estimatedCost || 0,
  }));
}

/**
 * Mappe l'itinéraire Claude vers les attractions complètes par jour
 */
export function mapItineraryToAttractions(
  itinerary: ClaudeItineraryResponse,
  attractionPool: Attraction[],
): Attraction[][] {
  const poolMap = new Map<string, Attraction>();
  for (const a of attractionPool) {
    poolMap.set(a.id, a);
  }

  return itinerary.days.map(day => {
    const dayAttractions: Attraction[] = [];

    for (const id of day.selectedAttractionIds) {
      const attraction = poolMap.get(id);
      if (attraction) {
        dayAttractions.push(attraction);
      }
    }

    // Add additionalSuggestions as generated attractions
    for (const suggestion of day.additionalSuggestions) {
      dayAttractions.push({
        id: `claude-${suggestion.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}-${Date.now()}`,
        name: suggestion.name,
        type: 'culture' as ActivityType,
        description: suggestion.whyVisit,
        duration: suggestion.estimatedDuration,
        estimatedCost: suggestion.estimatedCost,
        latitude: 0, // Will be resolved by SerpAPI search or left as generated
        longitude: 0,
        rating: 4.5,
        mustSee: true,
        bookingRequired: false,
        openingHours: { open: '09:00', close: '18:00' },
        dataReliability: 'generated' as const,
      });
    }

    return dayAttractions;
  });
}
