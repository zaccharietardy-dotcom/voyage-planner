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
import type { Catalog, CatalogEntry } from './catalog-types';
import { buildCatalogLookup } from './catalog-types';
import { runValidationTasks, type ValidationTask } from '../pipeline/utils/validation-orchestrator';
import { geocodeAddress, calculateDistance } from '../services/geocoding';
import { getDirections } from '../services/directions';
import { searchRestaurantsNearbyWithFallback } from '../services/serpApiPlaces';
import { trackApiCost } from '../services/apiCostGuard';

interface FlattenedItemRef {
  dayNumber: number;
  hub: string;
  itemIndex: number;
  item: LLMTripDesign['days'][number]['items'][number];
}

interface FlattenedDriveRef {
  dayNumber: number;
  driveIndex: number;
  drive: LLMTripDesign['days'][number]['drives'][number];
}

export interface ValidationChunkState {
  phase: 'items' | 'drives' | 'done';
  itemCursor: number;
  driveCursor: number;
  totalItems: number;
  totalDrives: number;
  hubCoords: Record<string, { lat: number; lng: number }>;
  items: ValidatedItem[];
  drives: ValidatedDrive[];
  catalogMode?: boolean;
}

export interface ValidationChunkResult {
  state: ValidationChunkState;
  done: boolean;
  latencyMs: number;
  processedItems: number;
  processedDrives: number;
}

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

function flattenItems(design: LLMTripDesign): FlattenedItemRef[] {
  const refs: FlattenedItemRef[] = [];
  for (const day of design.days) {
    for (let i = 0; i < day.items.length; i += 1) {
      refs.push({
        dayNumber: day.day,
        hub: day.hub,
        itemIndex: i,
        item: day.items[i],
      });
    }
  }
  return refs;
}

function flattenDrives(design: LLMTripDesign): FlattenedDriveRef[] {
  const refs: FlattenedDriveRef[] = [];
  for (const day of design.days) {
    for (let i = 0; i < day.drives.length; i += 1) {
      refs.push({
        dayNumber: day.day,
        driveIndex: i,
        drive: day.drives[i],
      });
    }
  }
  return refs;
}

function hubCoordsToMap(state: ValidationChunkState): Map<string, { lat: number; lng: number }> {
  return new Map(Object.entries(state.hubCoords || {}));
}

async function resolveHubCoords(
  design: LLMTripDesign,
  onProgress?: (label: string) => void,
): Promise<Record<string, { lat: number; lng: number }>> {
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

  const coords: Record<string, { lat: number; lng: number }> = {};
  for (const [key, settled] of hubResults.settledByKey) {
    if (settled.status === 'fulfilled' && settled.value) {
      coords[key.replace('hub:', '')] = settled.value;
    }
  }
  return coords;
}

function catalogEntryToValidatedItem(
  itemRef: FlattenedItemRef,
  entry: CatalogEntry,
): ValidatedItem {
  const { item, dayNumber } = itemRef;
  return {
    original: item,
    dayNumber,
    validated: true,
    coords: entry.coords,
    rating: entry.rating,
    reviewCount: entry.userRatingCount,
    photos: entry.photos,
    openingHours: entry.openingHours,
    openingHoursByDay: entry.openingHoursByDay,
    website: entry.website,
    priceLevel: entry.priceLevel,
    googlePlaceId: entry.placeId,
    googleMapsUrl: entry.googleMapsUrl,
    source: 'catalog',
  };
}

