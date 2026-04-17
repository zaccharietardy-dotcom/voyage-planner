import type { TransportHub } from '@/lib/pipeline/types/transport-plan';
import { textSearchPlaces, nearbySearchPlaces, isGooglePlacesNewConfigured } from './googlePlacesNew';

/**
 * Fallback Level 2 — cherche l'aéroport international le plus proche d'une ville
 * via Google Places API. Utilisé quand la ville n'est pas dans `european-hubs.ts`.
 *
 * Stratégie :
 *  1. Text search : "international airport near <city>"
 *  2. Si rien : nearby search avec type `airport` sur les coords city (rayon 80 km)
 *  3. Extrait le code IATA depuis le `displayName` (regex `\((\w{3})\)`)
 *
 * Retourne null si rien trouvé ou si la clé Google n'est pas configurée
 * (le caller doit alors fallback sur mode heuristique).
 */
export async function findNearestAirport(
  cityName: string,
  cityCoords?: { lat: number; lng: number },
): Promise<TransportHub | null> {
  if (!isGooglePlacesNewConfigured()) return null;

  try {
    const query = `international airport near ${cityName}`;
    const results = await textSearchPlaces(query, {
      languageCode: 'en',
      maxResultCount: 3,
      ...(cityCoords ? { locationBias: { lat: cityCoords.lat, lng: cityCoords.lng, radiusMeters: 80000 } } : {}),
      includedType: 'airport',
    });

    if (results.length > 0) {
      const hub = extractAirportHub(results[0], cityName);
      if (hub) return hub;
    }
  } catch {
    /* fall through */
  }

  if (cityCoords) {
    try {
      const nearby = await nearbySearchPlaces(cityCoords, {
        radiusMeters: 80000,
        includedTypes: ['airport'],
        languageCode: 'en',
        maxResultCount: 5,
      });

      const best = nearby
        .map(p => extractAirportHub(p, cityName))
        .filter((h): h is TransportHub => h !== null)
        .sort((a, b) => {
          // Préférer les aéroports avec code IATA reconnaissable (3 lettres majuscules)
          const aHasCode = !!(a.code && /^[A-Z]{3}$/.test(a.code));
          const bHasCode = !!(b.code && /^[A-Z]{3}$/.test(b.code));
          if (aHasCode && !bHasCode) return -1;
          if (!aHasCode && bHasCode) return 1;
          return 0;
        })[0];

      return best || null;
    } catch {
      /* fall through */
    }
  }

  return null;
}

interface MinimalPlace {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}

function extractAirportHub(place: MinimalPlace, fallbackCity: string): TransportHub | null {
  const name = place.displayName?.text?.trim();
  const location = place.location;
  if (!name || !location) return null;

  const iataMatch = name.match(/\(([A-Z]{3})\)/) || (place.formattedAddress || '').match(/\(([A-Z]{3})\)/);
  const code = iataMatch ? iataMatch[1] : undefined;

  return {
    name: name.replace(/\s*\([A-Z]{3}\)\s*$/, '').trim(),
    code,
    kind: 'airport',
    lat: location.latitude,
    lng: location.longitude,
    city: fallbackCity,
  };
}
