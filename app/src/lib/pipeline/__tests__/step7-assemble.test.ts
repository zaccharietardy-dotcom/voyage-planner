import {
  addHotelBoundaryTransportItems,
  buildInterCityFallbackTransportPayload,
  compressIntraDayGaps,
  fixRestaurantOutliers,
  getAirportPreDepartureLeadMinutes,
  getTransportModeFromItemData,
  normalizeReturnTransportBookingUrl,
  normalizeSuggestedDayStartHour,
  rebalanceAdjacentDayLoad,
} from '../step7-assemble';
import type { Accommodation, Flight, Restaurant, TripDay, TripItem, TripPreferences, TransportOptionSummary } from '../../types';

describe('step7-assemble helpers', () => {
  const hotel: Accommodation = {
    id: 'h1',
    name: 'Hotel Milano',
    type: 'hotel',
    address: 'Milan',
    latitude: 45.4628,
    longitude: 9.1695,
    rating: 4.6,
    reviewCount: 100,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
  };

  const baseActivity = (id: string, start: string, end: string, lat: number, lng: number): TripItem => ({
    id,
    dayNumber: 1,
    startTime: start,
    endTime: end,
    type: 'activity',
    title: id,
    description: id,
    locationName: id,
    latitude: lat,
    longitude: lng,
    orderIndex: 0,
    estimatedCost: 0,
    duration: 60,
    dataReliability: 'verified',
  });

  const basePreferences: TripPreferences = {
    origin: 'Tokyo',
    destination: 'Paris',
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    durationDays: 7,
    transport: 'plane',
    carRental: false,
    groupSize: 1,
    groupType: 'solo',
    budgetLevel: 'moderate',
    activities: ['culture'],
    dietary: ['none'],
    mustSee: '',
  };

  const planeTransport: TransportOptionSummary = {
    id: 'plane',
    mode: 'plane',
    totalDuration: 900,
    totalPrice: 520,
    totalCO2: 500,
    score: 8.1,
    scoreDetails: {
      priceScore: 7,
      timeScore: 9,
      co2Score: 5,
    },
    segments: [],
    bookingUrl: 'https://www.aviasales.com/search/TOKYO1003PARIS1?currency=eur&locale=fr',
    omioFlightUrl: 'https://www.omio.fr/vols/tokyo/paris?departure_date=2026-03-10',
  };

  it('annotates first outside item with hotel departure distance (no separate transport item)', () => {
    const items = [
      baseActivity('activity-1', '10:00', '11:00', 45.4704, 9.1793),
      baseActivity('activity-2', '12:00', '13:00', 45.4720, 9.1880),
    ];

    const withBoundary = addHotelBoundaryTransportItems({
      items,
      dayNumber: 1,
      hotel,
      destination: 'Milan',
    });

    // No separate hotel-depart transport item should be created
    const depart = withBoundary.find((item) => item.id.startsWith('hotel-depart-1-'));
    expect(depart).toBeUndefined();

    // Instead, the first activity should be annotated with distance from hotel
    const firstActivity = withBoundary.find((item) => item.id === 'activity-1');
    expect(firstActivity).toBeDefined();
    expect((firstActivity?.distanceFromPrevious || 0)).toBeGreaterThan(0);
    expect(firstActivity?.timeFromPrevious).toBeDefined();
  });

  it('normalizes return booking URL departure_date to return day', () => {
    const outboundDate = '2026-02-18';
    const returnDate = new Date('2026-02-22T10:00:00.000Z');
    const rawUrl = `https://www.omio.fr/trains/lyon/milan?departure_date=${outboundDate}&foo=bar`;

    const normalized = normalizeReturnTransportBookingUrl(rawUrl, returnDate);

    expect(normalized).toContain('departure_date=2026-02-22');
    expect(normalized).toContain('foo=bar');
    expect(normalized).not.toContain(`departure_date=${outboundDate}`);
  });

  it('builds a plane fallback payload with Aviasales/Omio links for inter-city trips', () => {
    const payload = buildInterCityFallbackTransportPayload({
      direction: 'outbound',
      preferences: basePreferences,
      transport: planeTransport,
      date: new Date('2026-03-01T08:00:00.000Z'),
    });

    expect(payload.title).toBe('✈️ Vol → Paris');
    expect(payload.data.bookingUrl).toContain('aviasales.com/search/');
    expect(payload.data.aviasalesUrl).toContain('aviasales.com/search/');
    expect(payload.data.omioFlightUrl).toContain('omio.fr/vols/');
    expect(payload.data.qualityFlags).toContain('aviasales_fallback_link');
  });

  it('normalizes return plane fallback Omio date to return day', () => {
    const payload = buildInterCityFallbackTransportPayload({
      direction: 'return',
      preferences: basePreferences,
      transport: planeTransport,
      date: new Date('2026-03-07T15:00:00.000Z'),
    });

    expect(payload.title).toBe('✈️ Vol → Tokyo');
    expect(payload.data.omioFlightUrl).toContain('departure_date=2026-03-07');
  });

  it('detects dominant transit mode by weighted legs duration', () => {
    const mode = getTransportModeFromItemData({
      transitLegs: [
        { mode: 'bus', duration: 12 },
        { mode: 'train', duration: 240 },
      ],
    });

    expect(mode).toBe('train');
  });

  it('skips hotel-return boundary when a longhaul return leg is already scheduled', () => {
    const items: TripItem[] = [
      baseActivity('activity-1', '10:00', '11:00', 45.4704, 9.1793),
      {
        id: 'transport-ret-1',
        dayNumber: 1,
        startTime: '15:00',
        endTime: '18:00',
        type: 'transport',
        title: 'Train → Lyon',
        description: 'Retour',
        locationName: 'Paris → Lyon',
        latitude: 45.0,
        longitude: 3.0,
        orderIndex: 1,
        estimatedCost: 50,
        duration: 180,
        dataReliability: 'verified',
        transportRole: 'longhaul',
      },
    ];

    const withBoundary = addHotelBoundaryTransportItems({
      items,
      dayNumber: 1,
      hotel,
      destination: 'Paris',
    });

    expect(withBoundary.some((item) => item.id.startsWith('hotel-return-1-'))).toBe(false);
    // No separate hotel-depart item (annotates first activity instead)
    expect(withBoundary.some((item) => item.id.startsWith('hotel-depart-1-'))).toBe(false);
  });

  it('caps full-day suggested starts to avoid late starts', () => {
    expect(
      normalizeSuggestedDayStartHour(11, { isFirstDay: false, isLastDay: false, isDayTrip: false })
    ).toBe(8);
  });

  it('caps first and last days at 9h by default', () => {
    expect(
      normalizeSuggestedDayStartHour(11, { isFirstDay: true, isLastDay: false, isDayTrip: false })
    ).toBe(9);
    expect(
      normalizeSuggestedDayStartHour(11, { isFirstDay: false, isLastDay: true, isDayTrip: false })
    ).toBe(9);
  });

  it('uses a realistic airport lead window (90-120 min)', () => {
    const majorHubFlight: Flight = {
      id: 'f-1',
      airline: 'Air France',
      flightNumber: 'AF123',
      departureAirport: 'Aéroport international de Rome Fiumicino',
      departureAirportCode: 'FCO',
      departureCity: 'Rome',
      departureTime: '2026-03-20T19:30:00.000Z',
      departureTimeDisplay: '19:30',
      arrivalAirport: 'Aéroport de Paris-Orly',
      arrivalAirportCode: 'ORY',
      arrivalCity: 'Paris',
      arrivalTime: '2026-03-20T21:45:00.000Z',
      arrivalTimeDisplay: '21:45',
      duration: 135,
      stops: 0,
      price: 120,
      currency: 'EUR',
      cabinClass: 'economy',
      baggageIncluded: true,
    };

    const regionalFlight: Flight = {
      ...majorHubFlight,
      id: 'f-2',
      departureAirport: 'Aéroport de Nîmes',
      departureAirportCode: 'FNI',
    };

    expect(getAirportPreDepartureLeadMinutes(majorHubFlight)).toBe(120);
    expect(getAirportPreDepartureLeadMinutes(regionalFlight)).toBe(90);
  });

  it('compresses very large intra-day gaps without moving fixed anchors', () => {
    const day: TripDay = {
      dayNumber: 1,
      date: new Date('2026-03-01T00:00:00.000Z'),
      items: [
        baseActivity('a1', '09:00', '10:00', 48.8606, 2.3376),
        baseActivity('a2', '14:30', '15:30', 48.8738, 2.295),
        {
          id: 'transport-ret-1',
          dayNumber: 1,
          startTime: '18:00',
          endTime: '20:00',
          type: 'transport',
          title: 'Train retour',
          description: 'Retour',
          locationName: 'Paris → Lyon',
          latitude: 48.8566,
          longitude: 2.3522,
          orderIndex: 2,
          transportRole: 'longhaul',
        },
      ],
    };

    const changed = compressIntraDayGaps([day]);
    expect(changed).toBeGreaterThan(0);

    const sorted = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const gap = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };
    const firstGap = gap(sorted[1].startTime) - gap(sorted[0].endTime);
    expect(firstGap).toBeLessThanOrEqual(150);
    expect(sorted[2].startTime).toBe('18:00');
  });

  it('replaces outlier restaurants from pool and avoids same-day duplicates', async () => {
    const closeRestaurant: Restaurant = {
      id: 'r-close',
      name: 'Bistro Proche',
      address: 'Paris',
      latitude: 48.8609,
      longitude: 2.338,
      rating: 4.6,
      reviewCount: 120,
      priceLevel: 2,
      cuisineTypes: ['restaurant français'],
      dietaryOptions: ['none'],
      openingHours: {},
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Bistro%20Proche%2C%20Paris',
      photos: ['/api/place-photo?photo_reference=test&maxwidth=800'],
    };
    const closeRestaurant2: Restaurant = {
      ...closeRestaurant,
      id: 'r-close-2',
      name: 'Table Voisine',
      latitude: 48.8611,
      longitude: 2.3382,
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Table%20Voisine%2C%20Paris',
    };
    const closeBreakfast: Restaurant = {
      ...closeRestaurant,
      id: 'r-close-3',
      name: 'Boulangerie Matin',
      cuisineTypes: ['boulangerie'],
      latitude: 48.8608,
      longitude: 2.3379,
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Boulangerie%20Matin%2C%20Paris',
    };

    const day: TripDay = {
      dayNumber: 1,
      date: new Date('2026-03-02T00:00:00.000Z'),
      items: [
        {
          id: 'checkin-1',
          dayNumber: 1,
          startTime: '08:30',
          endTime: '09:00',
          type: 'checkin',
          title: 'Check-in Hôtel',
          description: '',
          locationName: 'Hotel',
          latitude: 48.8607,
          longitude: 2.3381,
          orderIndex: 0,
        },
        baseActivity('a1', '09:30', '11:00', 48.8606, 2.3376),
        {
          id: 'meal-1-breakfast',
          dayNumber: 1,
          startTime: '11:00',
          endTime: '11:45',
          type: 'restaurant',
          title: 'Petit-déjeuner — Restaurant à proximité',
          description: '',
          locationName: 'Loin',
          latitude: 48.901,
          longitude: 2.39,
          orderIndex: 2,
          restaurant: {
            id: 'r-far',
            name: 'Restaurant à proximité',
            address: 'Far',
            latitude: 48.901,
            longitude: 2.39,
            rating: 4.0,
            reviewCount: 10,
            priceLevel: 2,
            cuisineTypes: ['restaurant'],
            dietaryOptions: ['none'],
            openingHours: {},
          },
        },
        {
          id: 'meal-1-lunch',
          dayNumber: 1,
          startTime: '12:30',
          endTime: '13:30',
          type: 'restaurant',
          title: 'Déjeuner — Restaurant à proximité',
          description: '',
          locationName: 'Loin',
          latitude: 48.901,
          longitude: 2.39,
          orderIndex: 3,
          restaurant: {
            id: 'r-far-2',
            name: 'Restaurant à proximité',
            address: 'Far',
            latitude: 48.901,
            longitude: 2.39,
            rating: 4.1,
            reviewCount: 11,
            priceLevel: 2,
            cuisineTypes: ['restaurant'],
            dietaryOptions: ['none'],
            openingHours: {},
          },
        },
      ],
    };

    const stats = await fixRestaurantOutliers([day], [closeRestaurant, closeRestaurant2, closeBreakfast], 'Paris', { allowApiFallback: false });
    expect(stats.replaced).toBeGreaterThan(0);
    expect(day.items.filter((i) => i.type === 'restaurant').every((i) => i.selectionSource === 'pool')).toBe(true);

    const restaurantNames = day.items
      .filter((i) => i.type === 'restaurant')
      .map((i) => i.restaurant?.name || i.locationName);
    expect(new Set(restaurantNames).size).toBe(restaurantNames.length);
    expect(day.scheduleDiagnostics?.outlierRestaurantsCount).toBe(0);
  });

  it('rebalances adjacent day load by moving an optional activity', () => {
    const day1: TripDay = {
      dayNumber: 1,
      date: new Date('2026-03-01T00:00:00.000Z'),
      geoDiagnostics: { maxLegKm: 2, p95LegKm: 1.5, totalTravelMin: 80 },
      items: [
        { ...baseActivity('d1-a1', '09:00', '11:00', 48.8606, 2.3376), mustSee: true },
        baseActivity('d1-a2', '11:20', '13:00', 48.861, 2.338),
        baseActivity('d1-a3', '14:00', '15:40', 48.872, 2.295),
        baseActivity('d1-a4', '16:00', '18:00', 48.862, 2.339),
      ],
    };

    const day2: TripDay = {
      dayNumber: 2,
      date: new Date('2026-03-02T00:00:00.000Z'),
      geoDiagnostics: { maxLegKm: 1.2, p95LegKm: 1.0, totalTravelMin: 20 },
      items: [
        baseActivity('d2-a1', '10:00', '12:00', 48.873, 2.296),
      ],
    };

    const moved = rebalanceAdjacentDayLoad([day1, day2]);
    expect(moved).toBeGreaterThan(0);
    expect(day2.items.filter((item) => item.type === 'activity').length).toBe(2);
    expect(day1.items.some((item) => item.id === 'd1-a1')).toBe(true); // must-see remains in source day
    expect(day1.scheduleDiagnostics?.loadRebalanced).toBe(true);
    expect(day2.scheduleDiagnostics?.loadRebalanced).toBe(true);
  });
});
