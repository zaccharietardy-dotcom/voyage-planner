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

  // 1. Récupérer les attractions locales (base de données codée en dur)
  const localAttractions = getAttractions(destination);
  console.log(`Attractions locales pour ${destination}: ${localAttractions.length}`);

  // 2. Vérifier le cache mémoire AI
  if (AI_ATTRACTIONS_CACHE[normalized] && !options?.forceAI) {
    console.log(`Cache mémoire AI pour ${destination}: ${AI_ATTRACTIONS_CACHE[normalized].length}`);
    // Combiner les attractions locales et le cache AI (dédupliquer par nom)
    const combined = [...localAttractions];
    const localNames = new Set(localAttractions.map(a => a.name.toLowerCase()));
    for (const attraction of AI_ATTRACTIONS_CACHE[normalized]) {
      if (!localNames.has(attraction.name.toLowerCase())) {
        combined.push(attraction);
      }
    }
    console.log(`Total combiné (local + cache): ${combined.length}`);
    return combined;
  }

  // 3. TOUJOURS chercher sur les APIs externes pour avoir plus d'attractions
  // (même si on a des attractions locales, on veut en avoir plus pour remplir les journées)
  console.log(`Recherche d'attractions pour ${destination} via API...`);
  try {
    const aiAttractions = await searchAttractionsFromCache(destination, {
      types: options?.types,
      maxResults: 40,
      cityCenter: options?.cityCenter,
    });

    if (aiAttractions.length > 0) {
      // Combiner attractions locales + API (dédupliquer par nom)
      const combined = [...localAttractions];
      const localNames = new Set(localAttractions.map(a => a.name.toLowerCase()));
      for (const attraction of aiAttractions) {
        if (!localNames.has(attraction.name.toLowerCase())) {
          combined.push(attraction);
        }
      }

      // Stocker le résultat combiné dans le cache
      AI_ATTRACTIONS_CACHE[normalized] = combined;
      console.log(`Total combiné (local + API): ${combined.length}`);
      return combined;
    }
  } catch (error) {
    console.warn(`Erreur recherche attractions: ${error}`);
  }

  // 4. Si l'API échoue, retourner au moins les attractions locales
  return localAttractions;
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
