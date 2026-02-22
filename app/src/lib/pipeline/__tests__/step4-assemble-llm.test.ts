import { assembleFromLLMPlan } from '../step4-assemble-llm';
import type { FetchedData, LLMPlannerInput, LLMPlannerOutput } from '../types';
import type { TripPreferences, TransportOptionSummary } from '../../types';

jest.mock('../services/wikimediaImages', () => ({
  fetchPlaceImage: jest.fn().mockResolvedValue(null),
  fetchRestaurantPhotoByPlaceId: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/wikipedia', () => ({
  batchFetchWikipediaSummaries: jest.fn().mockResolvedValue(new Map()),
  getWikiLanguageForDestination: jest.fn().mockReturnValue('fr'),
}));

function basePreferences(): TripPreferences {
  return {
    origin: 'Lyon',
    destination: 'Paris',
    startDate: new Date('2026-03-08T11:00:00.000Z'),
    durationDays: 3,
    transport: 'train',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: '',
  };
}

function buildTransport(): TransportOptionSummary {
  return {
    id: 'train_api',
    mode: 'train',
    totalDuration: 172,
    totalPrice: 60,
    totalCO2: 45,
    score: 8.5,
    scoreDetails: { priceScore: 8, timeScore: 8, co2Score: 9 },
    bookingUrl: 'https://www.omio.fr/trains/lyon/paris?departure_date=2026-03-08',
    segments: [
      {
        mode: 'train',
        from: 'Lyon',
        to: 'Paris',
        duration: 132,
        price: 60,
        operator: 'SNCF',
      },
    ],
    transitLegs: [
      {
        mode: 'train',
        from: 'Lyon-Perrache',
        to: 'Gare de Lyon',
        departure: '2026-03-08T11:44:00.000Z',
        arrival: '2026-03-08T13:56:00.000Z',
        duration: 132,
        operator: 'SNCF',
        line: 'FR',
      },
    ],
    dataSource: 'api',
  };
}

