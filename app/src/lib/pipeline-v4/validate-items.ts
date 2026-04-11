/**
 * Pipeline V4 — Step 2: Validate LLM items against real APIs
 *
 * Each item from the LLM gets validated:
 * - Activities → Google Places text search → real coords, photos, hours
 * - Restaurants → Google Places → real data + SerpAPI fallback
 * - Drives → OSRM → real duration + polyline
 */

import type { LLMTripDesign, ValidatedItem, ValidatedDrive, ValidationSource } from './types';
import type { Restaurant } from '../types';
import { runValidationTasks, type ValidationTask } from '../pipeline/utils/validation-orchestrator';
import { geocodeAddress, calculateDistance } from '../services/geocoding';
import { getDirections } from '../services/directions';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { trackApiCost } from '../services/apiCostGuard';

// ---------------------------------------------------------------------------
// Google Places text search (lightweight — just coords + basic info)
// ---------------------------------------------------------------------------

async function searchPlaceByText(
  query: string,
  nearCoords: { lat: number; lng: number },
): Promise<{
  lat: number;
  lng: number;
  rating?: number;
  reviewCount?: number;
  photos?: string[];
  openingHours?: { open: string; close: string };
  openingHoursByDay?: Record<string, { open: string; close: string } | null>;
  website?: string;
  priceLevel?: number;
  googlePlaceId?: string;
  googleMapsUrl?: string;
} | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    trackApiCost('places-text-search');
    const response = await fetch(
      `https://places.googleapis.com/v1/places:searchText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.photos,places.regularOpeningHours,places.websiteUri,places.priceLevel,places.googleMapsUri',
        },
        body: JSON.stringify({
          textQuery: query,
          locationBias: {
            circle: {
              center: { latitude: nearCoords.lat, longitude: nearCoords.lng },
              radius: 30000, // 30km
            },
          },
          maxResultCount: 1,
          languageCode: 'fr',
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) return null;
    const data = await response.json();
    const place = data.places?.[0];
    if (!place?.location) return null;

    // Parse opening hours
    let openingHours: { open: string; close: string } | undefined;
    let openingHoursByDay: Record<string, { open: string; close: string } | null> | undefined;
    if (place.regularOpeningHours?.periods) {
      const periods = place.regularOpeningHours.periods;
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      openingHoursByDay = {};
      for (const period of periods) {
        const dayName = dayNames[period.open?.day ?? 0];
        const open = `${String(period.open?.hour ?? 9).padStart(2, '0')}:${String(period.open?.minute ?? 0).padStart(2, '0')}`;
        const close = period.close
          ? `${String(period.close.hour ?? 23).padStart(2, '0')}:${String(period.close.minute ?? 0).padStart(2, '0')}`
          : '23:59';
        openingHoursByDay[dayName] = { open, close };
      }
      // Simple open/close from first period
      const first = periods[0];
      if (first?.open) {
        openingHours = {
          open: `${String(first.open.hour ?? 9).padStart(2, '0')}:${String(first.open.minute ?? 0).padStart(2, '0')}`,
          close: first.close
            ? `${String(first.close.hour ?? 23).padStart(2, '0')}:${String(first.close.minute ?? 0).padStart(2, '0')}`
            : '23:59',
        };
      }
    }

    // Photos
    const photos = (place.photos || [])
      .slice(0, 5)
      .map((p: { name: string }) =>
        `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${apiKey}`
      );

    // Price level mapping
    const priceLevelMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };

    return {
      lat: place.location.latitude,
      lng: place.location.longitude,
      rating: place.rating,
      reviewCount: place.userRatingCount,
      photos: photos.length > 0 ? photos : undefined,
      openingHours,
      openingHoursByDay,
      website: place.websiteUri,
      priceLevel: priceLevelMap[place.priceLevel] ?? undefined,
      googlePlaceId: place.id,
      googleMapsUrl: place.googleMapsUri,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Nominatim fallback
// ---------------------------------------------------------------------------

async function geocodeFallback(
  name: string,
  city: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const result = await geocodeAddress(`${name}, ${city}`);
    if (result?.lat && result?.lng) {
      return { lat: result.lat, lng: result.lng };
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Validate all items in parallel
// ---------------------------------------------------------------------------

export async function validateItems(
  design: LLMTripDesign,
  onProgress?: (label: string) => void,
): Promise<{ items: ValidatedItem[]; drives: ValidatedDrive[]; latencyMs: number }> {
  const t0 = Date.now();

  // First: resolve hub coords (needed for location bias)
  const hubCoords = new Map<string, { lat: number; lng: number }>();
  const hubGeoTasks: ValidationTask<{ lat: number; lng: number } | null>[] = [];
  const hubCities = [...new Set(design.days.map(d => d.hub))];

  for (const city of hubCities) {
    hubGeoTasks.push({
      key: `hub:${city}`,
      provider: 'nominatim',
      run: () => geocodeAddress(city).then(r => r ? { lat: r.lat, lng: r.lng } : null),
    });
  }

  onProgress?.('Resolving hub coordinates...');
  const hubResults = await runValidationTasks(hubGeoTasks, {
    defaultConcurrency: 3,
    maxRetries: 1,
  });

  for (const [key, settled] of hubResults.settledByKey) {
    if (settled.status === 'fulfilled' && settled.value) {
      hubCoords.set(key.replace('hub:', ''), settled.value);
    }
  }

  // Validate each item
  const itemTasks: ValidationTask<ValidatedItem>[] = [];

  for (const day of design.days) {
    const nearCoords = hubCoords.get(day.hub) || { lat: 48.85, lng: 2.35 }; // Paris fallback

    for (const item of day.items) {
      const taskKey = `item:d${day.day}:${item.name.slice(0, 40)}`;

      itemTasks.push({
        key: taskKey,
        provider: item.type === 'restaurant' || item.type === 'bar' ? 'serpapi' : 'google_places',
        run: async (): Promise<ValidatedItem> => {
          // Try Google Places text search
          const query = item.address
            ? `${item.name} ${item.address}`
            : `${item.name} ${day.hub}`;

          const place = await searchPlaceByText(query, nearCoords);

          if (place) {
            // Verify it's reasonably close to the hub (< 50km)
            const dist = calculateDistance(place.lat, place.lng, nearCoords.lat, nearCoords.lng);
            if (dist < 50) {
              return {
                original: item,
                dayNumber: day.day,
                validated: true,
                coords: { lat: place.lat, lng: place.lng },
                rating: place.rating,
                reviewCount: place.reviewCount,
                photos: place.photos,
                openingHours: place.openingHours,
                openingHoursByDay: place.openingHoursByDay,
                website: place.website,
                priceLevel: place.priceLevel,
                googlePlaceId: place.googlePlaceId,
                googleMapsUrl: place.googleMapsUrl,
                source: 'google_places',
              };
            }
          }

          // Fallback: Nominatim geocoding
          const geo = await geocodeFallback(item.name, day.hub);
          if (geo) {
            return {
              original: item,
              dayNumber: day.day,
              validated: true,
              coords: geo,
              source: 'nominatim',
            };
          }

          // For restaurants: try SerpAPI nearby search as replacement
          if (item.type === 'restaurant' || item.type === 'bar') {
            try {
              const nearby = await searchRestaurantsNearbyWithFallback(
                nearCoords,
                day.hub,
                { mealType: item.mealType, maxDistance: 2, limit: 1 },
              );
              if (nearby.length > 0) {
                const replacement = nearby[0];
                return {
                  original: item,
                  dayNumber: day.day,
                  validated: true,
                  coords: { lat: replacement.latitude, lng: replacement.longitude },
                  rating: replacement.rating,
                  reviewCount: replacement.reviewCount,
                  source: 'fallback_replacement',
                  replacedWith: replacement.name,
                  restaurant: replacement,
                };
              }
            } catch { /* ignore */ }
          }

          // Last resort: unverified with hub coords
          return {
            original: item,
            dayNumber: day.day,
            validated: false,
            coords: nearCoords,
            source: 'unverified',
          };
        },
      });
    }
  }

  onProgress?.(`Validating ${itemTasks.length} items...`);
  const itemResults = await runValidationTasks(itemTasks, {
    defaultConcurrency: 6,
    providerConcurrency: { google_places: 4, serpapi: 3, nominatim: 2 },
    maxRetries: 1,
    hardCapMs: 60000, // 60s max for all validations
  });

  const validatedItems: ValidatedItem[] = [];
  for (const [, settled] of itemResults.settledByKey) {
    if (settled.status === 'fulfilled') {
      validatedItems.push(settled.value);
    }
  }

  // Validate drives via OSRM
  const driveTasks: ValidationTask<ValidatedDrive>[] = [];

  for (const day of design.days) {
    for (const drive of day.drives) {
      const fromCoords = hubCoords.get(drive.from)
        || validatedItems.find(i => i.dayNumber === day.day)?.coords
        || { lat: 48.85, lng: 2.35 };

      // Try to find destination coords
      let toCoords = hubCoords.get(drive.to);
      if (!toCoords) {
        // Look in next day's hub or in items
        const nextDay = design.days.find(d => d.day === day.day + 1);
        toCoords = nextDay ? hubCoords.get(nextDay.hub) : undefined;
      }
      if (!toCoords) {
        toCoords = { lat: fromCoords.lat + 0.5, lng: fromCoords.lng + 0.5 }; // rough estimate
      }

      driveTasks.push({
        key: `drive:d${day.day}:${drive.from}-${drive.to}`,
        provider: 'osrm',
        run: async (): Promise<ValidatedDrive> => {
          try {
            const directions = await getDirections({
              from: fromCoords,
              to: toCoords!,
              mode: 'driving',
            });
            return {
              original: drive,
              dayNumber: day.day,
              fromCoords,
              toCoords: toCoords!,
              realDurationMin: Math.round(directions.duration),
              realDistanceKm: Math.round(directions.distance * 10) / 10,
              polyline: directions.overviewPolyline,
              googleMapsUrl: directions.googleMapsUrl,
            };
          } catch {
            // Fallback: use LLM estimates
            return {
              original: drive,
              dayNumber: day.day,
              fromCoords,
              toCoords: toCoords!,
              realDurationMin: drive.durationMin,
              realDistanceKm: drive.distanceKm,
            };
          }
        },
      });
    }
  }

  onProgress?.(`Validating ${driveTasks.length} drives...`);
  const driveResults = await runValidationTasks(driveTasks, {
    defaultConcurrency: 6,
    maxRetries: 0,
    hardCapMs: 30000,
  });

  const validatedDrives: ValidatedDrive[] = [];
  for (const [, settled] of driveResults.settledByKey) {
    if (settled.status === 'fulfilled') {
      validatedDrives.push(settled.value);
    }
  }

  return {
    items: validatedItems,
    drives: validatedDrives,
    latencyMs: Date.now() - t0,
  };
}
