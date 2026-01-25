/**
 * Service de gestion de la base de données locale pour les lieux vérifiés
 *
 * Ce service permet de:
 * - Chercher des lieux en base (restaurants, hôtels, attractions)
 * - Sauvegarder de nouvelles données vérifiées
 * - Vérifier la fraîcheur des données (cache 30 jours)
 * - Mettre à jour les données existantes
 */

import { prisma } from '../db';
import crypto from 'crypto';

// Types
export type PlaceType = 'restaurant' | 'hotel' | 'attraction';
export type DataReliability = 'verified' | 'estimated' | 'generated';
export type DataSource = 'serpapi' | 'foursquare' | 'osm' | 'claude';

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

/**
 * Génère un hash pour une requête de recherche (pour le cache)
 */
function hashQuery(params: Record<string, unknown>): string {
  const sortedParams = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha256').update(sortedParams).digest('hex');
}

/**
 * Vérifie si les données pour une ville et un type sont fraîches
 */
export async function isDataFresh(
  city: string,
  type: PlaceType,
  maxAgeDays: number = DEFAULT_CACHE_DAYS
): Promise<boolean> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  // Note: SQLite ne supporte pas mode: 'insensitive', on utilise contains
  const freshCount = await prisma.place.count({
    where: {
      city: { contains: city },
      type,
      verifiedAt: { gte: cutoffDate },
    },
  });

  return freshCount >= 5; // On considère qu'on a assez de données si >= 5 lieux frais
}

/**
 * Recherche des lieux dans la base de données locale
 */
export async function searchPlacesFromDB(
  options: PlaceSearchOptions
): Promise<PlaceData[]> {
  const {
    city,
    type,
    maxAgeDays = DEFAULT_CACHE_DAYS,
    limit = 10,
    minRating,
  } = options;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  // Note: SQLite ne supporte pas mode: 'insensitive', on utilise contains
  const places = await prisma.place.findMany({
    where: {
      city: { contains: city },
      type,
      verifiedAt: { gte: cutoffDate },
      ...(minRating !== undefined && { rating: { gte: minRating } }),
    },
    orderBy: [
      { dataReliability: 'asc' }, // 'verified' avant 'estimated' avant 'generated'
      { rating: 'desc' },
      { verifiedAt: 'desc' },
    ],
    take: limit,
  });

  return places.map(dbPlaceToPlaceData);
}

/**
 * Recherche un lieu par son ID externe et sa source
 */
export async function getPlaceByExternalId(
  externalId: string,
  source: DataSource
): Promise<PlaceData | null> {
  const place = await prisma.place.findUnique({
    where: {
      externalId_source: { externalId, source },
    },
  });

  return place ? dbPlaceToPlaceData(place) : null;
}

/**
 * Sauvegarde une liste de lieux dans la base de données
 * Met à jour si le lieu existe déjà (upsert)
 */
