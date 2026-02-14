import {
  buildDirectBookingHotelUrl,
  generateBookingHotelSlug,
  isBookingHotelPath,
  isBookingSearchUrl,
  normalizeHotelBookingUrl,
} from '../services/bookingLinks';

describe('bookingLinks', () => {
  it('keeps direct hotel path and injects dates/adults', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.booking.com/hotel/fr/hotel-fouquet-s.fr.html?aid=304142',
      hotelName: 'Hotel Fouquet',
      destinationHint: 'Paris',
      checkIn: '2026-04-10',
      checkOut: '2026-04-12',
      adults: 3,
    });

    expect(isBookingHotelPath(url)).toBe(true);
    expect(url).toContain('checkin=2026-04-10');
    expect(url).toContain('checkout=2026-04-12');
    expect(url).toContain('group_adults=3');
    expect(url).toContain('no_rooms=1');
    expect(url).toContain('aid=304142');
  });

  it('converts booking search URL to direct hotel URL', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.booking.com/searchresults.html?ss=Hotel+V+Nesplein+Amsterdam',
      hotelName: 'Hotel V Nesplein Amsterdam',
      destinationHint: 'Amsterdam',
      checkIn: '2026-05-02',
      checkOut: '2026-05-05',
      adults: 2,
    });

    expect(isBookingSearchUrl(url)).toBe(false);
    expect(isBookingHotelPath(url)).toBe(true);
    expect(url).toContain('/hotel/nl/');
    expect(url).toContain('checkin=2026-05-02');
    expect(url).toContain('checkout=2026-05-05');
    expect(url).not.toContain('searchresults.html');
  });

  it('builds direct hotel URL when missing url', () => {
    const url = normalizeHotelBookingUrl({
      hotelName: 'The Dylan Amsterdam',
      destinationHint: 'Amsterdam',
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
      adults: 2,
    });

    expect(url).toContain('booking.com/hotel/nl/');
    expect(url).toContain('/the-dylan-amsterdam.html');
    expect(url).toContain('checkin=2026-06-01');
    expect(url).toContain('checkout=2026-06-03');
  });

  it('keeps airbnb url unchanged', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.airbnb.com/rooms/123456789',
      hotelName: 'Apartment',
      destinationHint: 'Barcelona',
      checkIn: '2026-04-10',
      checkOut: '2026-04-12',
      adults: 2,
    });

    expect(url).toBe('https://www.airbnb.com/rooms/123456789');
  });

  it('slug generation strips generic tokens and accents', () => {
    const slug = generateBookingHotelSlug('Hôtel Résidence São José');
    expect(slug).toBe('sao-jose');
  });

  it('reuses existing direct path when building direct URL', () => {
    const url = buildDirectBookingHotelUrl({
      hotelName: 'Ignored Name',
      destinationHint: 'Paris',
      checkIn: '2026-07-01',
      checkOut: '2026-07-02',
      adults: 2,
      existingUrl: '/hotel/fr/real-hotel.html?aid=1234',
    });

    expect(url).toContain('/hotel/fr/real-hotel.html');
    expect(url).toContain('aid=1234');
    expect(url).toContain('group_adults=2');
  });
});
