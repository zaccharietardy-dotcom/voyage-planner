import type { TripItem, ActivityType } from '@/lib/types';

// Activity category definitions with emoji and keywords
const CATEGORY_CONFIG: Record<string, { emoji: string; label: string; keywords: string[] }> = {
  gastronomy: {
    emoji: '🍽',
    label: 'Food',
    keywords: ['restaurant', 'food', 'cooking', 'market', 'cuisine', 'tasting', 'gastronom', 'café', 'bakery', 'bistro', 'brunch', 'diner', 'wine', 'beer', 'brewery', 'bar'],
  },
  culture: {
    emoji: '🏛',
    label: 'Culture',
    keywords: ['museum', 'musée', 'gallery', 'galerie', 'monument', 'palace', 'château', 'castle', 'cathedral', 'church', 'temple', 'mosque', 'synagogue', 'heritage', 'archaeological', 'historic', 'opera', 'theater', 'théâtre', 'library'],
  },
  adventure: {
    emoji: '⛰',
    label: 'Adventure',
    keywords: ['hike', 'kayak', 'surf', 'climb', 'zip', 'rafting', 'diving', 'paraglid', 'cycling', 'bike', 'adventure', 'trek', 'mountain', 'climbing', 'snorkel'],
  },
  wellness: {
    emoji: '🧘',
    label: 'Wellness',
    keywords: ['spa', 'wellness', 'massage', 'yoga', 'meditation', 'hammam', 'thermal', 'relaxation', 'sauna'],
  },
  nature: {
    emoji: '🌿',
    label: 'Nature',
    keywords: ['park', 'garden', 'botanical', 'nature', 'forest', 'lake', 'river', 'waterfall', 'volcano', 'canyon', 'national park', 'trail', 'wildlife', 'safari', 'zoo', 'aquarium'],
  },
  beach: {
    emoji: '🏖',
    label: 'Beach',
    keywords: ['beach', 'plage', 'coast', 'seaside', 'island', 'snorkel', 'boat', 'cruise', 'marina', 'bay', 'cove'],
  },
  nightlife: {
    emoji: '🍸',
    label: 'Nightlife',
    keywords: ['bar', 'pub', 'club', 'nightlife', 'cocktail', 'jazz', 'cabaret', 'karaoke', 'party', 'rooftop bar'],
  },
  shopping: {
    emoji: '🛍',
    label: 'Shopping',
    keywords: ['shopping', 'market', 'souk', 'bazaar', 'boutique', 'outlet', 'mall', 'store', 'flea market'],
  },
};

/**
 * Classifie une activité dans une ou plusieurs catégories
 * basé sur son titre, description et type
 */
export function classifyActivityCategory(item: TripItem): ActivityType[] {
  if (item.type === 'restaurant') return ['gastronomy'];
  if (item.type !== 'activity' && item.type !== 'free_time') return [];

  const text = `${item.title} ${item.description || ''} ${item.locationName || ''}`.toLowerCase();
  const matches: ActivityType[] = [];

  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    if (config.keywords.some(kw => text.includes(kw))) {
      matches.push(category as ActivityType);
    }
  }

  // Default to culture if no match for activities
  if (matches.length === 0 && item.type === 'activity') {
    matches.push('culture');
  }

  return matches;
}

/**
 * Retourne la config de catégorie (emoji + label) pour l'UI
 */
export function getCategoryConfig(category: string): { emoji: string; label: string } {
  return CATEGORY_CONFIG[category] || { emoji: '📍', label: category };
}

/**
 * Retourne toutes les catégories disponibles
 */
export function getAllCategories(): { id: string; emoji: string; label: string }[] {
  return Object.entries(CATEGORY_CONFIG).map(([id, config]) => ({
    id,
    emoji: config.emoji,
    label: config.label,
  }));
}
