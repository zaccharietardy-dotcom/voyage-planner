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
    expect(url).toContain('group_children=0');
    expect(url).toContain('no_rooms=1');
    expect(url).toContain('aid=304142');
  });

  it('keeps booking search URL and injects dates/adults', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.booking.com/searchresults.html?ss=Hotel+V+Nesplein+Amsterdam',
      hotelName: 'Hotel V Nesplein Amsterdam',
      destinationHint: 'Amsterdam',
      checkIn: '2026-05-02',
      checkOut: '2026-05-05',
      adults: 2,
    });

    expect(isBookingSearchUrl(url)).toBe(true);
    expect(isBookingHotelPath(url)).toBe(false);
    expect(url).toContain('searchresults.html');
    expect(url).toContain('ss=Hotel+V+Nesplein+Amsterdam');
    expect(url).toContain('checkin=2026-05-02');
    expect(url).toContain('checkout=2026-05-05');
    expect(url).toContain('group_adults=2');
    expect(url).toContain('group_children=0');
  });

  it('builds booking search URL when missing url', () => {
    const url = normalizeHotelBookingUrl({
      hotelName: 'The Dylan Amsterdam',
      destinationHint: 'Amsterdam',
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
      adults: 2,
    });

    expect(url).toContain('booking.com/searchresults.html');
    expect(url).toContain('ss=The+Dylan+Amsterdam+Amsterdam');
    expect(url).toContain('checkin=2026-06-01');
    expect(url).toContain('checkout=2026-06-03');
    expect(url).toContain('group_adults=2');
    expect(url).toContain('group_children=0');
  });

  it('enriches airbnb room url with dates/adults when missing', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.airbnb.com/rooms/123456789',
      hotelName: 'Apartment',
      destinationHint: 'Barcelona',
      checkIn: '2026-04-10',
      checkOut: '2026-04-12',
      adults: 2,
    });

    expect(url).toContain('airbnb.com/rooms/123456789');
    expect(url).toContain('check_in=2026-04-10');
    expect(url).toContain('check_out=2026-04-12');
    expect(url).toContain('adults=2');
  });

  it('keeps direct airbnb room url with dates/adults unchanged', () => {
    const input = 'https://www.airbnb.com/rooms/987654321?check_in=2026-05-20&check_out=2026-05-24&adults=2';
    const url = normalizeHotelBookingUrl({
      url: input,
      hotelName: 'Appartement Airbnb',
      destinationHint: 'Paris',
      checkIn: '2026-06-01',
      checkOut: '2026-06-03',
      adults: 4,
    });

    expect(url).toBe(input);
    expect(url).toContain('check_in=2026-05-20');
    expect(url).toContain('check_out=2026-05-24');
    expect(url).toContain('adults=2');
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
    expect(url).toContain('group_children=0');
  });

  it('falls back to resilient booking search URL for non-canonical hotel paths', () => {
    const url = normalizeHotelBookingUrl({
      url: 'https://www.booking.com/fr/hotel/lausanne-crissier?utm_source=googlemaps',
      hotelName: 'Hotel Royal Savoy Lausanne',
      destinationHint: 'Lausanne',
      checkIn: '2026-02-20',
      checkOut: '2026-02-22',
      adults: 2,
    });

    expect(isBookingSearchUrl(url)).toBe(true);
    expect(url).toContain('searchresults.html');
    expect(url).toContain('ss=Hotel+Royal+Savoy+Lausanne+Lausanne');
    expect(url).toContain('checkin=2026-02-20');
    expect(url).toContain('checkout=2026-02-22');
    expect(url).toContain('group_adults=2');
  });
});
