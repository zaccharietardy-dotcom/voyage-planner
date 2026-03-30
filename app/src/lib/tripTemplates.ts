import type { TripPreferences } from '@/lib/types';

export interface TripTemplate {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  image: string;
  /** Preferences WITHOUT startDate — date is computed dynamically */
  preferences: Partial<Omit<TripPreferences, 'startDate'>>;
  /** Tags shown on the card */
  tags: string[];
}

/**
 * Compute a smart start date relative to today:
 * - Next available Saturday, at least 2 weeks from now
 */
function getSmartStartDate(weeksFromNow = 2): Date {
  const d = new Date();
  d.setDate(d.getDate() + weeksFromNow * 7);
  // Move to next Saturday
  const dayOfWeek = d.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSaturday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Build final preferences with dynamic start date.
 */
export function buildTemplatePreferences(template: TripTemplate): Partial<TripPreferences> {
  return {
    ...template.preferences,
    startDate: getSmartStartDate(template.id.includes('express') ? 1 : 2),
  };
}

export const TRIP_TEMPLATES: TripTemplate[] = [
  {
    id: 'paris-weekend',
    title: 'Weekend à Paris',
    subtitle: 'Culture, musées & bistrots parisiens',
    emoji: '🗼',
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=80',
    tags: ['3 jours', 'Couple', 'Modéré'],
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
      cityPlan: [{ city: 'Paris', days: 3 }],
    },
  },
  {
    id: 'barcelona-family',
    title: 'Barcelone en famille',
    subtitle: 'Plages, Gaudí & tapas avec les enfants',
    emoji: '🏖️',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&q=80',
    tags: ['5 jours', 'Famille', '4 pers.'],
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
      cityPlan: [{ city: 'Barcelone', days: 5 }],
    },
  },
  {
    id: 'rome-express',
    title: 'Rome express',
    subtitle: 'Immersion éclair dans la Ville Éternelle',
    emoji: '🏛️',
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&q=80',
    tags: ['2 jours', 'Solo', 'Économique'],
    preferences: {
      destination: 'Rome',
      durationDays: 2,
      groupType: 'solo',
      groupSize: 1,
      budgetLevel: 'economic',
      transport: 'plane',
      activities: ['culture', 'gastronomy'],
      dietary: [],
      mustSee: 'Colisée, Vatican, Fontaine de Trevi',
      carRental: false,
      cityPlan: [{ city: 'Rome', days: 2 }],
    },
  },
  {
    id: 'amsterdam-friends',
    title: 'Amsterdam entre amis',
    subtitle: 'Canaux, musées & vie nocturne',
    emoji: '🚲',
    image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&q=80',
    tags: ['4 jours', 'Amis', '4 pers.'],
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
      cityPlan: [{ city: 'Amsterdam', days: 4 }],
    },
  },
  {
    id: 'lisbon-budget',
    title: 'Lisbonne petit budget',
    subtitle: 'Soleil, azulejos & pastéis de nata',
    emoji: '🌞',
    image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&q=80',
    tags: ['4 jours', 'Duo', 'Économique'],
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
      cityPlan: [{ city: 'Lisbonne', days: 4 }],
    },
  },
  {
    id: 'marrakech-luxury',
    title: 'Marrakech luxe',
    subtitle: 'Riads, spa & souks dans la ville ocre',
    emoji: '🕌',
    image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&q=80',
    tags: ['5 jours', 'Couple', 'Luxe'],
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
      cityPlan: [{ city: 'Marrakech', days: 5 }],
    },
  },
];
