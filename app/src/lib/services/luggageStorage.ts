/**
 * Service de recherche de consignes a bagages
 *
 * Utilise Claude pour trouver des consignes REELLES dans une ville:
 * - Gares (SNCF, etc.)
 * - Aeroports
 * - Services specialises (LuggageHero, Bounce, Nannybag)
 * - Centres commerciaux
 *
 * IMPORTANT: Voir /IMPORTANT_RULES.md - Regle 2
 * Si l'arrivee est avant le check-in hotel (14h), proposer une consigne.
 */

import Anthropic from '@anthropic-ai/sdk';
import { tokenTracker } from './tokenTracker';
import * as fs from 'fs';
import * as path from 'path';

const anthropic = new Anthropic();

export interface LuggageStorage {
  id: string;
  name: string;
  type: 'station' | 'airport' | 'service' | 'mall' | 'hotel';
  address: string;
  latitude: number;
  longitude: number;
  pricePerDay: number; // EUR
  pricePerHour?: number; // EUR (si disponible)
  currency: string;
  openingHours: {
    open: string; // HH:mm
    close: string; // HH:mm
  };
  bookingUrl?: string;
  phone?: string;
  notes?: string; // Ex: "Reservation en ligne recommandee"
}

interface LuggageCache {
  [key: string]: {
    storages: LuggageStorage[];
    fetchedAt: string;
    version: number;
  };
}

// Cache des consignes (30 jours)
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const CACHE_PATH = path.join(process.cwd(), 'data', 'luggage-cache', 'storages.json');

/**
 * Charge le cache depuis le fichier
 */
function loadCache(): LuggageCache {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch (error) {
    console.warn('[LuggageStorage] Erreur lecture cache:', error);
  }
  return {};
}

/**
 * Sauvegarde le cache dans le fichier
 */
function saveCache(cache: LuggageCache): void {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('[LuggageStorage] Erreur sauvegarde cache:', error);
  }
}

/**
 * Recherche des consignes a bagages dans une ville
 */
export async function searchLuggageStorage(
  city: string,
  nearLocation?: { latitude: number; longitude: number }
): Promise<LuggageStorage[]> {
  const cacheKey = city.toLowerCase().trim();
  const cache = loadCache();

  // Verifier le cache
  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < CACHE_TTL) {
      console.log(`[LuggageStorage] Cache hit pour ${city}`);
      return cached.storages;
    }
  }

  // Recherche via Claude
  console.log(`[LuggageStorage] Recherche consignes a ${city}...`);

  const prompt = `Tu es un assistant de voyage. Trouve 5-8 VRAIES consignes a bagages a ${city}.

Inclus:
1. Consignes dans les gares principales (SNCF, Renfe, etc.)
2. Consignes dans les aeroports
3. Services de consignes (LuggageHero, Bounce, Nannybag, Stasher)
4. Eventuellement centres commerciaux ou hotels

Pour chaque consigne, fournis des informations REELLES:
- Nom exact du lieu
- Adresse complete
- Prix par jour (en EUR)
- Horaires d'ouverture
- Lien de reservation si disponible

Reponds UNIQUEMENT avec un JSON valide:
{
  "storages": [
    {
      "name": "Consigne SNCF Gare de Lyon",
      "type": "station",
      "address": "Gare de Lyon, Place Louis Armand, 75012 Paris",
      "latitude": 48.8448,
      "longitude": 2.3735,
      "pricePerDay": 10,
      "pricePerHour": 5,
      "openingHours": { "open": "06:00", "close": "22:00" },
      "bookingUrl": "https://www.sncf.com/fr/gares-services/consignes",
      "notes": "Reservation en ligne possible"
    }
  ]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Tracker les tokens
    if (response.usage) {
      tokenTracker.track(response.usage, `LuggageStorage: ${city}`);
    }

    const content = response.content[0];
    if (content.type !== 'text') {
      return getDefaultStorages(city);
    }

    // Parser le JSON
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LuggageStorage] Pas de JSON dans la reponse');
      return getDefaultStorages(city);
    }

    const data = JSON.parse(jsonMatch[0]);
    const storages: LuggageStorage[] = (data.storages || []).map((s: any, index: number) => ({
      id: `luggage-${cacheKey}-${index}`,
      name: s.name || 'Consigne',
      type: s.type || 'service',
      address: s.address || city,
      latitude: s.latitude || 0,
      longitude: s.longitude || 0,
      pricePerDay: s.pricePerDay || 10,
      pricePerHour: s.pricePerHour,
      currency: 'EUR',
      openingHours: s.openingHours || { open: '08:00', close: '20:00' },
      bookingUrl: s.bookingUrl,
      phone: s.phone,
      notes: s.notes,
    }));

    // Sauvegarder dans le cache
    cache[cacheKey] = {
      storages,
      fetchedAt: new Date().toISOString(),
      version: 1,
    };
    saveCache(cache);

    console.log(`[LuggageStorage] ${storages.length} consignes trouvees pour ${city}`);
    return storages;
  } catch (error) {
    console.error('[LuggageStorage] Erreur recherche:', error);
    return getDefaultStorages(city);
  }
}

/**
 * Consignes par defaut si la recherche echoue
 */
function getDefaultStorages(city: string): LuggageStorage[] {
  // Consignes generiques basees sur des services connus
  return [
    {
      id: `luggage-${city}-1`,
      name: `LuggageHero ${city}`,
      type: 'service',
      address: `Centre-ville de ${city}`,
      latitude: 0,
      longitude: 0,
      pricePerDay: 8,
      pricePerHour: 1,
      currency: 'EUR',
      openingHours: { open: '08:00', close: '22:00' },
      bookingUrl: `https://luggagehero.com/${city.toLowerCase()}`,
      notes: 'Plusieurs points de depot en centre-ville',
    },
    {
      id: `luggage-${city}-2`,
      name: `Bounce ${city}`,
      type: 'service',
      address: `Centre-ville de ${city}`,
      latitude: 0,
      longitude: 0,
      pricePerDay: 7,
      pricePerHour: 1,
      currency: 'EUR',
      openingHours: { open: '00:00', close: '23:59' },
      bookingUrl: `https://usebounce.com/${city.toLowerCase()}`,
      notes: 'Service 24h dans certains points',
    },
    {
      id: `luggage-${city}-3`,
      name: `Nannybag ${city}`,
      type: 'service',
      address: `Centre-ville de ${city}`,
      latitude: 0,
      longitude: 0,
      pricePerDay: 6,
      currency: 'EUR',
      openingHours: { open: '09:00', close: '21:00' },
      bookingUrl: `https://www.nannybag.com/${city.toLowerCase()}`,
      notes: 'Depot chez des commercants locaux',
    },
  ];
}

