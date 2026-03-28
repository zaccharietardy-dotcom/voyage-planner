import type { TripPreferences } from '@/lib/types';

export interface TripTemplate {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  image: string;
  preferences: Partial<TripPreferences>;
}

export const TRIP_TEMPLATES: TripTemplate[] = [
  {
    id: 'paris-weekend',
    title: 'Weekend à Paris',
    subtitle: '3 jours culture & gastronomie',
    emoji: '🗼',
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=80',
    preferences: {
      destination: 'Paris',
      durationDays: 3,
      groupType: 'couple',
      groupSize: 2,
      budgetLevel: 'moderate',
      transport: 'train',
      activities: ['culture', 'gastronomy'],
      dietary: [],
      mustSee: 'Tour Eiffel, Louvre, Montmartre',
      carRental: false,
    },
  },
  {
    id: 'barcelona-family',
    title: 'Barcelone en famille',
    subtitle: '5 jours plage & culture',
    emoji: '🏖️',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&q=80',
    preferences: {
      destination: 'Barcelone',
      durationDays: 5,
      groupType: 'family_with_kids',
      groupSize: 4,
      budgetLevel: 'moderate',
      transport: 'plane',
      activities: ['beach', 'culture', 'gastronomy'],
      dietary: [],
      mustSee: 'Sagrada Familia, Park Guell, La Rambla',
      carRental: false,
    },
  },
  {
    id: 'rome-express',
    title: 'Rome express',
    subtitle: '2 jours immersion italienne',
    emoji: '🏛️',
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&q=80',
    preferences: {
      destination: 'Rome',
      durationDays: 2,
      groupType: 'couple',
      groupSize: 2,
      budgetLevel: 'moderate',
      transport: 'plane',
      activities: ['culture', 'gastronomy'],
      dietary: [],
      mustSee: 'Colisée, Vatican, Fontaine de Trevi',
      carRental: false,
    },
  },
  {
    id: 'amsterdam-friends',
    title: 'Amsterdam entre amis',
    subtitle: '4 jours aventure urbaine',
    emoji: '🚲',
    image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&q=80',
    preferences: {
      destination: 'Amsterdam',
      durationDays: 4,
      groupType: 'friends',
      groupSize: 4,
      budgetLevel: 'moderate',
      transport: 'plane',
      activities: ['culture', 'nightlife', 'gastronomy'],
      dietary: [],
      mustSee: 'Rijksmuseum, Anne Frank, Vondelpark',
      carRental: false,
    },
  },
  {
    id: 'lisbon-budget',
    title: 'Lisbonne petit budget',
    subtitle: '4 jours soleil & découverte',
    emoji: '🌞',
    image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&q=80',
    preferences: {
      destination: 'Lisbonne',
      durationDays: 4,
      groupType: 'friends',
      groupSize: 2,
      budgetLevel: 'economic',
      transport: 'plane',
      activities: ['culture', 'beach', 'gastronomy', 'nightlife'],
      dietary: [],
      mustSee: 'Belém, Alfama, LX Factory',
      carRental: false,
    },
  },
  {
    id: 'marrakech-luxury',
    title: 'Marrakech luxe',
    subtitle: '5 jours riad & wellness',
    emoji: '🕌',
    image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&q=80',
    preferences: {
      destination: 'Marrakech',
      durationDays: 5,
      groupType: 'couple',
      groupSize: 2,
      budgetLevel: 'luxury',
      transport: 'plane',
      activities: ['wellness', 'culture', 'gastronomy', 'shopping'],
      dietary: [],
      mustSee: 'Jardin Majorelle, Médina, Palais Bahia',
      carRental: false,
    },
  },
];
