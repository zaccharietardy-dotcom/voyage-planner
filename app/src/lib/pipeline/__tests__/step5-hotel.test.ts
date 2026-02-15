import { selectHotelByBarycenter } from '../step5-hotel';
import type { Accommodation } from '../../types';
import type { ActivityCluster } from '../types';

function makeHotel(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  rating: number,
  pricePerNight: number
): Accommodation {
  return {
    id,
    name,
    type: 'hotel',
    address: 'Address',
    latitude,
    longitude,
    rating,
    reviewCount: 100,
    stars: 3,
    pricePerNight,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
  };
}

function makeCluster(points: Array<{ lat: number; lng: number }>): ActivityCluster {
  return {
    dayNumber: 1,
    centroid: {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    },
    totalIntraDistance: 0,
    activities: points.map((point, index) => ({
      id: `a-${index}`,
      name: `Activity ${index}`,
      latitude: point.lat,
      longitude: point.lng,
    } as any)),
  };
}

describe('step5-hotel selection', () => {
  const clusters: ActivityCluster[] = [
    makeCluster([
      { lat: 41.9010, lng: 12.4920 },
      { lat: 41.9040, lng: 12.4980 },
      { lat: 41.8990, lng: 12.4860 },
    ]),
  ];

  it('prefers central hotels over high-rated excentré ones', () => {
    const hotels: Accommodation[] = [
      makeHotel('far', "Annie's Home", 42.0117, 12.3707, 9.2, 55), // ~15km away
      makeHotel('center-a', 'Roma Centro A', 41.9025, 12.4930, 8.3, 110), // ~0.1km
      makeHotel('center-b', 'Roma Centro B', 41.9090, 12.5000, 8.8, 120), // ~1km
    ];

    const selected = selectHotelByBarycenter(clusters, hotels, 'moderate');
    expect(selected?.id).toBe('center-a');
  });

  it('keeps only nearest slice when all options are far', () => {
    const hotels: Accommodation[] = [
      makeHotel('d9', 'Rome East', 41.9700, 12.5600, 8.5, 90),   // ~9km
      makeHotel('d10', 'Rome North', 41.9850, 12.5000, 9.1, 95), // ~10km
      makeHotel('d19', 'Rome Outside', 42.0500, 12.6500, 9.6, 80), // ~19km
      makeHotel('d22', 'Rome Very Far', 42.1000, 12.7000, 9.8, 75), // ~22km
    ];

    const selected = selectHotelByBarycenter(clusters, hotels, 'moderate');
    expect(['d9', 'd10']).toContain(selected?.id);
  });
});