/**
 * Selectionne la meilleure consigne pour un emplacement
 */
export function selectBestStorage(
  storages: LuggageStorage[],
  nearLocation?: { latitude: number; longitude: number },
  preferredTime?: { start: string; end: string }
): LuggageStorage | null {
  if (storages.length === 0) return null;

  // Scoring
  const scored = storages.map(storage => {
    let score = 0;

    // Prix (moins cher = mieux)
    score += Math.max(0, 20 - storage.pricePerDay);

    // Horaires larges
    const openTime = parseTime(storage.openingHours.open);
    const closeTime = parseTime(storage.openingHours.close);
    const hoursOpen = (closeTime - openTime) / 60;
    score += hoursOpen; // Plus d'heures = mieux

    // Bonus pour les services specialises (plus flexibles)
    if (storage.type === 'service') score += 5;

    // Bonus si lien de reservation
    if (storage.bookingUrl) score += 3;

    // Distance (si position fournie)
    if (nearLocation && storage.latitude && storage.longitude) {
      const distance = calculateDistance(
        nearLocation.latitude,
        nearLocation.longitude,
        storage.latitude,
        storage.longitude
      );
      // Moins de 2km = bonus
      if (distance < 2) score += 10 - distance * 5;
    }

    return { storage, score };
  });

  // Trier par score descendant
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.storage || null;
}

/**
 * Verifie si une consigne est necessaire
 */
export function needsLuggageStorage(
  arrivalTime: string, // HH:mm
  hotelCheckInTime: string // HH:mm
): boolean {
  const arrival = parseTime(arrivalTime);
  const checkIn = parseTime(hotelCheckInTime);

  // Si arrivee plus de 1h avant check-in, consigne necessaire
  return checkIn - arrival > 60;
}

/**
 * Calcule le temps de consigne necessaire
 */
export function calculateStorageDuration(
  arrivalTime: string,
  hotelCheckInTime: string
): number {
  const arrival = parseTime(arrivalTime);
  const checkIn = parseTime(hotelCheckInTime);

  // Duree en minutes, arrondi a l'heure superieure
  const minutes = checkIn - arrival;
  return Math.ceil(minutes / 60);
}

// ============================================
// HELPERS
// ============================================

function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
