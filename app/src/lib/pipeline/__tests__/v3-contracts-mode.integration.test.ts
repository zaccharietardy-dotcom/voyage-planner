import type { TripPreferences } from '../../types';

jest.mock('../step1-fetch', () => ({
  fetchAllData: jest.fn(),
}));
jest.mock('../step2-score', () => ({
  scoreAndSelectActivities: jest.fn(),
}));
jest.mock('../step3-cluster', () => ({
  clusterActivities: jest.fn(),
  computeCityDensityProfile: jest.fn(),
}));
jest.mock('../step5-hotel', () => ({
  selectTieredHotels: jest.fn(),
  selectTopHotelsByBarycenter: jest.fn(),
}));
jest.mock('../step4-anchor-transport', () => ({
  anchorTransport: jest.fn(),
}));
jest.mock('../step7b-travel-times', () => ({
  computeTravelTimes: jest.fn(),
}));
jest.mock('../step8-place-restaurants', () => ({
  enrichRestaurantPool: jest.fn(),
}));
jest.mock('../step8910-unified-schedule', () => ({
  unifiedScheduleV3Days: jest.fn(),
}));
jest.mock('../step11-contracts', () => ({
  validateContracts: jest.fn(),
}));
jest.mock('../step12-decorate', () => ({
  decorateTrip: jest.fn(),
}));

import { fetchAllData } from '../step1-fetch';
import { scoreAndSelectActivities } from '../step2-score';
import { clusterActivities, computeCityDensityProfile } from '../step3-cluster';
import { selectTopHotelsByBarycenter } from '../step5-hotel';
import { anchorTransport } from '../step4-anchor-transport';
import { computeTravelTimes } from '../step7b-travel-times';
import { enrichRestaurantPool } from '../step8-place-restaurants';
import { unifiedScheduleV3Days } from '../step8910-unified-schedule';
import { validateContracts } from '../step11-contracts';
import { decorateTrip } from '../step12-decorate';
import { generateTripV3 } from '../index';

const mockFetchAllData = fetchAllData as jest.MockedFunction<typeof fetchAllData>;
const mockScoreAndSelectActivities = scoreAndSelectActivities as jest.MockedFunction<typeof scoreAndSelectActivities>;
const mockClusterActivities = clusterActivities as jest.MockedFunction<typeof clusterActivities>;
const mockComputeCityDensityProfile = computeCityDensityProfile as jest.MockedFunction<typeof computeCityDensityProfile>;
const mockSelectTopHotelsByBarycenter = selectTopHotelsByBarycenter as jest.MockedFunction<typeof selectTopHotelsByBarycenter>;
const mockAnchorTransport = anchorTransport as jest.MockedFunction<typeof anchorTransport>;
const mockComputeTravelTimes = computeTravelTimes as jest.MockedFunction<typeof computeTravelTimes>;
const mockEnrichRestaurantPool = enrichRestaurantPool as jest.MockedFunction<typeof enrichRestaurantPool>;
const mockUnifiedScheduleV3Days = unifiedScheduleV3Days as jest.MockedFunction<typeof unifiedScheduleV3Days>;
const mockValidateContracts = validateContracts as jest.MockedFunction<typeof validateContracts>;
const mockDecorateTrip = decorateTrip as jest.MockedFunction<typeof decorateTrip>;

function basePreferences(): TripPreferences {
  return {
    origin: 'Paris',
    destination: 'Barcelona',
    startDate: new Date('2026-03-16T00:00:00.000Z'),
    durationDays: 1,
    transport: 'plane',
    carRental: false,
    groupSize: 2,
    groupType: 'couple',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: 'Sagrada Familia',
  };
}

