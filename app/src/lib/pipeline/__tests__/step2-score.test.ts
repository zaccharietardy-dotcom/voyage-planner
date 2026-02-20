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
    dayTripSuggestions: [],
    dayTripActivities: {},
    dayTripRestaurants: {},
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
      // Extra good activities to keep pool above safety floor after auto must-see detection
      attraction({ id: 'good-7', name: 'Arc de Triomphe', rating: 4.6, reviewCount: 30000 }),
      attraction({ id: 'good-8', name: 'Musée Rodin', rating: 4.5, reviewCount: 12000 }),
      attraction({ id: 'good-9', name: 'Palais Royal', rating: 4.5, reviewCount: 10000 }),
      attraction({ id: 'good-10', name: 'Place des Vosges', rating: 4.5, reviewCount: 8000 }),
      attraction({ id: 'weak-nonmust', name: 'Generic Spot', rating: 3.9, reviewCount: 24 }),
    ];

    const selected = scoreAndSelectActivities(createFetchedData(activities), createPreferences());
    const ids = selected.map((activity) => activity.id);

    expect(ids).toContain('mustsee-low');
    expect(ids).toContain('good-1');
    expect(ids).not.toContain('weak-nonmust');
  });

  it('caps generic private viator tours to one and keeps distinctive experiences', () => {
    const baseAttractions: Attraction[] = [
      attraction({ id: 'base-1', name: 'Tokyo National Museum', rating: 4.6, reviewCount: 4200, estimatedCost: 18 }),
      attraction({ id: 'base-2', name: 'Meiji Shrine', rating: 4.7, reviewCount: 21000, estimatedCost: 0 }),
    ];

    const viatorActivities: Attraction[] = [
      attraction({
        id: 'viator-private-1',
        name: 'Visite privée personnalisée de Tokyo',
        description: 'Customized private walking tour with local insights',
        rating: 4.8,
        reviewCount: 1200,
        estimatedCost: 98,
      }),
      attraction({
        id: 'viator-private-2',
        name: 'Tokyo Private Tour Hidden Gems',
        description: 'Private city tour fully customized',
        rating: 4.9,
        reviewCount: 900,
        estimatedCost: 105,
      }),
      attraction({
        id: 'viator-private-3',
        name: 'Private Tokyo Highlights Day Tour',
        description: 'Personalized itinerary with private guide',
        rating: 4.7,
        reviewCount: 500,
        estimatedCost: 120,
      }),
      attraction({
        id: 'viator-workshop-1',
        name: 'Atelier Couteau Japonais et Sashimi',
        description: 'Hands-on workshop with knife techniques and sushi prep',
        rating: 4.9,
        reviewCount: 350,
        estimatedCost: 110,
      }),
    ];

    const data = createFetchedData(baseAttractions);
    data.viatorActivities = viatorActivities;

    const preferences: TripPreferences = {
      ...createPreferences(),
      destination: 'Tokyo',
      durationDays: 7,
      groupType: 'solo',
      mustSee: '',
      activities: ['culture', 'gastronomy'],
    };

    const selected = scoreAndSelectActivities(data, preferences);

    const genericPrivateTours = selected.filter((activity) =>
      activity.source === 'viator'
      && /private|privee?|customized|personnalise/i.test(`${activity.name} ${activity.description || ''}`)
    );

    expect(genericPrivateTours.length).toBeLessThanOrEqual(1);
    expect(selected.some((activity) => activity.id === 'viator-workshop-1')).toBe(true);
  });

  it('filters travel agencies from attraction candidates', () => {
    const activities: Attraction[] = [
      attraction({
        id: 'valid-1',
        name: 'Musée cantonal des Beaux-Arts de Lausanne',
        rating: 4.5,
        reviewCount: 5000,
        latitude: 46.5179789,
        longitude: 6.6254456,
      }),
      attraction({
        id: 'agency-1',
        name: 'Sol Voyages Vevey S.à r.l.',
        description: 'Agence de voyage locale',
        rating: 5,
        reviewCount: 10,
        latitude: 46.4592309,
        longitude: 6.8446253,
      }),
    ];

    const lausanneData = createFetchedData(activities);
    lausanneData.destCoords = { lat: 46.5197, lng: 6.6323 };
    const selectedInLausanne = scoreAndSelectActivities(lausanneData, {
      ...createPreferences(),
      destination: 'Lausanne',
      mustSee: '',
    });

    expect(selectedInLausanne.some((activity) => activity.id === 'agency-1')).toBe(false);
    expect(selectedInLausanne.some((activity) => activity.id === 'valid-1')).toBe(true);
  });
});
