import {
  addHotelBoundaryTransportItems,
  getTransportModeFromItemData,
  normalizeReturnTransportBookingUrl,
  normalizeSuggestedDayStartHour,
} from '../step7-assemble';
import type { Accommodation, TripItem } from '../../types';

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

  it('uses hotel coordinates for hotel-depart boundary transport', () => {
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

    const depart = withBoundary.find((item) => item.id.startsWith('hotel-depart-1-'));
    expect(depart).toBeDefined();
    expect(depart?.latitude).toBe(hotel.latitude);
    expect(depart?.longitude).toBe(hotel.longitude);
    expect(depart?.transportRole).toBe('hotel_depart');
    expect((depart?.distanceFromPrevious || 0)).toBeGreaterThan(0.1);
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
    expect(withBoundary.some((item) => item.id.startsWith('hotel-depart-1-'))).toBe(true);
  });

  it('caps full-day suggested starts to avoid late starts', () => {
    expect(
      normalizeSuggestedDayStartHour(11, { isFirstDay: false, isLastDay: false, isDayTrip: false })
    ).toBe(8);
  });
});