describe('generateTripV3 contracts mode', () => {
  const originalContractsMode = process.env.PIPELINE_CONTRACTS_MODE;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFetchAllData.mockResolvedValue({
      destCoords: { lat: 41.3851, lng: 2.1734 },
      originCoords: { lat: 48.8566, lng: 2.3522 },
      originAirports: [],
      destAirports: [],
      googlePlacesAttractions: [],
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
      dayTripSuggestions: [],
      dayTripActivities: {},
      dayTripRestaurants: {},
      travelTips: {},
      budgetStrategy: {} as any,
      resolvedBudget: {} as any,
    } as any);

    const selectedActivities = [{
      id: 'act-1',
      name: 'Sagrada Familia',
      type: 'culture',
      description: 'Desc',
      duration: 90,
      estimatedCost: 20,
      latitude: 41.4036,
      longitude: 2.1744,
      rating: 4.8,
      mustSee: true,
      bookingRequired: true,
      openingHours: { open: '09:00', close: '18:00' },
      score: 90,
      source: 'google_places',
      reviewCount: 1000,
    }];

    const day = {
      dayNumber: 1,
      date: new Date('2026-03-16T00:00:00.000Z'),
      isDayTrip: false,
      items: [{
        id: 'act-1',
        dayNumber: 1,
        startTime: '10:00',
        endTime: '11:30',
        type: 'activity',
        title: 'Sagrada Familia',
        description: 'Desc',
        locationName: 'Barcelona',
        latitude: 41.4036,
        longitude: 2.1744,
        orderIndex: 0,
        estimatedCost: 20,
        duration: 90,
      }],
      theme: 'Culture',
      dayNarrative: 'Day 1',
    };

    mockScoreAndSelectActivities.mockReturnValue(selectedActivities as any);
    mockComputeCityDensityProfile.mockReturnValue({} as any);
    mockClusterActivities.mockReturnValue([{
      dayNumber: 1,
      activities: selectedActivities as any,
      centroid: { lat: 41.4036, lng: 2.1744 },
      totalIntraDistance: 0.1,
    }] as any);
    mockSelectTopHotelsByBarycenter.mockReturnValue([]);
    mockAnchorTransport.mockReturnValue([{
      dayNumber: 1,
      activityStartTime: '08:30',
      activityEndTime: '21:00',
      hasArrivalTransport: false,
      hasDepartureTransport: false,
    }]);
    mockComputeTravelTimes.mockResolvedValue([{ dayNumber: 1, legs: [], totalTravelMinutes: 0 }] as any);
    mockEnrichRestaurantPool.mockResolvedValue([]);
    mockUnifiedScheduleV3Days.mockReturnValue({
      days: [day],
      repairs: [],
      unresolvedViolations: ['Day 1: Restaurant too far'],
    });
    mockValidateContracts.mockReturnValue({
      invariantsPassed: false,
      score: 60,
      violations: ['P0.2: Day 1 restaurant too far'],
      qualityWarnings: [],
      metrics: {
        totalActivities: 1,
        totalRestaurants: 1,
        mustSeesPlanned: 1,
        mustSeesTotal: 1,
        avgRestaurantDistance: 1.2,
        activitiesOutsideHours: 0,
        restaurantsOverMaxDistance: 1,
        daysWithoutLunch: 0,
        daysWithoutDinner: 0,
        invalidCoordinates: 0,
        durationViolations: 0,
      },
    });
    mockDecorateTrip.mockResolvedValue({
      days: [day],
      usedLLM: false,
    } as any);
  });

  afterEach(() => {
    if (originalContractsMode == null) {
      delete process.env.PIPELINE_CONTRACTS_MODE;
    } else {
      process.env.PIPELINE_CONTRACTS_MODE = originalContractsMode;
    }
  });

  it('throws in strict mode when unresolved P0 violations remain', async () => {
    process.env.PIPELINE_CONTRACTS_MODE = 'strict';
    await expect(generateTripV3(basePreferences())).rejects.toThrow(/Contract validation failed/);
  });

  it('returns trip in warn mode and exposes combined violations', async () => {
    process.env.PIPELINE_CONTRACTS_MODE = 'warn';
    const trip = await generateTripV3(basePreferences());

    expect(trip.contractViolations).toEqual(expect.arrayContaining([
      'REPAIR: Day 1: Restaurant too far',
      'P0.2: Day 1 restaurant too far',
    ]));
    expect(trip.qualityMetrics?.violations).toEqual(expect.arrayContaining([
      'REPAIR: Day 1: Restaurant too far',
      'P0.2: Day 1 restaurant too far',
    ]));
  });
});
