import { injectHotelBookends } from '../utils/hotel-bookends';
import type { TripDay, TripItem, Accommodation } from '../../types';

function makeHotel(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    name: 'Test Hotel',
    type: 'hotel',
    address: 'Rome',
    latitude: 41.9028,
    longitude: 12.4964,
    pricePerNight: 100,
    totalPrice: 300,
    rating: 4.5,
    amenities: [],
    photos: [],
    bookingUrl: '',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    ...overrides,
  } as Accommodation;
}

function makeItem(overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: 'item-' + Math.random().toString(16).slice(2),
    dayNumber: 1,
    startTime: '10:00',
    endTime: '11:00',
    type: 'activity',
    title: 'Activity',
    description: '',
    locationName: 'Activity Location',
    latitude: 41.89,    // Colisée, ~1.5 km de l'hôtel test
    longitude: 12.4922,
    orderIndex: 0,
    duration: 60,
    ...overrides,
  } as TripItem;
}

function makeDay(items: TripItem[], dayNumber = 2): TripDay {
  return {
    dayNumber,
    date: new Date('2026-05-02'),
    items,
    theme: '',
  } as TripDay;
}

describe('injectHotelBookends', () => {
  it('skips when hotel is null', () => {
    const day = makeDay([makeItem()]);
    const stats = injectHotelBookends([day], null);
    expect(stats.injected).toBe(0);
    expect(day.items.length).toBe(1);
  });

  it('inserts hotel_depart before first activity on day 2 (no arrival transport)', () => {
    const hotel = makeHotel();
    const day = makeDay([makeItem()]);
    const stats = injectHotelBookends([day], hotel);
    expect(stats.injected).toBeGreaterThanOrEqual(1);
    expect(day.items[0].transportRole).toBe('hotel_depart');
    expect(day.items[0].type).toBe('transport');
  });

  it('inserts hotel_return after last activity on day 2', () => {
    const hotel = makeHotel();
    const day = makeDay([makeItem()]);
    injectHotelBookends([day], hotel);
    const lastItem = day.items[day.items.length - 1];
    expect(lastItem.transportRole).toBe('hotel_return');
    expect(lastItem.type).toBe('transport');
  });

  it('skips hotel_depart if first item is already an outbound longhaul transport (day 1)', () => {
    const hotel = makeHotel();
    const arrivalFlight: TripItem = makeItem({
      type: 'flight',
      title: 'Vol CDG → FCO',
      transportRole: 'longhaul',
      transportDirection: 'outbound',
      startTime: '08:00',
      endTime: '11:00',
    });
    const activity = makeItem({ startTime: '14:00', endTime: '15:30' });
    const day = makeDay([arrivalFlight, activity], 1);
    injectHotelBookends([day], hotel);
    const hasHotelDepart = day.items.some(it => it.transportRole === 'hotel_depart');
    expect(hasHotelDepart).toBe(false);
  });

  it('skips hotel_return if the last item is a return longhaul transport', () => {
    const hotel = makeHotel();
    const activity = makeItem({ startTime: '10:00', endTime: '11:30' });
    const returnFlight: TripItem = makeItem({
      type: 'flight',
      title: 'Vol FCO → CDG',
      transportRole: 'longhaul',
      transportDirection: 'return',
      startTime: '17:00',
      endTime: '20:00',
    });
    const day = makeDay([activity, returnFlight], 4);
    injectHotelBookends([day], hotel);
    const hasHotelReturn = day.items.some(it => it.transportRole === 'hotel_return');
    expect(hasHotelReturn).toBe(false);
  });

  it('skips bookends if activity is within 200m of the hotel', () => {
    const hotel = makeHotel();
    const nearbyActivity = makeItem({
      latitude: 41.9029, // ~11 m away
      longitude: 12.4965,
    });
    const day = makeDay([nearbyActivity]);
    const stats = injectHotelBookends([day], hotel);
    expect(stats.injected).toBe(0);
  });

  it('assigns correct transportMode (walking) for short distance', () => {
    const hotel = makeHotel();
    const walkableActivity = makeItem({
      latitude: 41.9033, // ~500 m away → walking
      longitude: 12.5015,
    });
    const day = makeDay([walkableActivity]);
    injectHotelBookends([day], hotel);
    const depart = day.items.find(it => it.transportRole === 'hotel_depart');
    expect(depart?.transportMode).toBe('walking');
  });

  it('reindexes orderIndex after insertion', () => {
    const hotel = makeHotel();
    const a1 = makeItem({ startTime: '10:00', endTime: '11:00', title: 'A1' });
    const a2 = makeItem({ startTime: '13:00', endTime: '14:00', title: 'A2' });
    const day = makeDay([a1, a2]);
    injectHotelBookends([day], hotel);
    day.items.forEach((it, idx) => {
      expect(it.orderIndex).toBe(idx);
    });
  });
});