describe('step4-assemble-llm', () => {
  it('rebases return train legs and normalizes booking URL/date/direction', async () => {
    const preferences = basePreferences();
    const transport = buildTransport();

    const plan: LLMPlannerOutput = {
      days: [
        {
          dayNumber: 1,
          theme: 'Musée',
          narrative: 'Jour 1',
          items: [
            { type: 'activity', activityId: 'act-1', startTime: '16:45', endTime: '19:15', duration: 150 },
            { type: 'restaurant', restaurantId: 'rest-1', mealType: 'dinner', startTime: '21:00', endTime: '22:00', duration: 60 },
          ],
        },
        {
          dayNumber: 2,
          theme: 'Tour',
          narrative: 'Jour 2',
          items: [
            { type: 'activity', activityId: 'act-2', startTime: '10:00', endTime: '12:00', duration: 120 },
          ],
        },
        {
          dayNumber: 3,
          theme: 'Retour',
          narrative: 'Jour 3',
          items: [],
        },
      ],
      unusedActivities: [],
      reasoning: 'Test plan',
    };

    const input: LLMPlannerInput = {
      trip: {
        destination: 'Paris',
        origin: 'Lyon',
        startDate: preferences.startDate.toISOString(),
        durationDays: 3,
        groupType: preferences.groupType,
        groupSize: preferences.groupSize,
        budgetLevel: preferences.budgetLevel,
        arrivalTime: null,
        departureTime: null,
        preferredActivities: [],
        mustSeeRequested: '',
        dayTrips: [],
      },
      hotel: null,
      activities: [
        {
          id: 'act-1',
          name: "Musée d'Orsay",
          type: 'culture',
          lat: 48.86,
          lng: 2.3266,
          duration: 150,
          rating: 4.8,
          reviewCount: 100,
          mustSee: true,
          estimatedCost: 16,
          bookingRequired: false,
          viatorAvailable: false,
          isOutdoor: false,
        },
        {
          id: 'act-2',
          name: 'Tour Eiffel',
          type: 'culture',
          lat: 48.8584,
          lng: 2.2945,
          duration: 120,
          rating: 4.7,
          reviewCount: 100,
          mustSee: false,
          estimatedCost: 15,
          bookingRequired: false,
          viatorAvailable: false,
          isOutdoor: false,
        },
      ],
      restaurants: [
        {
          id: 'rest-1',
          name: 'Les Deux Colombes',
          lat: 48.854679,
          lng: 2.350448,
          rating: 4.7,
          priceLevel: 2,
          cuisineTypes: ['restaurant'],
          suitableFor: ['dinner'],
        },
      ],
      distances: {},
      weather: [],
    };

    const data: FetchedData = {
      destCoords: { lat: 48.8566, lng: 2.3522 },
      originCoords: { lat: 45.7603, lng: 4.8282 },
      originAirports: [],
      destAirports: [],
      googlePlacesAttractions: [
        { id: 'act-1', name: "Musée d'Orsay", type: 'culture', latitude: 48.86, longitude: 2.3266, rating: 4.8, reviewCount: 100, duration: 150, mustSee: true, estimatedCost: 16, bookingRequired: false },
        { id: 'act-2', name: 'Tour Eiffel', type: 'culture', latitude: 48.8584, longitude: 2.2945, rating: 4.7, reviewCount: 100, duration: 120, mustSee: false, estimatedCost: 15, bookingRequired: false },
      ] as any,
      serpApiAttractions: [],
      overpassAttractions: [],
      viatorActivities: [],
      mustSeeAttractions: [],
      tripAdvisorRestaurants: [
        {
          id: 'rest-1',
          name: 'Les Deux Colombes',
          address: '4 Rue de la Colombe, 75004 Paris',
          latitude: 48.854679,
          longitude: 2.350448,
          rating: 4.7,
          reviewCount: 100,
          priceLevel: 2,
          cuisineTypes: ['restaurant'],
          dietaryOptions: ['none'],
          openingHours: {},
        },
      ] as any,
      serpApiRestaurants: [],
      bookingHotels: [],
      transportOptions: [transport],
      outboundFlight: null,
      returnFlight: null,
      flightAlternatives: { outbound: [], return: [] },
      weatherForecasts: [],
      dayTripSuggestions: [],
      dayTripActivities: {},
      dayTripRestaurants: {},
      travelTips: null,
      budgetStrategy: {
        accommodationType: 'hotel',
        accommodationBudgetPerNight: 120,
        mealsStrategy: { breakfast: 'restaurant', lunch: 'restaurant', dinner: 'restaurant' },
        groceryShoppingNeeded: false,
        activitiesLevel: 'mixed',
        dailyActivityBudget: 40,
        maxPricePerActivity: 25,
        transportTips: '',
        reasoning: '',
      },
      resolvedBudget: {
        totalBudget: 1000,
        perPersonBudget: 500,
        perPersonPerDay: 166,
        budgetLevel: 'moderate',
      },
    };

    const trip = await assembleFromLLMPlan(plan, input, data, preferences, null, transport);

    const day1Activity = trip.days[0].items.find((item) => item.type === 'activity');
    expect(day1Activity?.googleMapsPlaceUrl).toBeDefined();
    expect(day1Activity?.googleMapsPlaceUrl).not.toContain('query_place_id=');

    const returnItem = trip.days[2].items.find((item) => item.type === 'transport' && item.transportRole === 'longhaul');
    expect(returnItem).toBeDefined();
    expect(returnItem?.transportDirection).toBe('return');
    expect(returnItem?.transportTimeSource).toBe('rebased');
    expect(returnItem?.bookingUrl).toContain('/trains/paris/lyon');
    expect(returnItem?.bookingUrl).toContain('departure_date=2026-03-10');
    expect(returnItem?.description).not.toContain('Train retour Train');

    expect(returnItem?.transitLegs?.[0]?.from).toBe('Gare de Lyon');
    expect(returnItem?.transitLegs?.[0]?.to).toBe('Lyon-Perrache');

    const itemStart = new Date(trip.days[2].date);
    const [startHour, startMinute] = (returnItem?.startTime || '00:00').split(':').map(Number);
    itemStart.setHours(startHour || 0, startMinute || 0, 0, 0);
    const itemEnd = new Date(trip.days[2].date);
    const [endHour, endMinute] = (returnItem?.endTime || '00:00').split(':').map(Number);
    itemEnd.setHours(endHour || 0, endMinute || 0, 0, 0);
    const firstDep = new Date(returnItem!.transitLegs![0].departure);
    const lastArr = new Date(returnItem!.transitLegs![returnItem!.transitLegs!.length - 1].arrival);

    const startDelta = Math.abs(firstDep.getTime() - itemStart.getTime()) / 60000;
    const endDelta = Math.abs(lastArr.getTime() - itemEnd.getTime()) / 60000;
    expect(startDelta).toBeLessThanOrEqual(15);
    expect(endDelta).toBeLessThanOrEqual(15);
  });
});
