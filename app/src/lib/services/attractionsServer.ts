/**
 * Service des attractions - VERSION SERVEUR UNIQUEMENT
 *
 * Ce fichier contient les fonctions async qui utilisent Claude AI
 * Il ne doit être importé que depuis du code serveur (API routes, etc.)
 */

import { ActivityType } from '../types';
import {
  Attraction,
  getAttractions,
  normalizeCity,
  selectAttractionsFromList,
} from './attractions';
import { searchAttractionsFromCache } from './attractionsAIServer';

// Cache mémoire pour les attractions trouvées via AI
const AI_ATTRACTIONS_CACHE: Record<string, Attraction[]> = {};

/**
 * Récupère les attractions pour une destination (async, avec fallback Claude AI)
 * Utilise d'abord la base locale, puis Claude si non trouvé
 */
export async function getAttractionsAsync(
  destination: string,
  options?: {
    types?: ActivityType[];
    forceAI?: boolean;
    cityCenter?: { lat: number; lng: number }; // Pour Foursquare
  }
): Promise<Attraction[]> {
  const normalized = normalizeCity(destination);

  // 1. Vérifier la base locale
  const localAttractions = getAttractions(destination);
  if (localAttractions.length > 0 && !options?.forceAI) {
    console.log(`Attractions locales pour ${destination}: ${localAttractions.length}`);
    return localAttractions;
  }

  // 2. Vérifier le cache mémoire AI
  if (AI_ATTRACTIONS_CACHE[normalized] && !options?.forceAI) {
    console.log(`Cache mémoire AI pour ${destination}: ${AI_ATTRACTIONS_CACHE[normalized].length}`);
    return AI_ATTRACTIONS_CACHE[normalized];
  }

  // 3. Utiliser les APIs externes (Foursquare, SerpAPI, Claude)
  console.log(`Recherche d'attractions pour ${destination}...`);
  try {
    const aiAttractions = await searchAttractionsFromCache(destination, {
      types: options?.types,
      maxResults: 15,
      cityCenter: options?.cityCenter, // Permet Foursquare
    });

    if (aiAttractions.length > 0) {
      // Ajouter au cache mémoire
      AI_ATTRACTIONS_CACHE[normalized] = aiAttractions;
      return aiAttractions;
    }
  } catch (error) {
    console.warn(`Erreur recherche attractions: ${error}`);
  }

  // 4. Retourner vide si rien trouvé
  return [];
}

/**
 * Version async qui utilise Claude AI si nécessaire
 */
export async function selectAttractionsAsync(
  destination: string,
  availableMinutes: number,
  preferences: {
    types: ActivityType[];
    mustSeeQuery?: string;
    prioritizeMustSee?: boolean;
    maxPerDay?: number;
    cityCenter?: { lat: number; lng: number }; // Pour Foursquare
  }
): Promise<Attraction[]> {
  // Utiliser la version async qui peut appeler les APIs externes
  const attractions = await getAttractionsAsync(destination, {
    types: preferences.types,
    cityCenter: preferences.cityCenter,
  });

  if (attractions.length === 0) {
    console.warn(`[Attractions] Aucune attraction trouvée pour ${destination}`);
    return [];
  }

  return selectAttractionsFromList(attractions, availableMinutes, preferences);
}
