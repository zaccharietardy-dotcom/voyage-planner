/**
 * Service de recherche d'attractions via Claude AI
 *
 * Stratégie:
 * 1. Appeler l'API route /api/attractions qui gère le cache
 * 2. L'API vérifie le cache local (fichier JSON)
 * 3. Si pas en cache, appelle Claude pour générer des attractions réelles
 * 4. Sauvegarde en cache pour les prochaines requêtes
 */

import { Attraction } from './attractions';
import { ActivityType } from '../types';

/**
 * Recherche des attractions pour une destination via l'API
 * Utilise le cache si disponible, sinon appelle Claude
 */
export async function searchAttractionsWithAI(
  destination: string,
  options?: {
    types?: ActivityType[];
    forceRefresh?: boolean;
    maxResults?: number;
  }
): Promise<Attraction[]> {
  try {
    const params = new URLSearchParams({ destination });
    if (options?.forceRefresh) params.set('forceRefresh', 'true');
    if (options?.types?.length) params.set('types', options.types.join(','));

    const response = await fetch(`/api/attractions?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    let attractions: Attraction[] = data.attractions || [];

    // Filtrer par type si demandé
    if (options?.types && options.types.length > 0) {
      attractions = attractions.filter(a => options.types!.includes(a.type));
    }

    // Limiter le nombre de résultats
    if (options?.maxResults && options.maxResults > 0) {
      attractions = attractions.slice(0, options.maxResults);
    }

    return attractions;
  } catch (error) {
    console.error('Erreur recherche attractions AI:', error);
    return [];
  }
}

/**
 * Version serveur pour appeler directement depuis les API routes
 * Évite une boucle d'appel HTTP
 */
export async function searchAttractionsWithAIServer(
  destination: string,
  options?: {
    types?: ActivityType[];
    forceRefresh?: boolean;
    maxResults?: number;
  }
): Promise<Attraction[]> {
  // Cette fonction sera utilisée uniquement côté serveur
  // Elle appelle directement la logique sans passer par fetch

  // Dynamically import for server-side only
  const { searchAttractionsFromCache } = await import('./attractionsAIServer');
  return searchAttractionsFromCache(destination, options);
}

/**
 * Vérifie si une destination est en cache (version client)
 * Retourne false car on ne peut pas accéder au fs côté client
 */
export function isDestinationCached(_destination: string): boolean {
  // Côté client, on ne peut pas vérifier le cache serveur
  // La vraie vérification se fait dans l'API
  return false;
}

/**
 * Liste toutes les destinations en cache
 * Non disponible côté client
 */
export function getCachedDestinations(): string[] {
  // Non disponible côté client
  return [];
}

/**
 * Vide le cache (pour debug)
 * Non disponible côté client
 */
export function clearAttractionsCache(): void {
  // Non disponible côté client - utiliser l'API
  console.warn('clearAttractionsCache non disponible côté client');
}