export async function savePlacesToDB(
  places: PlaceData[],
  source: DataSource
): Promise<number> {
  let savedCount = 0;

  for (const place of places) {
    try {
      const data = {
        type: place.type,
        name: place.name,
        city: place.city,
        country: place.country,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        rating: place.rating,
        reviewCount: place.reviewCount,
        priceLevel: place.priceLevel,
        stars: place.stars,
        cuisineTypes: place.cuisineTypes ? JSON.stringify(place.cuisineTypes) : null,
        amenities: place.amenities ? JSON.stringify(place.amenities) : null,
        categories: place.categories ? JSON.stringify(place.categories) : null,
        openingHours: place.openingHours ? JSON.stringify(place.openingHours) : null,
        phone: place.phone,
        website: place.website,
        googleMapsUrl: place.googleMapsUrl,
        bookingUrl: place.bookingUrl,
        description: place.description,
        tips: place.tips,
        source,
        dataReliability: place.dataReliability,
        verifiedAt: new Date(),
      };

      if (place.externalId) {
        // Upsert si on a un ID externe
        await prisma.place.upsert({
          where: {
            externalId_source: {
              externalId: place.externalId,
              source,
            },
          },
          update: data,
          create: {
            ...data,
            externalId: place.externalId,
          },
        });
      } else {
        // Créer si pas d'ID externe
        await prisma.place.create({
          data,
        });
      }

      savedCount++;
    } catch (error) {
      console.error(`[PlaceDB] Erreur sauvegarde ${place.name}:`, error);
    }
  }

  console.log(`[PlaceDB] ${savedCount}/${places.length} lieux sauvegardés pour ${places[0]?.city}`);
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
  const queryHash = hashQuery({ queryType, city, ...params });

  const cached = await prisma.searchCache.findUnique({
    where: { queryHash },
  });

  if (!cached) return null;

  // Vérifier si le cache est expiré
  if (new Date() > cached.expiresAt) {
    // Supprimer le cache expiré
    await prisma.searchCache.delete({ where: { queryHash } });
    return null;
  }

  return JSON.parse(cached.results);
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
  const queryHash = hashQuery({ queryType, city, ...params });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + cacheDays);

  await prisma.searchCache.upsert({
    where: { queryHash },
    update: {
      results: JSON.stringify(placeIds),
      resultCount: placeIds.length,
      expiresAt,
    },
    create: {
      queryHash,
      queryType,
      city,
      parameters: JSON.stringify(params),
      results: JSON.stringify(placeIds),
      resultCount: placeIds.length,
      source,
      expiresAt,
    },
  });
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
  const [totalPlaces, byTypeRaw, bySourceRaw, citiesRaw] = await Promise.all([
    prisma.place.count(),
    prisma.place.groupBy({
      by: ['type'],
      _count: true,
    }),
    prisma.place.groupBy({
      by: ['source'],
      _count: true,
    }),
    prisma.place.groupBy({
      by: ['city'],
      _count: true,
    }),
  ]);

  const byType: Record<PlaceType, number> = {
    restaurant: 0,
    hotel: 0,
    attraction: 0,
  };
  byTypeRaw.forEach((item) => {
    byType[item.type as PlaceType] = item._count;
  });

  const bySource: Record<DataSource, number> = {
    serpapi: 0,
    foursquare: 0,
    osm: 0,
    claude: 0,
  };
  bySourceRaw.forEach((item) => {
    bySource[item.source as DataSource] = item._count;
  });

  return {
    totalPlaces,
    byType,
    bySource,
    citiesCovered: citiesRaw.length,
  };
}

/**
 * Nettoie les données expirées
 */
export async function cleanupExpiredData(maxAgeDays: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  // Supprimer les caches expirés
  await prisma.searchCache.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  // Supprimer les lieux très anciens (> 90 jours par défaut)
  const deleted = await prisma.place.deleteMany({
    where: {
      verifiedAt: { lt: cutoffDate },
    },
  });

  console.log(`[PlaceDB] Nettoyage: ${deleted.count} lieux supprimés (> ${maxAgeDays} jours)`);
  return deleted.count;
}

// Helpers internes

function dbPlaceToPlaceData(dbPlace: {
  id: string;
  externalId: string | null;
  type: string;
  name: string;
  city: string;
  country: string | null;
  address: string;
  latitude: number;
  longitude: number;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  stars: number | null;
  cuisineTypes: string | null;
  amenities: string | null;
  categories: string | null;
  openingHours: string | null;
  phone: string | null;
  website: string | null;
  googleMapsUrl: string;
  bookingUrl: string | null;
  description: string | null;
  tips: string | null;
  source: string;
  dataReliability: string;
}): PlaceData {
  return {
    externalId: dbPlace.externalId || undefined,
    type: dbPlace.type as PlaceType,
    name: dbPlace.name,
    city: dbPlace.city,
    country: dbPlace.country || undefined,
    address: dbPlace.address,
    latitude: dbPlace.latitude,
    longitude: dbPlace.longitude,
    rating: dbPlace.rating || undefined,
    reviewCount: dbPlace.reviewCount || undefined,
    priceLevel: dbPlace.priceLevel || undefined,
    stars: dbPlace.stars || undefined,
    cuisineTypes: dbPlace.cuisineTypes ? JSON.parse(dbPlace.cuisineTypes) : undefined,
    amenities: dbPlace.amenities ? JSON.parse(dbPlace.amenities) : undefined,
    categories: dbPlace.categories ? JSON.parse(dbPlace.categories) : undefined,
    openingHours: dbPlace.openingHours ? JSON.parse(dbPlace.openingHours) : undefined,
    phone: dbPlace.phone || undefined,
    website: dbPlace.website || undefined,
    googleMapsUrl: dbPlace.googleMapsUrl,
    bookingUrl: dbPlace.bookingUrl || undefined,
    description: dbPlace.description || undefined,
    tips: dbPlace.tips || undefined,
    source: dbPlace.source as DataSource,
    dataReliability: dbPlace.dataReliability as DataReliability,
  };
}
