import { validateAndFixTrip } from '../step8-validate';
import type { Trip, TripItem, TripPreferences, TransportOptionSummary } from '../../types';

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
  it('flags zigzag intra-day routes and fills zigzag diagnostics', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'A1', startTime: '09:00', endTime: '09:45', latitude: 45.4628, longitude: 9.18 }),
      item({ id: 'a2', type: 'activity', title: 'A2', startTime: '10:00', endTime: '10:45', latitude: 45.4628, longitude: 9.205 }),
      item({ id: 'a3', type: 'activity', title: 'A3', startTime: '11:00', endTime: '11:45', latitude: 45.4628, longitude: 9.18 }),
      item({ id: 'a4', type: 'activity', title: 'A4', startTime: '12:00', endTime: '12:45', latitude: 45.4628, longitude: 9.205 }),
    ];

    const trip: Trip = {
      id: 'trip-zigzag',
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
    expect(result.warnings.some((w) => w.includes('zigzag route detected'))).toBe(true);
    expect((trip.days[0].geoDiagnostics?.zigzagTurns || 0)).toBeGreaterThanOrEqual(2);
    expect((trip.days[0].geoDiagnostics?.totalLegKm || 0)).toBeGreaterThan(0);
  });

  it('does not flag zigzag on near-linear routes', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'A1', startTime: '09:00', endTime: '09:45', latitude: 45.4628, longitude: 9.18 }),
      item({ id: 'a2', type: 'activity', title: 'A2', startTime: '10:00', endTime: '10:45', latitude: 45.4628, longitude: 9.185 }),
      item({ id: 'a3', type: 'activity', title: 'A3', startTime: '11:00', endTime: '11:45', latitude: 45.4628, longitude: 9.19 }),
      item({ id: 'a4', type: 'activity', title: 'A4', startTime: '12:00', endTime: '12:45', latitude: 45.4628, longitude: 9.195 }),
    ];

    const trip: Trip = {
      id: 'trip-linear',
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
    expect(result.warnings.some((w) => w.includes('zigzag route detected'))).toBe(false);
  });

  it('flags low route efficiency when ratio exceeds threshold', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'A1', startTime: '09:00', endTime: '09:45', latitude: 45.4628, longitude: 9.19 }),
      item({ id: 'a2', type: 'activity', title: 'A2', startTime: '10:00', endTime: '10:45', latitude: 45.4628, longitude: 9.22 }),
      item({ id: 'a3', type: 'activity', title: 'A3', startTime: '11:00', endTime: '11:45', latitude: 45.4628, longitude: 9.19 }),
      item({ id: 'a4', type: 'activity', title: 'A4', startTime: '12:00', endTime: '12:45', latitude: 45.4628, longitude: 9.16 }),
      item({ id: 'a5', type: 'activity', title: 'A5', startTime: '13:00', endTime: '13:45', latitude: 45.4628, longitude: 9.19 }),
    ];

    const trip: Trip = {
      id: 'trip-ineff',
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
    expect(result.warnings.some((w) => w.includes('route inefficiency is high'))).toBe(true);
    expect((trip.days[0].geoDiagnostics?.routeInefficiencyRatio || 0)).toBeGreaterThan(1.75);
  });

  it('keeps zigzag diagnostics coherent when strict geo-cleanup flags are present', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'A1', startTime: '09:00', endTime: '09:45', latitude: 45.4628, longitude: 9.19 }),
      item({ id: 'a2', type: 'activity', title: 'A2', startTime: '10:00', endTime: '10:45', latitude: 45.4628, longitude: 9.22 }),
      item({ id: 'a3', type: 'activity', title: 'A3', startTime: '11:00', endTime: '11:45', latitude: 45.4628, longitude: 9.19 }),
      item({ id: 'a4', type: 'activity', title: 'A4', startTime: '12:00', endTime: '12:45', latitude: 45.4628, longitude: 9.16 }),
      item({ id: 'a5', type: 'activity', title: 'A5', startTime: '13:00', endTime: '13:45', latitude: 45.4628, longitude: 9.19 }),
    ];

    const trip: Trip = {
      id: 'trip-cleanup-flags',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-02-18T00:00:00.000Z'),
          items: dayItems,
          isDayTrip: false,
          scheduleDiagnostics: {
            geoCleanupApplied: true,
            geoPrunedActivitiesCount: 2,
          },
        },
      ],
    };

    const result = validateAndFixTrip(trip);
    expect(result.warnings.some((w) => w.includes('zigzag route detected'))).toBe(true);
    expect((trip.days[0].geoDiagnostics?.zigzagTurns || 0)).toBeGreaterThanOrEqual(2);
    expect((trip.days[0].geoDiagnostics?.routeInefficiencyRatio || 0)).toBeGreaterThan(1.75);
  });

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

  it('auto-injects fallback longhaul segments on inter-city trips when missing', () => {
    const trip: Trip = {
      id: 'trip-4',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-02-18T00:00:00.000Z'),
          items: [
            item({ id: 'a1', type: 'activity', title: 'Duomo', startTime: '10:00', endTime: '11:00', latitude: 45.4642, longitude: 9.19 }),
          ],
          isDayTrip: false,
        },
        {
          dayNumber: 2,
          date: new Date('2026-02-19T00:00:00.000Z'),
          items: [
            item({ id: 'a2', type: 'activity', title: 'Brera', startTime: '10:00', endTime: '11:00', latitude: 45.472, longitude: 9.188 }),
          ],
          isDayTrip: false,
        },
      ],
    };

    const result = validateAndFixTrip(trip);
    expect(result.warnings.some((w) => w.includes('missing explicit inter-city outbound transport'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('missing explicit inter-city return transport'))).toBe(true);

    const firstDayHasLonghaul = trip.days[0].items.some((item) => item.transportRole === 'longhaul');
    const lastDayHasLonghaul = trip.days[trip.days.length - 1].items.some((item) => item.transportRole === 'longhaul');
    expect(firstDayHasLonghaul).toBe(true);
    expect(lastDayHasLonghaul).toBe(true);
  });

  it('injects plane fallback longhaul with Aviasales/Omio links when selected transport is plane', () => {
    const preferences = createPreferences();
    preferences.origin = 'Tokyo';
    preferences.destination = 'Paris';
    preferences.transport = 'plane';

    const selectedTransport: TransportOptionSummary = {
      id: 'plane',
      mode: 'plane',
      totalDuration: 900,
      totalPrice: 700,
      totalCO2: 450,
      score: 8.3,
      scoreDetails: {
        priceScore: 7,
        timeScore: 9,
        co2Score: 5,
      },
      segments: [],
      bookingUrl: 'https://www.aviasales.com/search/TOKYO0103PARIS1?currency=eur&locale=fr',
      omioFlightUrl: 'https://www.omio.fr/vols/tokyo/paris?departure_date=2026-03-01',
    };

    const trip: Trip = {
      id: 'trip-5',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences,
      selectedTransport,
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-03-01T00:00:00.000Z'),
          items: [
            item({ id: 'a1', type: 'activity', title: 'Louvre', startTime: '11:00', endTime: '12:00', latitude: 48.8606, longitude: 2.3376 }),
          ],
          isDayTrip: false,
        },
        {
          dayNumber: 2,
          date: new Date('2026-03-02T00:00:00.000Z'),
          items: [
            item({ id: 'a2', type: 'activity', title: 'Tour Eiffel', startTime: '11:00', endTime: '12:00', latitude: 48.8584, longitude: 2.2945 }),
          ],
          isDayTrip: false,
        },
      ],
    };

    validateAndFixTrip(trip);

    const outbound = trip.days[0].items.find((entry) => entry.id.startsWith('transport-out-'));
    const inbound = trip.days[1].items.find((entry) => entry.id.startsWith('transport-ret-'));

    expect(outbound?.bookingUrl).toContain('aviasales.com/search/');
    expect(outbound?.qualityFlags).toContain('aviasales_fallback_link');
    expect(inbound?.omioFlightUrl).toContain('departure_date=2026-03-02');
  });

  it('detects temporal overlaps between consecutive items', () => {
    const dayItems: TripItem[] = [
      item({ id: 'a1', type: 'activity', title: 'Museum A', startTime: '09:00', endTime: '10:30', latitude: 45.46, longitude: 9.18 }),
      item({ id: 'a2', type: 'activity', title: 'Gallery B', startTime: '10:00', endTime: '11:00', latitude: 45.46, longitude: 9.185 }),
    ];

    const trip: Trip = {
      id: 'trip-overlap',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: createPreferences(),
      days: [{
        dayNumber: 1,
        date: new Date('2026-02-18T00:00:00.000Z'),
        items: dayItems,
        isDayTrip: false,
      }],
    };

    const result = validateAndFixTrip(trip);
    expect(result.warnings.some(w => w.includes('overlap'))).toBe(true);
    expect(result.score).toBeLessThan(100);
  });
});
