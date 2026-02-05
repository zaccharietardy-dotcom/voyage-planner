/**
 * Service de gestion du cache des lieux vérifiés via Supabase PostgreSQL
 *
 * Ce service permet de:
 * - Chercher des lieux en base (restaurants, hôtels, attractions)
 * - Sauvegarder de nouvelles données vérifiées
 * - Vérifier la fraîcheur des données (cache 30 jours)
 * - Mettre à jour les données existantes
 *
 * Utilise Supabase (PostgreSQL) au lieu de Prisma/SQLite pour
 * fonctionner sur Vercel serverless.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Types
export type PlaceType = 'restaurant' | 'hotel' | 'attraction';
export type DataReliability = 'verified' | 'estimated' | 'generated';
export type DataSource = 'serpapi' | 'foursquare' | 'osm' | 'claude' | 'tripadvisor' | 'gemini';

export interface PlaceData {
  externalId?: string;
  type: PlaceType;
  name: string;
  city: string;
  country?: string;
  address: string;
  latitude: number;
  longitude: number;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  stars?: number;
  cuisineTypes?: string[];
  amenities?: string[];
  categories?: string[];
  openingHours?: Record<string, { open: string; close: string } | null>;
  phone?: string;
  website?: string;
  googleMapsUrl: string;
  bookingUrl?: string;
  description?: string;
  tips?: string;
  source: DataSource;
  dataReliability: DataReliability;
}

export interface PlaceSearchOptions {
  city: string;
  type: PlaceType;
  maxAgeDays?: number; // Par défaut 30 jours
  limit?: number;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
  budgetLevel?: 'economic' | 'moderate' | 'luxury';
  cuisineType?: string;
  minRating?: number;
}

// Durée de cache par défaut (30 jours)
const DEFAULT_CACHE_DAYS = 30;

// ============================================
// Supabase Admin Client (service role)
// ============================================

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.warn('[PlaceDB] Supabase non configuré — cache désactivé');
    return null;
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ============================================
// Helpers
// ============================================

/**
 * Génère un hash pour une requête de recherche (pour le cache)
 */
function hashQuery(params: Record<string, unknown>): string {
  const sortedParams = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha256').update(sortedParams).digest('hex');
}

// DB row → PlaceData (snake_case → camelCase)
interface DBPlace {
  id: string;
  external_id: string | null;
  type: string;
  name: string;
  city: string;
  country: string | null;
  address: string;
  latitude: number;
  longitude: number;
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  stars: number | null;
  cuisine_types: string[] | null;
  amenities: string[] | null;
  categories: string[] | null;
  opening_hours: Record<string, { open: string; close: string } | null> | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string;
  booking_url: string | null;
  description: string | null;
  tips: string | null;
  source: string;
  data_reliability: string;
}

function dbPlaceToPlaceData(row: DBPlace): PlaceData {
  return {
    externalId: row.external_id || undefined,
    type: row.type as PlaceType,
    name: row.name,
    city: row.city,
    country: row.country || undefined,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    rating: row.rating || undefined,
    reviewCount: row.review_count || undefined,
    priceLevel: row.price_level || undefined,
    stars: row.stars || undefined,
    cuisineTypes: row.cuisine_types || undefined,
    amenities: row.amenities || undefined,
    categories: row.categories || undefined,
    openingHours: row.opening_hours || undefined,
    phone: row.phone || undefined,
    website: row.website || undefined,
    googleMapsUrl: row.google_maps_url,
    bookingUrl: row.booking_url || undefined,
    description: row.description || undefined,
    tips: row.tips || undefined,
    source: row.source as DataSource,
    dataReliability: row.data_reliability as DataReliability,
  };
}

// PlaceData → DB row (camelCase → snake_case)
function placeDataToDBRow(place: PlaceData, source: DataSource) {
  return {
    external_id: place.externalId || null,
    type: place.type,
    name: place.name,
    city: place.city,
    country: place.country || null,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    rating: place.rating ?? null,
    review_count: place.reviewCount ?? null,
    price_level: place.priceLevel ?? null,
    stars: place.stars ?? null,
    cuisine_types: place.cuisineTypes || null,
    amenities: place.amenities || null,
    categories: place.categories || null,
    opening_hours: place.openingHours || null,
    phone: place.phone || null,
    website: place.website || null,
    google_maps_url: place.googleMapsUrl,
    booking_url: place.bookingUrl || null,
    description: place.description || null,
    tips: place.tips || null,
    source,
    data_reliability: place.dataReliability,
    verified_at: new Date().toISOString(),
  };
}

