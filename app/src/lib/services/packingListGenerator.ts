import type { Trip } from '@/lib/types';

interface PackingItem {
  id: string;
  label: string;
  category: string;
  checked: boolean;
  isCustom?: boolean;
}

const ESSENTIALS: PackingItem[] = [
  { id: 'passport', label: 'Passeport / Carte d\'identité', category: 'essentials', checked: false },
  { id: 'phone-charger', label: 'Chargeur de téléphone', category: 'electronics', checked: false },
  { id: 'medications', label: 'Médicaments personnels', category: 'health', checked: false },
  { id: 'wallet', label: 'Portefeuille / Carte bancaire', category: 'essentials', checked: false },
  { id: 'insurance', label: 'Assurance voyage (copie)', category: 'essentials', checked: false },
];

const WEATHER_RULES: { condition: (tempMin: number, tempMax: number) => boolean; items: Omit<PackingItem, 'checked'>[] }[] = [
  {
    condition: (min) => min < 10,
    items: [
      { id: 'warm-jacket', label: 'Veste chaude', category: 'clothes' },
      { id: 'scarf', label: 'Écharpe', category: 'clothes' },
      { id: 'warm-layers', label: 'Sous-couches thermiques', category: 'clothes' },
    ],
  },
  {
    condition: (min, max) => max > 25,
    items: [
      { id: 'sunscreen', label: 'Crème solaire', category: 'toiletries' },
      { id: 'sunglasses', label: 'Lunettes de soleil', category: 'essentials' },
      { id: 'hat', label: 'Chapeau / Casquette', category: 'clothes' },
      { id: 'light-clothes', label: 'Vêtements légers', category: 'clothes' },
    ],
  },
  {
    condition: (_, max) => max > 20 && max <= 25,
    items: [
      { id: 'light-jacket', label: 'Veste légère', category: 'clothes' },
    ],
  },
];

const ACTIVITY_RULES: { keywords: string[]; items: Omit<PackingItem, 'checked'>[] }[] = [
  {
    keywords: ['beach', 'plage', 'swim', 'coast', 'island', 'snorkel'],
    items: [
      { id: 'swimwear', label: 'Maillot de bain', category: 'clothes' },
      { id: 'beach-towel', label: 'Serviette de plage', category: 'essentials' },
      { id: 'flip-flops', label: 'Tongs', category: 'clothes' },
    ],
  },
  {
    keywords: ['hike', 'trek', 'randonnée', 'mountain', 'trail'],
    items: [
      { id: 'hiking-boots', label: 'Chaussures de randonnée', category: 'clothes' },
      { id: 'water-bottle', label: 'Gourde', category: 'essentials' },
      { id: 'rain-jacket', label: 'Veste imperméable', category: 'clothes' },
    ],
  },
  {
    keywords: ['spa', 'wellness', 'hammam', 'yoga'],
    items: [
      { id: 'workout-clothes', label: 'Vêtements de sport', category: 'clothes' },
    ],
  },
  {
    keywords: ['nightlife', 'restaurant', 'opera', 'theater', 'gala'],
    items: [
      { id: 'smart-outfit', label: 'Tenue de soirée', category: 'clothes' },
    ],
  },
];

const BASE_CLOTHES: Omit<PackingItem, 'checked'>[] = [
  { id: 'underwear', label: 'Sous-vêtements', category: 'clothes' },
  { id: 'socks', label: 'Chaussettes', category: 'clothes' },
  { id: 'comfortable-shoes', label: 'Chaussures confortables', category: 'clothes' },
  { id: 'pajamas', label: 'Pyjama', category: 'clothes' },
];

const BASE_TOILETRIES: Omit<PackingItem, 'checked'>[] = [
  { id: 'toothbrush', label: 'Brosse à dents', category: 'toiletries' },
  { id: 'deodorant', label: 'Déodorant', category: 'toiletries' },
  { id: 'shampoo', label: 'Shampoing (format voyage)', category: 'toiletries' },
];

const BASE_ELECTRONICS: Omit<PackingItem, 'checked'>[] = [
  { id: 'power-bank', label: 'Batterie externe', category: 'electronics' },
  { id: 'headphones', label: 'Écouteurs', category: 'electronics' },
  { id: 'camera', label: 'Appareil photo (optionnel)', category: 'electronics' },
];

/**
 * Génère une packing list déterministe basée sur les données du voyage
 */
export function generatePackingList(trip: Trip): PackingItem[] {
  const items = new Map<string, PackingItem>();

  // Helper to add without duplicates
  const addItem = (item: Omit<PackingItem, 'checked'>) => {
    if (!items.has(item.id)) {
      items.set(item.id, { ...item, checked: false });
    }
  };

  // 1. Essentials always
  ESSENTIALS.forEach(item => items.set(item.id, item));

  // 2. Base clothes & toiletries
  BASE_CLOTHES.forEach(addItem);
  BASE_TOILETRIES.forEach(addItem);
  BASE_ELECTRONICS.forEach(addItem);

  // 3. Weather-based items
  const weatherData = trip.days
    .map(d => d.weatherForecast)
    .filter((w): w is NonNullable<typeof w> => !!w);

  if (weatherData.length > 0) {
    const minTemp = Math.min(...weatherData.map(w => w.tempMin));
    const maxTemp = Math.max(...weatherData.map(w => w.tempMax));

    WEATHER_RULES.forEach(rule => {
      if (rule.condition(minTemp, maxTemp)) {
        rule.items.forEach(addItem);
      }
    });
  }

  // 4. Activity-based items
  const allText = trip.days
    .flatMap(d => d.items)
    .map(item => `${item.title} ${item.description || ''}`.toLowerCase())
    .join(' ');

  // Also check user activity preferences
  const prefText = (trip.preferences.activities || []).join(' ').toLowerCase();
  const combinedText = `${allText} ${prefText}`;

  ACTIVITY_RULES.forEach(rule => {
    if (rule.keywords.some(kw => combinedText.includes(kw))) {
      rule.items.forEach(addItem);
    }
  });

  // 5. Plug adapter from travel tips
  if (trip.travelTips?.packing?.plugType) {
    addItem({
      id: 'plug-adapter',
      label: `Adaptateur prise ${trip.travelTips.packing.plugType}`,
      category: 'electronics',
    });
  }

  // 6. Travel tips essentials
  trip.travelTips?.packing?.essentials?.forEach((essential, idx) => {
    addItem({
      id: `tip-${idx}`,
      label: essential.item,
      category: 'essentials',
    });
  });

  return Array.from(items.values());
}
