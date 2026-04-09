import { selectTopHotelsByBarycenter } from '../step5-hotel';
import type { Accommodation } from '../../types';
import type { ActivityCluster, ScoredActivity } from '../types';

function makeActivity(overrides: Partial<ScoredActivity>): ScoredActivity {
  return {
    id: 'act-1',
    name: 'Sample Activity',
    type: 'culture',
    description: '',
    duration: 90,
    estimatedCost: 0,
    latitude: 48.39,
    longitude: -2.49,
    rating: 4.5,
    mustSee: true,
    bookingRequired: false,
    openingHours: { open: '09:00', close: '18:00' },
    score: 80,
    source: 'mustsee',
    reviewCount: 1000,
    ...overrides,
  };
}

function makeCluster(activities: ScoredActivity[]): ActivityCluster {
  return {
    dayNumber: 1,
    activities,
    centroid: { lat: 48.39, lng: -2.49 },
    totalIntraDistance: 4,
  };
}

function makeHotel(overrides: Partial<Accommodation>): Accommodation {
  return {
    id: 'hotel-1',
    name: 'Hotel test',
    type: 'hotel',
    address: 'Adresse',
    latitude: 48.40,
    longitude: -2.50,
    rating: 8.4,
    reviewCount: 240,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: ['WiFi'],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    bookingUrl: 'https://www.booking.com/hotel/test',
    ...overrides,
  };
}

describe('step5-hotel distance safety', () => {
  it('filters cross-country hotel candidates when near options exist', () => {
    const clusters = [makeCluster([makeActivity({})])];
    const nearHotel = makeHotel({ id: 'near-1', latitude: 48.41, longitude: -2.48, bookingUrl: 'https://www.booking.com/hotel/near' });
    const farHotel = makeHotel({
      id: 'far-nyc',
      name: 'Cozy Beach Rental 1B/1B',
      latitude: 40.7128,
      longitude: -74.006,
      bookingUrl: 'https://www.airbnb.com/rooms/12345',
    });

    const result = selectTopHotelsByBarycenter(
      clusters,
      [farHotel, nearHotel],
      'moderate',
      undefined,
      4,
      { destination: 'Bretagne' },
      3,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('near-1');
    expect(result.every((hotel) => hotel.id !== 'far-nyc')).toBe(true);
  });

  it('returns centered synthetic fallback when all hotel candidates are far away', () => {
    const clusters = [makeCluster([makeActivity({})])];
    const farHotel = makeHotel({
      id: 'far-only',
      name: 'Remote Listing',
      latitude: 40.7128,
      longitude: -74.006,
      bookingUrl: 'https://www.airbnb.com/rooms/67890',
    });

    const result = selectTopHotelsByBarycenter(
      clusters,
      [farHotel],
      'moderate',
      undefined,
      4,
      { destination: 'Bretagne' },
      3,
    );

    expect(result.length).toBe(1);
    expect(result[0].qualityFlags).toContain('hotel_price_estimated');
    expect(Math.abs((result[0].latitude || 0) - 48.39)).toBeLessThan(0.2);
    expect(Math.abs((result[0].longitude || 0) - (-2.49))).toBeLessThan(0.2);
  });

  it('uses destination coords as center when activity barycenter is unavailable', () => {
    const farHotel = makeHotel({
      id: 'far-nyc',
      name: 'Far Away Listing',
      latitude: 40.7128,
      longitude: -74.006,
      bookingUrl: 'https://www.airbnb.com/rooms/9090',
    });
    const nearDestHotel = makeHotel({
      id: 'near-dest',
      latitude: 48.21,
      longitude: -2.95,
      bookingUrl: 'https://www.booking.com/hotel/near-dest',
    });

    const result = selectTopHotelsByBarycenter(
      [],
      [farHotel, nearDestHotel],
      'moderate',
      undefined,
      4,
      { destination: 'Bretagne', destCoords: { lat: 48.202, lng: -2.932 } },
      3,
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('near-dest');
    expect(result.every((hotel) => hotel.id !== 'far-nyc')).toBe(true);
  });
});