async function validateItemRef(
  itemRef: FlattenedItemRef,
  nearCoords: { lat: number; lng: number },
  catalogLookup?: ReturnType<typeof buildCatalogLookup>,
): Promise<ValidatedItem> {
  const { item, dayNumber, hub } = itemRef;

  // Catalog mode: if the LLM chose a catalog alias, resolve without hitting Places.
  if (catalogLookup && item.catalogAlias) {
    const entry = catalogLookup.byAlias.get(item.catalogAlias);
    if (entry) {
      return catalogEntryToValidatedItem(itemRef, entry);
    }
    // Alias unknown — LLM cheated. Drop gracefully by falling back below.
    console.warn(`[V4 Validate] Unknown catalog alias "${item.catalogAlias}" for item "${item.name}"`);
  }

  const query = item.address
    ? `${item.name} ${item.address}`
    : `${item.name} ${hub}`;

  const place = await searchPlaceByText(query, nearCoords);

  if (place) {
    const dist = calculateDistance(place.lat, place.lng, nearCoords.lat, nearCoords.lng);
    if (dist < 50) {
      return {
        original: item,
        dayNumber,
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

  const geo = await geocodeFallback(item.name, hub);
  if (geo) {
    return {
      original: item,
      dayNumber,
      validated: true,
      coords: geo,
      source: 'nominatim',
    };
  }

  if (item.type === 'restaurant' || item.type === 'bar') {
    try {
      const nearby = await searchRestaurantsNearbyWithFallback(
        nearCoords,
        hub,
        { mealType: item.mealType, maxDistance: 2, limit: 1 },
      );
      if (nearby.length > 0) {
        const replacement = nearby[0];
        return {
          original: item,
          dayNumber,
          validated: true,
          coords: { lat: replacement.latitude, lng: replacement.longitude },
          rating: replacement.rating,
          reviewCount: replacement.reviewCount,
          source: 'fallback_replacement',
          replacedWith: replacement.name,
          restaurant: replacement,
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    original: item,
    dayNumber,
    validated: false,
    coords: nearCoords,
    source: 'unverified',
  };
}

async function validateDriveRef(
  driveRef: FlattenedDriveRef,
  design: LLMTripDesign,
  hubCoords: Map<string, { lat: number; lng: number }>,
  validatedItems: ValidatedItem[],
): Promise<ValidatedDrive> {
  const { drive, dayNumber } = driveRef;
  const fromCoords = hubCoords.get(drive.from)
    || validatedItems.find(i => i.dayNumber === dayNumber)?.coords
    || { lat: 48.85, lng: 2.35 };

  let toCoords = hubCoords.get(drive.to);
  if (!toCoords) {
    const nextDay = design.days.find(d => d.day === dayNumber + 1);
    toCoords = nextDay ? hubCoords.get(nextDay.hub) : undefined;
  }
  if (!toCoords) {
    toCoords = { lat: fromCoords.lat + 0.5, lng: fromCoords.lng + 0.5 };
  }

  try {
    const directions = await getDirections({
      from: fromCoords,
      to: toCoords,
      mode: 'driving',
    });
    return {
      original: drive,
      dayNumber,
      fromCoords,
      toCoords,
      realDurationMin: Math.round(directions.duration),
      realDistanceKm: Math.round(directions.distance * 10) / 10,
      polyline: directions.overviewPolyline,
      googleMapsUrl: directions.googleMapsUrl,
    };
  } catch {
    return {
      original: drive,
      dayNumber,
      fromCoords,
      toCoords,
      realDurationMin: drive.durationMin,
      realDistanceKm: drive.distanceKm,
    };
  }
}

export async function initializeValidationChunkState(
  design: LLMTripDesign,
  onProgress?: (label: string) => void,
  catalog?: Catalog,
): Promise<ValidationChunkState> {
  const hubCoords = await resolveHubCoords(design, onProgress);
  const items = flattenItems(design);
  const drives = flattenDrives(design);

  return {
    phase: items.length > 0 ? 'items' : (drives.length > 0 ? 'drives' : 'done'),
    itemCursor: 0,
    driveCursor: 0,
    totalItems: items.length,
    totalDrives: drives.length,
    hubCoords,
    items: [],
    drives: [],
    catalogMode: !!(catalog && Object.keys(catalog).length > 0),
  };
}

export async function runValidationChunk(
  design: LLMTripDesign,
  prevState: ValidationChunkState,
  options?: {
    itemBatchSize?: number;
    driveBatchSize?: number;
    catalog?: Catalog;
  },
): Promise<ValidationChunkResult> {
  const startedAt = Date.now();
  const itemBatchSize = Math.max(1, options?.itemBatchSize ?? 18);
  const driveBatchSize = Math.max(1, options?.driveBatchSize ?? 12);
  const catalogLookup = options?.catalog ? buildCatalogLookup(options.catalog) : undefined;
  const flattenedItems = flattenItems(design);
  const flattenedDrives = flattenDrives(design);
  const hubCoords = hubCoordsToMap(prevState);
  const nextState: ValidationChunkState = {
    ...prevState,
    items: [...(prevState.items || [])],
    drives: [...(prevState.drives || [])],
  };
  let processedItems = 0;
  let processedDrives = 0;

  if (nextState.phase === 'items') {
    const start = nextState.itemCursor;
    const end = Math.min(flattenedItems.length, start + itemBatchSize);
    const slice = flattenedItems.slice(start, end);
    const tasks: ValidationTask<ValidatedItem>[] = slice.map((ref, idx) => ({
      key: `item:${ref.dayNumber}:${start + idx}:${ref.item.name.slice(0, 40)}`,
      provider:
        catalogLookup && ref.item.catalogAlias && catalogLookup.byAlias.has(ref.item.catalogAlias)
          ? 'local'
          : (ref.item.type === 'restaurant' || ref.item.type === 'bar' ? 'serpapi' : 'google_places'),
      run: async () => {
        const nearCoords = hubCoords.get(ref.hub) || { lat: 48.85, lng: 2.35 };
        return validateItemRef(ref, nearCoords, catalogLookup);
      },
    }));

    const itemResults = await runValidationTasks(tasks, {
      defaultConcurrency: 6,
      providerConcurrency: { google_places: 4, serpapi: 3, nominatim: 2 },
      maxRetries: 1,
      hardCapMs: 30_000,
    });

    for (const [, settled] of itemResults.settledByKey) {
      if (settled.status === 'fulfilled') {
        nextState.items.push(settled.value);
      }
    }

    nextState.itemCursor = end;
    processedItems = slice.length;
    if (nextState.itemCursor >= flattenedItems.length) {
      nextState.phase = flattenedDrives.length > 0 ? 'drives' : 'done';
    }
  } else if (nextState.phase === 'drives') {
    const start = nextState.driveCursor;
    const end = Math.min(flattenedDrives.length, start + driveBatchSize);
    const slice = flattenedDrives.slice(start, end);
    const tasks: ValidationTask<ValidatedDrive>[] = slice.map((ref, idx) => ({
      key: `drive:${ref.dayNumber}:${start + idx}:${ref.drive.from}-${ref.drive.to}`,
      provider: 'osrm',
      run: async () => validateDriveRef(ref, design, hubCoords, nextState.items),
    }));

    const driveResults = await runValidationTasks(tasks, {
      defaultConcurrency: 6,
      maxRetries: 0,
      hardCapMs: 25_000,
    });

    for (const [, settled] of driveResults.settledByKey) {
      if (settled.status === 'fulfilled') {
        nextState.drives.push(settled.value);
      }
    }

    nextState.driveCursor = end;
    processedDrives = slice.length;
    if (nextState.driveCursor >= flattenedDrives.length) {
      nextState.phase = 'done';
    }
  }

  return {
    state: nextState,
    done: nextState.phase === 'done',
    latencyMs: Date.now() - startedAt,
    processedItems,
    processedDrives,
  };
}

// ---------------------------------------------------------------------------
// Validate all items in parallel
// ---------------------------------------------------------------------------

export async function validateItems(
  design: LLMTripDesign,
  onProgress?: (label: string) => void,
  catalog?: Catalog,
): Promise<{ items: ValidatedItem[]; drives: ValidatedDrive[]; latencyMs: number }> {
  const t0 = Date.now();
  let state = await initializeValidationChunkState(design, onProgress, catalog);
  while (state.phase !== 'done') {
    const result = await runValidationChunk(design, state, {
      itemBatchSize: 24,
      driveBatchSize: 16,
      catalog,
    });
    state = result.state;
  }

  return {
    items: state.items,
    drives: state.drives,
    latencyMs: Date.now() - t0,
  };
}
