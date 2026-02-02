import { TripPreferences, BudgetStrategy } from './types';
import { searchRestaurants } from './services/restaurants';
import { calculateDistance } from './services/geocoding';
import { getBudgetPriceLevel } from './tripUtils';

export const usedRestaurantIds = new Set<string>();

/**
 * Détermine si un repas doit être self_catered (courses/cuisine) ou restaurant
 *
 * Logique "mixed" intelligente:
 * - Jour 1 (arrivée): toujours restaurant (on découvre la destination)
 * - Dernier soir complet: toujours restaurant (soirée spéciale)
 * - Jours intermédiaires: alterner restaurant/cuisine
 * - Day trips: toujours restaurant (pas d'accès à la cuisine)
 */
export function shouldSelfCater(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  dayNumber: number,
  budgetStrategy?: BudgetStrategy,
  hotelHasBreakfast?: boolean,
  totalDays?: number,
  isDayTrip?: boolean,
  groceriesDone?: boolean,
): boolean {
  if (!budgetStrategy) return false;
  if (mealType === 'breakfast' && hotelHasBreakfast) return false;
  // On ne peut pas cuisiner pendant un day trip
  if (isDayTrip) return false;
  // On ne peut pas cuisiner si les courses n'ont pas encore été faites
  if (groceriesDone === false) return false;

  const strategy = budgetStrategy.mealsStrategy[mealType];
  if (strategy === 'self_catered') return true;
  if (strategy === 'restaurant') return false;

  // Logique "mixed": décision intelligente par jour
  if (strategy === 'mixed') {
    const lastFullDay = (totalDays || 999) - 1; // avant-dernier jour = dernier soir complet
    // Jour 1: restaurant (découverte)
    if (dayNumber === 1) return false;
    // Dernier soir complet: restaurant (soirée spéciale)
    if (dayNumber === lastFullDay && mealType === 'dinner') return false;
    // Jours intermédiaires: alterner (pairs = restaurant, impairs = cuisine)
    return dayNumber % 2 === 1;
  }
  return false;
}

/**
 * Trouve un restaurant pour un repas (avec rotation pour éviter les répétitions)
 */
