import { TripPreferences } from './types';

const ORIGINS = [
  'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse',
  'Nice', 'Strasbourg', 'Nantes', 'Lille', 'Bruxelles',
];

const DESTINATIONS = [
  'Tokyo', 'Barcelone', 'Rome', 'Amsterdam', 'Lisbonne',
  'New York', 'Marrakech', 'Londres', 'Berlin', 'Prague',
  'Istanbul', 'Bangkok', 'Montréal', 'Athènes', 'Dublin',
  'Séville', 'Copenhague', 'Vienne', 'Budapest', 'Dubrovnik',
];

// Always use 'optimal' (véhicule recommandé) for random examples
const GROUP_TYPES: TripPreferences['groupType'][] = ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'];
const BUDGET_LEVELS: TripPreferences['budgetLevel'][] = ['economic', 'moderate', 'comfort', 'luxury'];
const ACTIVITIES: TripPreferences['activities'][number][] = ['beach', 'nature', 'culture', 'gastronomy', 'nightlife', 'shopping', 'adventure', 'wellness'];

interface RandomExampleOptions {
  randomFn?: () => number;
}

function pickWithRandom<T>(arr: T[], randomFn: () => number): T {
  return arr[Math.floor(randomFn() * arr.length)];
}

function pickNWithRandom<T>(arr: T[], min: number, max: number, randomFn: () => number): T[] {
  const n = min + Math.floor(randomFn() * (max - min + 1));
  const keyed = arr.map((value) => ({ value, key: randomFn() }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.slice(0, n).map((entry) => entry.value);
}

export function generateRandomPreferences(options: RandomExampleOptions = {}): Partial<TripPreferences> {
  const randomFn = options.randomFn ?? Math.random;
  const origin = pickWithRandom(ORIGINS, randomFn);
  let destination = pickWithRandom(DESTINATIONS, randomFn);
  // Ensure different from origin
  while (destination === origin) {
    destination = pickWithRandom(DESTINATIONS, randomFn);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 7 + Math.floor(randomFn() * 80));

  const groupType = pickWithRandom(GROUP_TYPES, randomFn);
  const groupSize = groupType === 'solo' ? 1
    : groupType === 'couple' ? 2
    : 1 + Math.floor(randomFn() * 6);

  const durationDays = 3 + Math.floor(randomFn() * 12);

  return {
    origin,
    destination,
    startDate,
    durationDays,
    transport: 'optimal',
    carRental: randomFn() > 0.7,
    groupSize,
    groupType,
    budgetLevel: pickWithRandom(BUDGET_LEVELS, randomFn),
    activities: pickNWithRandom(ACTIVITIES, 2, 4, randomFn),
    dietary: ['none'],
    tripMode: 'precise' as const,
    cityPlan: [{ city: destination, days: durationDays }],
  };
}