// ============================================
// Public API
// ============================================

/**
 * Vérifie si les données pour une ville et un type sont fraîches
 */
export async function isDataFresh(
  city: string,
  type: PlaceType,
  maxAgeDays: number = DEFAULT_CACHE_DAYS
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const { count, error } = await supabase
      .from('places')
      .select('id', { count: 'exact', head: true })
      .ilike('city', `%${city}%`)
      .eq('type', type)
      .gte('verified_at', cutoffDate.toISOString());

    if (error) throw error;
    return (count ?? 0) >= 5;
  } catch (error) {
    console.warn('[PlaceDB] Erreur isDataFresh:', error);
    return false;
  }
}

/**
 * Recherche des lieux dans la base de données
 */
export async function searchPlacesFromDB(
  options: PlaceSearchOptions
): Promise<PlaceData[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  try {
    const {
      city,
      type,
      maxAgeDays = DEFAULT_CACHE_DAYS,
      limit = 10,
      minRating,
    } = options;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    let query = supabase
      .from('places')
      .select('*')
      .ilike('city', `%${city}%`)
      .eq('type', type)
      .gte('verified_at', cutoffDate.toISOString())
      .order('data_reliability', { ascending: true })
      .order('rating', { ascending: false, nullsFirst: false })
      .order('verified_at', { ascending: false })
      .limit(limit);

    if (minRating !== undefined) {
      query = query.gte('rating', minRating);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []).map((row: DBPlace) => dbPlaceToPlaceData(row));
  } catch (error) {
    console.warn('[PlaceDB] Erreur searchPlacesFromDB:', error);
    return [];
  }
}

/**
 * Recherche un lieu par son ID externe et sa source
 */
export async function getPlaceByExternalId(
  externalId: string,
  source: DataSource
): Promise<PlaceData | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('places')
      .select('*')
      .eq('external_id', externalId)
      .eq('source', source)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return data ? dbPlaceToPlaceData(data as DBPlace) : null;
  } catch (error) {
    console.warn('[PlaceDB] Erreur getPlaceByExternalId:', error);
    return null;
  }
}

/**
 * Sauvegarde une liste de lieux dans la base de données
 * Met à jour si le lieu existe déjà (upsert par external_id + source)
 */
export async function savePlacesToDB(
  places: PlaceData[],
  source: DataSource
): Promise<number> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;

  let savedCount = 0;

  // Séparer les places avec et sans external_id
  const placesWithExternalId = places.filter(p => p.externalId);
  const placesWithoutExternalId = places.filter(p => !p.externalId);

  // Batch upsert pour ceux avec external_id
  if (placesWithExternalId.length > 0) {
    try {
      const rows = placesWithExternalId.map(p => placeDataToDBRow(p, source));
      const { error } = await supabase
        .from('places')
        .upsert(rows, {
          onConflict: 'external_id,source',
          ignoreDuplicates: false,
        });

      if (error) throw error;
      savedCount += placesWithExternalId.length;
    } catch (error) {
      console.error('[PlaceDB] Erreur batch upsert:', error);
      // Fallback: essayer un par un
      for (const place of placesWithExternalId) {
        try {
          const row = placeDataToDBRow(place, source);
          const { error } = await supabase.from('places').upsert(row, {
            onConflict: 'external_id,source',
            ignoreDuplicates: false,
          });
          if (!error) savedCount++;
        } catch (e) {
          console.error(`[PlaceDB] Erreur sauvegarde ${place.name}:`, e);
        }
      }
    }
  }

  // Insert simple pour ceux sans external_id
  if (placesWithoutExternalId.length > 0) {
    try {
      const rows = placesWithoutExternalId.map(p => placeDataToDBRow(p, source));
      const { error } = await supabase.from('places').insert(rows);

      if (error) throw error;
      savedCount += placesWithoutExternalId.length;
    } catch (error) {
      console.error('[PlaceDB] Erreur batch insert:', error);
      // Fallback: essayer un par un
      for (const place of placesWithoutExternalId) {
        try {
          const row = placeDataToDBRow(place, source);
          const { error } = await supabase.from('places').insert(row);
          if (!error) savedCount++;
        } catch (e) {
          console.error(`[PlaceDB] Erreur sauvegarde ${place.name}:`, e);
        }
      }
    }
  }

  if (savedCount > 0) {
    console.log(`[PlaceDB] ${savedCount}/${places.length} lieux sauvegardés pour ${places[0]?.city}`);
  }
  return savedCount;
}

