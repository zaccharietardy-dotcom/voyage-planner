import { scoreAndSelectActivities } from '../step2-score';
import type { TripPreferences } from '../../types';
import type { FetchedData } from '../types';
import type { Attraction } from '../../services/attractions';

function createPreferences(): TripPreferences {
  return {
    origin: 'Lyon',
    destination: 'Paris',
    startDate: new Date('2026-04-10T00:00:00.000Z'),
    durationDays: 3,
    transport: 'train',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'moderate',
    activities: ['culture', 'gastronomy'],
    dietary: ['none'],
    mustSee: 'Notre-Dame',
  };
}

function attraction(overrides: Partial<Attraction> & Pick<Attraction, 'id' | 'name'>): Attraction {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    type: 'culture',
    description: rest.description || name,
    duration: rest.duration || 90,
    estimatedCost: rest.estimatedCost || 20,
    latitude: rest.latitude ?? 48.8566,
    longitude: rest.longitude ?? 2.3522,
    rating: rest.rating ?? 4.6,
    mustSee: rest.mustSee ?? false,
    bookingRequired: rest.bookingRequired ?? false,
    openingHours: rest.openingHours || { open: '09:00', close: '18:00' },
    dataReliability: rest.dataReliability || 'verified',
    reviewCount: rest.reviewCount ?? 1000,
    ...rest,
  };
}

function createFetchedData(activities: Attraction[]): FetchedData {
  return {
    destCoords: { lat: 48.8566, lng: 2.3522 },
    originCoords: { lat: 45.764, lng: 4.8357 },
    originAirports: [],
    destAirports: [],
    googlePlacesAttractions: activities,
    serpApiAttractions: [],
    overpassAttractions: [],
    viatorActivities: [],
    mustSeeAttractions: [],
    tripAdvisorRestaurants: [],
    serpApiRestaurants: [],
    bookingHotels: [],
    transportOptions: [],
    outboundFlight: null,
    returnFlight: null,
    flightAlternatives: { outbound: [], return: [] },
    weatherForecasts: [],
    travelTips: null,
    budgetStrategy: {
      accommodationType: 'hotel',
      accommodationBudgetPerNight: 140,
      mealsStrategy: { breakfast: 'restaurant', lunch: 'restaurant', dinner: 'restaurant' },
      groceryShoppingNeeded: false,
      activitiesLevel: 'mixed',
      dailyActivityBudget: 80,
      maxPricePerActivity: 60,
      transportTips: '',
      reasoning: '',
    },
    resolvedBudget: {
      totalBudget: 1200,
      perPersonBudget: 600,
      perPersonPerDay: 200,
      budgetLevel: 'moderate',
    },
  };
}

describe('step2-score interest curation', () => {
  it('filters low-interest non-must-see activities on short trips', () => {
    const activities: Attraction[] = [
      attraction({ id: 'mustsee-low', name: 'Notre-Dame', mustSee: true, rating: 3.9, reviewCount: 20 }),
      attraction({ id: 'good-1', name: 'Musée d\'Orsay', rating: 4.7, reviewCount: 89000 }),
      attraction({ id: 'good-2', name: 'Louvre', rating: 4.8, reviewCount: 120000 }),
      attraction({ id: 'good-3', name: 'Sainte-Chapelle', rating: 4.6, reviewCount: 15000 }),
      attraction({ id: 'good-4', name: 'Panthéon', rating: 4.6, reviewCount: 20000 }),
      attraction({ id: 'good-5', name: 'Tuileries', rating: 4.5, reviewCount: 18000 }),
      attraction({ id: 'good-6', name: 'Opéra Garnier', rating: 4.5, reviewCount: 25000 }),
      attraction({ id: 'weak-nonmust', name: 'Generic Spot', rating: 3.9, reviewCount: 24 }),
    ];

    const selected = scoreAndSelectActivities(createFetchedData(activities), createPreferences());
    const ids = selected.map((activity) => activity.id);

    expect(ids).toContain('mustsee-low');
    expect(ids).toContain('good-1');
    expect(ids).not.toContain('weak-nonmust');
  });
});
