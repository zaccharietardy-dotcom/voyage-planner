import { getCuisineFamily, getCuisineFamilyFromItem, isLocalCuisine, FINE_CUISINE_MAP } from '../utils/cuisine';
import type { Restaurant } from '../../types';
import type { TripItem } from '../../types';

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    name: 'Test Restaurant',
    latitude: 48.8566,
    longitude: 2.3522,
    rating: 4.2,
    reviewCount: 100,
    priceLevel: 2,
    ...overrides,
  } as Restaurant;
}

describe('getCuisineFamily', () => {
  it('detects japanese from cuisineTypes', () => {
    const r = makeRestaurant({ cuisineTypes: ['sushi', 'japanese'] });
    expect(getCuisineFamily(r)).toBe('japanese');
  });

  it('detects italian from name', () => {
    const r = makeRestaurant({ name: 'Trattoria da Mario' });
    expect(getCuisineFamily(r)).toBe('italian');
  });

  it('detects brasserie from name', () => {
    const r = makeRestaurant({ name: 'Brasserie Rosie Lou' });
    expect(getCuisineFamily(r)).toBe('brasserie');
  });

  it('prioritizes cuisineTypes over name', () => {
    // Name says "brasserie" but cuisineTypes says "spanish"
    const r = makeRestaurant({ name: 'Brasserie Tapas', cuisineTypes: ['spanish', 'bar'] });
    expect(getCuisineFamily(r)).toBe('spanish');
  });

  it('detects french-gastro', () => {
    const r = makeRestaurant({ name: 'Le Gastronomique' });
    expect(getCuisineFamily(r)).toBe('french-gastro');
  });

  it('returns generic for unmatched', () => {
    const r = makeRestaurant({ name: 'The Place' });
    expect(getCuisineFamily(r)).toBe('generic');
  });

  it('detects chocolate', () => {
    const r = makeRestaurant({ name: 'Maison du Chocolat' });
    expect(getCuisineFamily(r)).toBe('chocolate');
  });

  it('detects cafe', () => {
    const r = makeRestaurant({ cuisineTypes: ['café', 'brunch'] });
    expect(getCuisineFamily(r)).toBe('cafe');
  });

  it('puts french last (broad match)', () => {
    // "français" should match french, not something else
    const r = makeRestaurant({ cuisineTypes: ['français'] });
    expect(getCuisineFamily(r)).toBe('french');
  });
});

describe('getCuisineFamilyFromItem', () => {
  it('extracts from TripItem with restaurant', () => {
    const item = {
      type: 'restaurant' as const,
      title: 'Sushi Bar',
      restaurant: makeRestaurant({ name: 'Sushi Bar', cuisineTypes: ['japanese', 'sushi'] }),
    } as TripItem;
    expect(getCuisineFamilyFromItem(item)).toBe('japanese');
  });

  it('falls back to title when restaurant has no match', () => {
    const item = {
      type: 'restaurant' as const,
      title: 'Tapas Night',
      restaurant: makeRestaurant({ name: 'Unknown Place' }),
    } as TripItem;
    expect(getCuisineFamilyFromItem(item)).toBe('spanish');
  });

  it('returns generic for non-restaurant items', () => {
    const item = { type: 'activity' as const } as TripItem;
    expect(getCuisineFamilyFromItem(item)).toBe('generic');
  });
});

describe('isLocalCuisine', () => {
  it('detects french cuisine for france', () => {
    const r = makeRestaurant({ name: 'Bistro du Coin' });
    expect(isLocalCuisine(r, 'france')).toBe(true);
  });

  it('returns false for non-matching country', () => {
    const r = makeRestaurant({ name: 'Sushi Bar' });
    expect(isLocalCuisine(r, 'france')).toBe(false);
  });
});

describe('FINE_CUISINE_MAP', () => {
  it('has french as last entry (broad catch-all)', () => {
    const keys = Object.keys(FINE_CUISINE_MAP);
    expect(keys[keys.length - 1]).toBe('french');
  });

  it('has at least 20 families', () => {
    expect(Object.keys(FINE_CUISINE_MAP).length).toBeGreaterThanOrEqual(20);
  });
});
