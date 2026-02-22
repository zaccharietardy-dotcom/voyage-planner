/**
 * Unified cuisine taxonomy for the pipeline.
 *
 * Single source of truth for cuisine family detection, used by:
 * - step4-restaurants (restaurant assignment diversity)
 * - step7-assemble (restaurant swap cuisine bonus)
 * - step8-validate (cuisine diversity scoring)
 *
 * The fine-grained map has ~25 families. The country-level map is used as
 * fallback when no fine-grained match is found.
 */

import type { Restaurant } from '../../types';
import type { TripItem } from '../../types';

/**
 * Fine-grained cuisine families — checked first (more specific = earlier match).
 * Order matters: specific categories before broad ones (e.g. "pizza" before "italian",
 * "brasserie" before "french").
 */
export const FINE_CUISINE_MAP: Record<string, string[]> = {
  'japanese': ['sushi', 'ramen', 'izakaya', 'japonais', 'japanese', 'yakitori', 'tempura', 'udon', 'sashimi', 'maki'],
  'italian': ['italien', 'italian', 'pizza', 'pizzeria', 'trattoria', 'osteria', 'ristorante', 'pasta', 'risotto', 'carbonara'],
  'chinese': ['chinois', 'chinese', 'dim sum', 'cantonais', 'szechuan', 'wok'],
  'indian': ['indien', 'indian', 'curry', 'tandoori', 'naan', 'masala'],
  'thai': ['thaï', 'thai', 'thaïlandais', 'pad thai'],
  'vietnamese': ['vietnamien', 'vietnamese', 'pho', 'banh mi', 'bo bun'],
  'korean': ['coréen', 'korean', 'bibimbap', 'kimchi'],
  'mexican': ['mexicain', 'mexican', 'tacos', 'taqueria', 'burrito', 'guacamole'],
  'lebanese': ['libanais', 'lebanese', 'mezze', 'falafel', 'shawarma'],
  'moroccan': ['marocain', 'moroccan', 'tagine', 'couscous'],
  'greek': ['grec', 'greek', 'taverna', 'gyros', 'souvlaki'],
  'turkish': ['turc', 'turkish', 'kebab', 'döner'],
  'spanish': ['espagnol', 'spanish', 'tapas', 'paella', 'catalan', 'andalou'],
  'peruvian': ['péruvien', 'peruvian', 'ceviche'],
  'american': ['american', 'américain', 'burger', 'diner', 'bbq', 'barbecue'],
  'mediterranean': ['méditerranéen', 'mediterranean'],
  'chocolate': ['chocolat', 'chocolate', 'cocoa'],
  'brasserie': ['brasserie'],
  'bistro': ['bistro', 'bistrot'],
  'french-gastro': ['gastronomique', 'étoilé', 'michelin', 'gastro'],
  'bakery': ['boulangerie', 'bakery', 'pain', 'bread'],
  'patisserie': ['pâtisserie', 'patisserie'],
  'cafe': ['café', 'coffee', 'brunch', 'salon de thé'],
  'seafood': ['fruits de mer', 'seafood', 'poisson', 'fish', 'crustacé', 'huître', 'oyster'],
  'steakhouse': ['steakhouse', 'steak', 'grill', 'viande', 'boucherie'],
  // "french" last — broad catch-all for French cuisine not caught above
  'french': ['français', 'francais', 'french', 'provençal', 'lyonnais', 'normand', 'breton', 'alsacien', 'savoyard', 'gascon', 'basque'],
};

/**
 * Country-level cuisine keywords — used as fallback after fine-grained map.
 */
export const LOCAL_CUISINE_KEYWORDS: Record<string, string[]> = {
  france: ['français', 'francais', 'french', 'bistro', 'brasserie', 'provençal', 'lyonnais', 'normand', 'breton', 'alsacien', 'savoyard', 'gascon', 'basque'],
  italy: ['italien', 'italian', 'pizzeria', 'trattoria', 'osteria', 'ristorante'],
  spain: ['espagnol', 'spanish', 'tapas', 'paella', 'catalan', 'andalou'],
  germany: ['allemand', 'german', 'biergarten', 'brauhaus'],
  japan: ['japonais', 'japanese', 'sushi', 'ramen', 'izakaya'],
  greece: ['grec', 'greek', 'taverna'],
  morocco: ['marocain', 'moroccan', 'tagine', 'couscous'],
  usa: ['american', 'américain', 'diner', 'bbq', 'burger'],
  uk: ['british', 'anglais', 'pub', 'fish and chips'],
  portugal: ['portugais', 'portuguese'],
  thailand: ['thaï', 'thai', 'thaïlandais'],
  india: ['indien', 'indian', 'curry'],
  china: ['chinois', 'chinese', 'dim sum', 'cantonais'],
  lebanon: ['libanais', 'lebanese', 'mezze'],
  mexico: ['mexicain', 'mexican', 'tacos', 'taqueria'],
  vietnam: ['vietnamien', 'vietnamese', 'pho'],
  korea: ['coréen', 'korean', 'bibimbap'],
  turkey: ['turc', 'turkish', 'kebab'],
  peru: ['péruvien', 'peruvian', 'ceviche'],
};

/**
 * Detect the cuisine family from a Restaurant object.
 *
 * Returns a fine-grained family tag (e.g. "italian", "brasserie", "seafood")
 * or a country-level tag, or "generic" if no match.
 *
 * Checks `cuisineTypes` first (explicit API data), then falls back to
 * name + description text matching.
 */
export function getCuisineFamily(restaurant: Restaurant): string {
  // Prioritize cuisineTypes (explicit data from Google Places API)
  const cuisineText = (restaurant.cuisineTypes || []).join(' ').toLowerCase();
  if (cuisineText) {
    for (const [family, keywords] of Object.entries(FINE_CUISINE_MAP)) {
      if (keywords.some(kw => cuisineText.includes(kw))) return family;
    }
  }

  // Fallback: name + cuisineTypes combined text
  const text = `${restaurant.name || ''} ${cuisineText}`.toLowerCase();

  for (const [family, keywords] of Object.entries(FINE_CUISINE_MAP)) {
    if (keywords.some(kw => text.includes(kw))) return family;
  }

  // Last resort: country-level detection
  for (const [country, keywords] of Object.entries(LOCAL_CUISINE_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return country;
  }

  return 'generic';
}

/**
 * Detect cuisine family from a TripItem (for scoring/validation).
 *
 * Extracts the restaurant from the item and delegates to getCuisineFamily.
 * Also checks item.title as additional signal.
 */
export function getCuisineFamilyFromItem(item: TripItem): string {
  if (item.type !== 'restaurant') return 'generic';

  const restaurant = item.restaurant;
  if (restaurant) {
    // First try the standard restaurant-based detection
    const family = getCuisineFamily(restaurant);
    if (family !== 'generic') return family;
  }

  // Fallback: check item title + restaurant description
  const text = [
    restaurant?.name || '',
    restaurant?.description || '',
    item.title || '',
  ].join(' ').toLowerCase();

  for (const [family, keywords] of Object.entries(FINE_CUISINE_MAP)) {
    if (keywords.some(kw => text.includes(kw))) return family;
  }

  return 'generic';
}

/**
 * Check if a restaurant matches local cuisine for a given country.
 */
export function isLocalCuisine(restaurant: Restaurant, country: string): boolean {
  const keywords = LOCAL_CUISINE_KEYWORDS[country] || [];
  const text = `${restaurant.name || ''} ${(restaurant.cuisineTypes || []).join(' ')}`.toLowerCase();
  return keywords.some(kw => text.includes(kw));
}
