import { validateAndFixTrip } from '../step8-validate';
import type { Trip, TripItem, TripPreferences } from '../../types';

function createPreferences(): TripPreferences {
  return {
    origin: 'Lyon',
    destination: 'Milan',
    startDate: new Date('2026-02-18T00:00:00.000Z'),
    durationDays: 3,
    transport: 'train',
    carRental: false,
    groupSize: 1,
    groupType: 'solo',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: 'Duomo',
  };
}

function item(partial: Partial<TripItem> & Pick<TripItem, 'id' | 'type' | 'title' | 'startTime' | 'endTime' | 'latitude' | 'longitude'>): TripItem {
  const {
    id,
    type,
    title,
    startTime,
    endTime,
    latitude,
    longitude,
    ...rest
  } = partial;

  return {
    id,
    dayNumber: rest.dayNumber || 1,
    type,
    title,
    description: rest.description || title,
    locationName: rest.locationName || title,
    startTime,
    endTime,
    latitude,
    longitude,
    orderIndex: rest.orderIndex || 0,
    estimatedCost: rest.estimatedCost || 0,
    duration: rest.duration || 60,
    ...rest,
  };
}

describe('step8-validate geography checks', () => {
  it('adds geoDiagnostics and flags impossible/long transitions', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'A1', startTime: '09:00', endTime: '10:00', latitude: 45.4628, longitude: 9.1695 }),
      item({
        id: 'a2',
        type: 'activity',
        title: 'A2',
        startTime: '10:05',
        endTime: '11:00',
        latitude: 45.4628,
        longitude: 9.2495,
        timeFromPrevious: 6,
        distanceFromPrevious: 6.2,
      }),
      item({
        id: 'a3',
        type: 'activity',
        title: 'A3',
        startTime: '11:10',
        endTime: '12:00',
        latitude: 45.4628,
        longitude: 9.1895,
        timeFromPrevious: 5,
        distanceFromPrevious: 4.7,
      }),
    ];

    const trip: Trip = {
      id: 'trip-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-02-18T00:00:00.000Z'),
          items: dayItems,
          isDayTrip: false,
        },
      ],
    };

    const result = validateAndFixTrip(trip);

    expect(result.score).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes('hard long leg'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('impossible transition'))).toBe(true);

    const diagnostics = trip.days[0].geoDiagnostics;
    expect(diagnostics).toBeDefined();
    expect((diagnostics?.maxLegKm || 0)).toBeGreaterThan(4);
    expect((diagnostics?.totalTravelMin || 0)).toBeGreaterThan(0);
  });

  it('does not count hotel meals as urban route legs', () => {
    const dayItems: TripItem[] = [
      item({ id: 'checkin-1', type: 'checkin', title: 'Check-in Hôtel', startTime: '08:00', endTime: '08:30', latitude: 45.4628, longitude: 9.1695 }),
      item({ id: 'meal-hotel', type: 'restaurant', title: "Petit-déjeuner à l'hôtel", startTime: '08:30', endTime: '09:00', latitude: 45.4628, longitude: 9.1695 }),
      item({
        id: 'a1',
        type: 'activity',
        title: 'A1',
        startTime: '09:30',
        endTime: '10:30',
        latitude: 45.4628,
        longitude: 9.2495,
        distanceFromPrevious: 14.2,
        timeFromPrevious: 80,
      }),
    ];

    const trip: Trip = {
      id: 'trip-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-02-18T00:00:00.000Z'),
          items: dayItems,
          isDayTrip: false,
        },
      ],
    };

    const result = validateAndFixTrip(trip);

    expect(result.warnings.some((w) => w.includes('hard long leg'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('impossible transition'))).toBe(false);
  });

  it('flags non-Google restaurant photos and high-fatigue day plans', () => {
    const dayItems: TripItem[] = [
      item({
        id: 'a1',
        type: 'activity',
        title: 'A1',
        startTime: '09:00',
        endTime: '11:00',
        duration: 120,
        latitude: 48.8606,
        longitude: 2.3376,
      }),
      item({
        id: 'a2',
        type: 'activity',
        title: 'A2',
        startTime: '11:20',
        endTime: '13:20',
        duration: 120,
        latitude: 48.8738,
        longitude: 2.2950,
        distanceFromPrevious: 3.4,
        timeFromPrevious: 22,
      }),
      item({
        id: 'lunch-1',
        type: 'restaurant',
        title: 'Déjeuner — Test Bistro',
        startTime: '13:20',
        endTime: '14:30',
        duration: 70,
        latitude: 48.8684,
        longitude: 2.3212,
        imageUrl: 'https://example.com/not-google.jpg',
        restaurant: {
          id: 'r-1',
          name: 'Test Bistro',
          address: 'Paris',
          latitude: 48.8684,
          longitude: 2.3212,
          rating: 4.6,
          reviewCount: 1200,
          priceLevel: 2,
          cuisineTypes: ['restaurant français'],
          dietaryOptions: ['none'],
          openingHours: {},
        },
      }),
      item({
        id: 'a3',
        type: 'activity',
        title: 'A3',
        startTime: '14:45',
        endTime: '16:45',
        duration: 120,
        latitude: 48.8867,
        longitude: 2.3431,
        distanceFromPrevious: 2.6,
        timeFromPrevious: 18,
      }),
    ];

    const trip: Trip = {
      id: 'trip-3',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [
        {
          dayNumber: 2,
          date: new Date('2026-02-19T00:00:00.000Z'),
          items: dayItems,
          isDayTrip: false,
        },
      ],
    };

    const result = validateAndFixTrip(trip);

    expect(result.warnings.some((w) => w.includes('non-Google photo source'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('fatigue risk'))).toBe(true);
  });
});