/**
 * Vérifie le cache de recherche
 */
export async function checkSearchCache(
  queryType: string,
  city: string,
  params: Record<string, unknown>
): Promise<string[] | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const queryHash = hashQuery({ queryType, city, ...params });

    const { data, error } = await supabase
      .from('search_cache')
      .select('results, expires_at')
      .eq('query_hash', queryHash)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    if (!data) return null;

    // Vérifier l'expiration
    if (new Date() > new Date(data.expires_at)) {
      await supabase.from('search_cache').delete().eq('query_hash', queryHash);
      return null;
    }

    return data.results as string[];
  } catch (error) {
    console.warn('[PlaceDB] Erreur checkSearchCache:', error);
    return null;
  }
}

/**
 * Sauvegarde une recherche dans le cache
 */
export async function saveSearchCache(
  queryType: string,
  city: string,
  params: Record<string, unknown>,
  placeIds: string[],
  source: DataSource,
  cacheDays: number = DEFAULT_CACHE_DAYS
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  try {
    const queryHash = hashQuery({ queryType, city, ...params });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cacheDays);

    await supabase.from('search_cache').upsert(
      {
        query_hash: queryHash,
        query_type: queryType,
        city,
        parameters: params,
        results: placeIds,
        result_count: placeIds.length,
        source,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'query_hash' }
    );
  } catch (error) {
    console.warn('[PlaceDB] Erreur saveSearchCache:', error);
  }
}

/**
 * Récupère des statistiques sur la base de données
 */
export async function getDatabaseStats(): Promise<{
  totalPlaces: number;
  byType: Record<PlaceType, number>;
  bySource: Record<DataSource, number>;
  citiesCovered: number;
}> {
  const emptyStats = {
    totalPlaces: 0,
    byType: { restaurant: 0, hotel: 0, attraction: 0 },
    bySource: { serpapi: 0, foursquare: 0, osm: 0, claude: 0, tripadvisor: 0, gemini: 0 },
    citiesCovered: 0,
  };

  const supabase = getSupabaseAdmin();
  if (!supabase) return emptyStats;

  try {
    // Total count
    const { count: totalPlaces } = await supabase
      .from('places')
      .select('id', { count: 'exact', head: true });

    // Count by type
    const byType: Record<PlaceType, number> = { restaurant: 0, hotel: 0, attraction: 0 };
    for (const t of ['restaurant', 'hotel', 'attraction'] as PlaceType[]) {
      const { count } = await supabase
        .from('places')
        .select('id', { count: 'exact', head: true })
        .eq('type', t);
      byType[t] = count ?? 0;
    }

    // Count by source
    const bySource: Record<DataSource, number> = {
      serpapi: 0, foursquare: 0, osm: 0, claude: 0, tripadvisor: 0, gemini: 0,
    };
    for (const s of ['serpapi', 'foursquare', 'osm', 'claude', 'tripadvisor', 'gemini'] as DataSource[]) {
      const { count } = await supabase
        .from('places')
        .select('id', { count: 'exact', head: true })
        .eq('source', s);
      bySource[s] = count ?? 0;
    }

    // Distinct cities
    const { data: citiesData } = await supabase
      .from('places')
      .select('city');
    const uniqueCities = new Set((citiesData || []).map((r: { city: string }) => r.city));

    return {
      totalPlaces: totalPlaces ?? 0,
      byType,
      bySource,
      citiesCovered: uniqueCities.size,
    };
  } catch (error) {
    console.warn('[PlaceDB] Erreur getDatabaseStats:', error);
    return emptyStats;
  }
}

/**
 * Nettoie les données expirées
 */
export async function cleanupExpiredData(maxAgeDays: number = 90): Promise<number> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    // Supprimer les caches expirés
    await supabase
      .from('search_cache')
      .delete()
      .lt('expires_at', new Date().toISOString());

    // Supprimer les lieux trop vieux
    const { data: deleted } = await supabase
      .from('places')
      .delete()
      .lt('verified_at', cutoffDate.toISOString())
      .select('id');

    const deletedCount = deleted?.length ?? 0;
    if (deletedCount > 0) {
      console.log(`[PlaceDB] Nettoyage: ${deletedCount} lieux supprimés (> ${maxAgeDays} jours)`);
    }
    return deletedCount;
  } catch (error) {
    console.warn('[PlaceDB] Erreur cleanupExpiredData:', error);
    return 0;
  }
}