export async function findRestaurantForMeal(
  mealType: 'breakfast' | 'lunch' | 'dinner',
  cityCenter: { lat: number; lng: number },
  preferences: TripPreferences,
  dayNumber: number = 1,
  lastCoords?: { lat: number; lng: number }
): Promise<import('./types').Restaurant | null> {
  try {
    // Utiliser lastCoords si disponible (position actuelle du voyageur), sinon cityCenter
    const searchLocation = lastCoords || cityCenter;

    // Demander plus de restaurants pour avoir du choix
    const restaurants = await searchRestaurants({
      latitude: searchLocation.lat,
      longitude: searchLocation.lng,
      mealType,
      dietary: preferences.dietary,
      priceLevel: getBudgetPriceLevel(preferences.budgetLevel),
      limit: 10, // Plus de choix
      destination: preferences.destination,
    });

    if (restaurants.length === 0) return null;

    // FILTRE CUISINE: Exclure les restaurants avec cuisine interdite (chinois à Barcelone, etc.)
    const { isForbiddenCuisine, getCountryFromDestination } = await import('./services/cuisineValidator');

    // Mots-clés à détecter dans le NOM ou DESCRIPTION du restaurant (en plus des cuisineTypes)
    const FORBIDDEN_NAME_KEYWORDS: Record<string, string[]> = {
      Spain: ['chinese', 'chinois', 'china', 'chino', 'wok', 'asia', 'asian', 'asiatique', 'asiatico', 'oriental', 'sushi', 'ramen', 'noodle', 'dim sum', 'thai', 'thaï', 'vietnam', 'viet', 'pho', 'indian', 'indien', 'curry', 'tandoori', 'kebab', 'döner', 'doner', 'korean', 'coreen', 'japonais', 'japanese', 'pekin', 'beijing', 'szechuan', 'cantonese', 'mandarin', 'hong kong'],
      Italy: ['chinese', 'chinois', 'china', 'chino', 'wok', 'asia', 'asian', 'asiatique', 'oriental', 'sushi', 'ramen', 'noodle', 'mexican', 'mexicain', 'tacos', 'burrito', 'tex-mex', 'indian', 'curry', 'kebab', 'döner'],
      France: ['american', 'burger king', 'mcdonald', 'kfc', 'subway', 'quick', 'five guys'],
      Portugal: ['chinese', 'chinois', 'china', 'wok', 'asia', 'asian', 'sushi', 'indian', 'curry', 'kebab', 'döner'],
      Greece: ['chinese', 'chinois', 'china', 'wok', 'asia', 'asian', 'sushi', 'indian', 'curry', 'mexican', 'kebab'],
    };

    const country = getCountryFromDestination(preferences.destination);
    const forbiddenKeywords = country ? (FORBIDDEN_NAME_KEYWORDS[country] || []) : [];

    const cuisineFilteredRestaurants = restaurants.filter(r => {
      // Vérifier les cuisineTypes
      const hasForbiddenCuisine = r.cuisineTypes?.some(cuisine =>
        isForbiddenCuisine(cuisine, preferences.destination)
      );

      // Vérifier le NOM du restaurant (souvent "Wok Palace", "China Town", etc.)
      const nameLower = r.name?.toLowerCase() || '';
      const descLower = (r.description || '').toLowerCase();
      const hasForbiddenName = forbiddenKeywords.some(keyword =>
        nameLower.includes(keyword) || descLower.includes(keyword)
      );

      if (hasForbiddenCuisine || hasForbiddenName) {
        console.log(`[Restaurants] EXCLU: "${r.name}" - cuisine non-locale (${r.cuisineTypes?.join(', ')})${hasForbiddenName ? ' [mot interdit détecté]' : ''}`);
        return false;
      }
      return true;
    });

    // Si tous ont été filtrés, utiliser la liste originale mais avec warning
    const filteredList = cuisineFilteredRestaurants.length > 0 ? cuisineFilteredRestaurants : restaurants;

    // Filtrer les restaurants déjà utilisés
    let availableRestaurants = filteredList.filter(r => !usedRestaurantIds.has(r.id));

    // Si tous ont été utilisés, try wider search before allowing repeats
    if (availableRestaurants.length === 0) {
      // Try expanding search radius (2km, then 3km)
      for (const expandedRadius of [2000, 3000]) {
        try {
          const widerResults = await searchRestaurants({
            latitude: searchLocation.lat,
            longitude: searchLocation.lng,
            mealType,
            dietary: preferences.dietary,
            priceLevel: getBudgetPriceLevel(preferences.budgetLevel),
            limit: 15,
            radius: expandedRadius,
            destination: preferences.destination,
          });
          const widerFiltered = widerResults.filter(r => !usedRestaurantIds.has(r.id));
          if (widerFiltered.length > 0) {
            availableRestaurants = widerFiltered;
            console.log(`[Restaurants] Rayon élargi à ${expandedRadius}m: ${widerFiltered.length} nouveaux restos`);
            break;
          }
        } catch {
          // ignore, fall through
        }
      }

      // Last resort: allow repeats
      if (availableRestaurants.length === 0) {
        console.warn(`[Restaurants] Pool épuisé même à 3km, autorisation de doublons`);
        availableRestaurants = filteredList;
      }
    }

    // Calculer un score pour chaque restaurant: note + proximité
    const scoredRestaurants = availableRestaurants.map(r => {
      let score = r.rating * 10; // Note sur 50

      // Bonus si proche du point précédent
      if (lastCoords) {
        const distFromPrevious = calculateDistance(
          lastCoords.lat, lastCoords.lng,
          r.latitude, r.longitude
        );
        // Moins c'est loin, plus le score est élevé (max +20 pour < 500m)
        score += Math.max(0, 20 - distFromPrevious * 20);
      }

      // Petit bonus aléatoire pour varier (0-5)
      score += Math.random() * 5;

      return { restaurant: r, score };
    });

    // Trier par score décroissant
    scoredRestaurants.sort((a, b) => b.score - a.score);

    // Prendre le meilleur
    const selected = scoredRestaurants[0]?.restaurant;

    if (selected) {
      usedRestaurantIds.add(selected.id);
    }

    return selected || null;
  } catch {
    return null;
  }
}

