export type CatalogCategory = 'attraction' | 'restaurant' | 'bar' | 'breakfast';

export interface CatalogEntry {
  alias: string;
  placeId: string;
  name: string;
  coords: { lat: number; lng: number };
  address?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: 0 | 1 | 2 | 3 | 4;
  openingHours?: { open: string; close: string };
  openingHoursByDay?: Record<string, { open: string; close: string } | null>;
  photoUrl?: string;
  photos?: string[];
  website?: string;
  googleMapsUrl?: string;
  category: CatalogCategory;
  subtype?: string;
  cuisines?: string[];
  mealSuitable?: Array<'breakfast' | 'lunch' | 'dinner'>;
}

export interface CityCatalog {
  city: string;
  coords: { lat: number; lng: number };
  fetchedAt: number;
  attractions: CatalogEntry[];
  restaurants: CatalogEntry[];
  breakfast: CatalogEntry[];
  bars: CatalogEntry[];
}

export type Catalog = Record<string /* normalized city slug */, CityCatalog>;

export interface CatalogLookupMap {
  byAlias: Map<string, CatalogEntry>;
  byPlaceId: Map<string, CatalogEntry>;
}

export function normalizeCitySlug(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCatalogLookup(catalog: Catalog): CatalogLookupMap {
  const byAlias = new Map<string, CatalogEntry>();
  const byPlaceId = new Map<string, CatalogEntry>();
  for (const city of Object.values(catalog)) {
    const all = [
      ...city.attractions,
      ...city.restaurants,
      ...city.breakfast,
      ...city.bars,
    ];
    for (const entry of all) {
      byAlias.set(entry.alias, entry);
      if (entry.placeId) byPlaceId.set(entry.placeId, entry);
    }
  }
  return { byAlias, byPlaceId };
}

export function iterCatalogEntries(catalog: Catalog): CatalogEntry[] {
  return Object.values(catalog).flatMap((city) => [
    ...city.attractions,
    ...city.restaurants,
    ...city.breakfast,
    ...city.bars,
  ]);
}
