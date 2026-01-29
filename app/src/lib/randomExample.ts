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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], min: number, max: number): T[] {
  const n = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export function generateRandomPreferences(): Partial<TripPreferences> {
  const origin = pick(ORIGINS);
  let destination = pick(DESTINATIONS);
  // Ensure different from origin
  while (destination === origin) {
    destination = pick(DESTINATIONS);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 7 + Math.floor(Math.random() * 80));

  const groupType = pick(GROUP_TYPES);
  const groupSize = groupType === 'solo' ? 1
    : groupType === 'couple' ? 2
    : 1 + Math.floor(Math.random() * 6);

  return {
    origin,
    destination,
    startDate,
    durationDays: 3 + Math.floor(Math.random() * 12),
    transport: 'optimal',
    carRental: Math.random() > 0.7,
    groupSize,
    groupType,
    budgetLevel: pick(BUDGET_LEVELS),
    activities: pickN(ACTIVITIES, 2, 4),
    dietary: ['none'],
  };
}
