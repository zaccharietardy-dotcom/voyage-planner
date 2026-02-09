/**
 * Scénarios de test prédéfinis pour le debug pipeline
 *
 * Chaque scénario est un objet TripPreferences complet
 * couvrant un cas limite spécifique.
 */

import { TripPreferences } from '../../src/lib/types';

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  preferences: TripPreferences;
}

export const SCENARIOS: Record<string, Scenario> = {
  'paris-rome-4d': {
    id: 'paris-rome-4d',
    name: 'Paris → Rome (4 jours)',
    description: 'Baseline — couple, budget modéré, culture + gastronomie',
    preferences: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: futureDate(30),
      durationDays: 4,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Colisée, Vatican',
      tripMode: 'precise',
      cityPlan: [{ city: 'Rome', days: 4 }],
    },
  },

  '1day-express': {
    id: '1day-express',
    name: 'Paris → Barcelone (1 jour)',
    description: 'Durée minimale — solo, économique',
    preferences: {
      origin: 'Paris',
      destination: 'Barcelone',
      startDate: futureDate(35),
      durationDays: 1,
      transport: 'plane',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Sagrada Familia',
      tripMode: 'precise',
      cityPlan: [{ city: 'Barcelone', days: 1 }],
    },
  },

  '14day-long': {
    id: '14day-long',
    name: 'Lyon → Tokyo (14 jours)',
    description: 'Durée maximale — groupe d\'amis, confort',
    preferences: {
      origin: 'Lyon',
      destination: 'Tokyo',
      startDate: futureDate(45),
      durationDays: 14,
      transport: 'optimal',
      carRental: false,
      groupSize: 4,
      groupType: 'friends',
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy', 'nature', 'adventure'],
      dietary: ['none'],
      mustSee: 'Mont Fuji, Sanctuaire Fushimi Inari, Akihabara',
      tripMode: 'precise',
      cityPlan: [{ city: 'Tokyo', days: 14 }],
    },
  },

  'backpacker': {
    id: 'backpacker',
    name: 'Marseille → Marrakech (7 jours)',
    description: 'Budget minimum — solo, économique',
    preferences: {
      origin: 'Marseille',
      destination: 'Marrakech',
      startDate: futureDate(40),
      durationDays: 7,
      transport: 'optimal',
      carRental: false,
      groupSize: 1,
      groupType: 'solo',
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy', 'adventure'],
      dietary: ['none'],
      mustSee: 'Place Jemaa el-Fna, Jardin Majorelle',
      tripMode: 'precise',
      cityPlan: [{ city: 'Marrakech', days: 7 }],
    },
  },

  'luxury-couple': {
    id: 'luxury-couple',
    name: 'Paris → Londres (5 jours)',
    description: 'Budget maximum — couple, luxe',
    preferences: {
      origin: 'Paris',
      destination: 'Londres',
      startDate: futureDate(30),
      durationDays: 5,
      transport: 'train',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'luxury',
      activities: ['culture', 'gastronomy', 'shopping', 'wellness'],
      dietary: ['none'],
      mustSee: 'British Museum, Tower of London, Buckingham Palace',
      tripMode: 'precise',
      cityPlan: [{ city: 'Londres', days: 5 }],
    },
  },

  'large-group': {
    id: 'large-group',
    name: 'Bordeaux → Barcelone (5 jours)',
    description: 'Grand groupe 8 personnes — amis, modéré',
    preferences: {
      origin: 'Bordeaux',
      destination: 'Barcelone',
      startDate: futureDate(50),
      durationDays: 5,
      transport: 'optimal',
      carRental: false,
      groupSize: 8,
      groupType: 'friends',
      budgetLevel: 'moderate',
      activities: ['beach', 'nightlife', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Sagrada Familia, Park Güell',
      tripMode: 'precise',
      cityPlan: [{ city: 'Barcelone', days: 5 }],
    },
  },

  'train-only': {
    id: 'train-only',
    name: 'Paris → Amsterdam (4 jours)',
    description: 'Transport train uniquement — couple',
    preferences: {
      origin: 'Paris',
      destination: 'Amsterdam',
      startDate: futureDate(35),
      durationDays: 4,
      transport: 'train',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['culture', 'nature'],
      dietary: ['none'],
      mustSee: 'Rijksmuseum, Anne Frank House',
      tripMode: 'precise',
      cityPlan: [{ city: 'Amsterdam', days: 4 }],
    },
  },

  'car-rental': {
    id: 'car-rental',
    name: 'Toulouse → Nice (6 jours)',
    description: 'Road trip en voiture — famille avec enfants',
    preferences: {
      origin: 'Toulouse',
      destination: 'Nice',
      startDate: futureDate(40),
      durationDays: 6,
      transport: 'car',
      carRental: true,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['beach', 'nature', 'culture'],
      dietary: ['none'],
      mustSee: 'Promenade des Anglais, Vieux Nice',
      tripMode: 'precise',
      cityPlan: [{ city: 'Nice', days: 6 }],
    },
  },

  'multi-city': {
    id: 'multi-city',
    name: 'Paris → Italie (10 jours)',
    description: 'Road trip multi-villes — couple, confort',
    preferences: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: futureDate(45),
      durationDays: 10,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy', 'nature'],
      dietary: ['none'],
      mustSee: 'Colisée, Ponte Vecchio, Place Saint-Marc',
      tripMode: 'precise',
      cityPlan: [
        { city: 'Rome', days: 4 },
        { city: 'Florence', days: 3 },
        { city: 'Venise', days: 3 },
      ],
    },
  },

  'small-city': {
    id: 'small-city',
    name: 'Nantes → Dubrovnik (5 jours)',
    description: 'Petite ville — données API potentiellement limitées',
    preferences: {
      origin: 'Nantes',
      destination: 'Dubrovnik',
      startDate: futureDate(50),
      durationDays: 5,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'moderate',
      activities: ['culture', 'beach', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Murailles de Dubrovnik',
      tripMode: 'precise',
      cityPlan: [{ city: 'Dubrovnik', days: 5 }],
    },
  },

  'family-kids': {
    id: 'family-kids',
    name: 'Lille → Barcelone (7 jours)',
    description: 'Famille avec enfants — activités adaptées',
    preferences: {
      origin: 'Lille',
      destination: 'Barcelone',
      startDate: futureDate(40),
      durationDays: 7,
      transport: 'optimal',
      carRental: false,
      groupSize: 4,
      groupType: 'family_with_kids',
      budgetLevel: 'moderate',
      activities: ['beach', 'culture', 'nature'],
      dietary: ['none'],
      mustSee: 'Aquarium de Barcelone, Park Güell',
      tripMode: 'precise',
      cityPlan: [{ city: 'Barcelone', days: 7 }],
    },
  },

  'must-see-heavy': {
    id: 'must-see-heavy',
    name: 'Paris → Rome (5 jours)',
    description: 'Beaucoup de must-see — test de priorisation',
    preferences: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: futureDate(35),
      durationDays: 5,
      transport: 'optimal',
      carRental: false,
      groupSize: 2,
      groupType: 'couple',
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Colisée, Vatican, Fontaine de Trevi, Panthéon, Escalier de la Trinité-des-Monts',
      tripMode: 'precise',
      cityPlan: [{ city: 'Rome', days: 5 }],
    },
  },
};

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS[id];
}

export function getAllScenarioIds(): string[] {
  return Object.keys(SCENARIOS);
}
