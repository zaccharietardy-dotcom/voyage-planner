/**
 * Tests for reservation link generation (Bug #10)
 *
 * Requirements:
 * - Links must include dynamic dates (check-in, check-out, flight date)
 * - Restaurant: Google Maps URL
 * - Hotel: Booking.com with dates
 * - Flight: Google Flights with exact dates
 * - Attraction: Official site or Google Maps
 */

import {
  generateRestaurantLink,
  generateHotelLink,
  generateFlightLink,
  generateAttractionLink,
  generateReservationLink,
  formatDateForUrl,
  formatDateForBooking,
} from '../services/linkGenerator';

describe('Link Generator (Bug #10)', () => {
  describe('formatDateForUrl', () => {
    it('formats date as YYYY-MM-DD', () => {
      expect(formatDateForUrl('2026-01-28')).toBe('2026-01-28');
    });

    it('handles Date object', () => {
      const date = new Date('2026-01-28');
      expect(formatDateForUrl(date)).toBe('2026-01-28');
    });

    it('returns empty string for invalid date', () => {
      expect(formatDateForUrl('')).toBe('');
      expect(formatDateForUrl(null as unknown as string)).toBe('');
    });
  });

  describe('formatDateForBooking', () => {
    it('formats date for Booking.com (YYYY-MM-DD)', () => {
      expect(formatDateForBooking('2026-01-28')).toBe('2026-01-28');
    });
  });

  describe('generateRestaurantLink', () => {
    it('generates Google Maps link for restaurant', () => {
      const restaurant = {
        name: 'Quimet & Quimet',
        address: 'Carrer del Poeta Cabanyes, 25, Barcelona',
      };

      const link = generateRestaurantLink(restaurant);

      expect(link).toContain('google.com/maps/search');
      expect(link).toContain('Quimet');
      expect(link).toContain('Barcelona');
    });

    it('uses Google Maps place URL if placeId provided', () => {
      const restaurant = {
        name: 'Restaurant',
        address: 'Some Address',
        placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      };

      const link = generateRestaurantLink(restaurant);

      expect(link).toContain('google.com/maps/place');
      expect(link).toContain('ChIJN1t_tDeuEmsRUsoyG83frY4');
    });

    it('encodes special characters in URL', () => {
      const restaurant = {
        name: 'Café & Bar',
        address: 'Carrer d\'Aragó 255, Barcelona',
      };

      const link = generateRestaurantLink(restaurant);

      // Should be URL encoded
      expect(link).not.toContain(' ');
      expect(link).toContain('Caf');
    });
  });

  describe('generateHotelLink', () => {
    it('generates Booking.com link with check-in/check-out dates', () => {
      const hotel = {
        name: 'Hotel Arts Barcelona',
        city: 'Barcelona',
      };

      const context = {
        checkIn: '2026-01-28',
        checkOut: '2026-01-31',
      };

      const link = generateHotelLink(hotel, context);

      expect(link).toContain('booking.com');
      expect(link).toContain('checkin=2026-01-28');
      expect(link).toContain('checkout=2026-01-31');
      expect(link).toContain('Barcelona');
    });

    it('includes hotel name in search query', () => {
      const hotel = {
        name: 'W Barcelona',
        city: 'Barcelona',
      };

      const context = {
        checkIn: '2026-02-01',
        checkOut: '2026-02-05',
      };

      const link = generateHotelLink(hotel, context);

      // URLSearchParams encodes spaces as '+' which is valid
      expect(link).toMatch(/W[+%20]Barcelona/);
    });

    it('handles missing dates gracefully', () => {
      const hotel = {
        name: 'Hotel',
        city: 'Barcelona',
      };

      const link = generateHotelLink(hotel, {});

      expect(link).toContain('booking.com');
      expect(link).toContain('Barcelona');
      // Should not crash without dates
    });
  });

  describe('generateFlightLink', () => {
    it('generates Google Flights link with origin, destination, and date', () => {
      const flight = {
        origin: 'CDG',
        destination: 'BCN',
      };

      const context = {
        date: '2026-01-28',
      };

      const link = generateFlightLink(flight, context);

      expect(link).toContain('google.com/travel/flights');
      expect(link).toContain('CDG');
      expect(link).toContain('BCN');
      expect(link).toContain('2026-01-28');
    });

    it('supports round trip flights', () => {
      const flight = {
        origin: 'CDG',
        destination: 'BCN',
      };

      const context = {
        date: '2026-01-28',
        returnDate: '2026-01-31',
      };

      const link = generateFlightLink(flight, context);

      expect(link).toContain('2026-01-28');
      expect(link).toContain('2026-01-31');
    });

    it('handles city names as well as airport codes', () => {
      const flight = {
        origin: 'Paris',
        destination: 'Barcelona',
      };

      const context = {
        date: '2026-01-28',
      };

      const link = generateFlightLink(flight, context);

      expect(link).toContain('Paris');
      expect(link).toContain('Barcelona');
    });
  });

  describe('generateAttractionLink', () => {
    it('uses official website if provided', () => {
      const attraction = {
        name: 'Sagrada Familia',
        address: 'Carrer de Mallorca, 401, Barcelona',
        website: 'https://sagradafamilia.org',
      };

      const link = generateAttractionLink(attraction);

      expect(link).toBe('https://sagradafamilia.org');
    });

    it('falls back to Google Maps if no website', () => {
      const attraction = {
        name: 'Park Güell',
        address: 'Carrer d\'Olot, Barcelona',
      };

      const link = generateAttractionLink(attraction);

      expect(link).toContain('google.com/maps/search');
      expect(link).toContain('Park');
      expect(link).toContain('Barcelona');
    });

    it('uses placeId if available', () => {
      const attraction = {
        name: 'La Boqueria',
        address: 'La Rambla, 91, Barcelona',
        placeId: 'ChIJNzV6bIuipBIRaHGySaPK',
      };

      const link = generateAttractionLink(attraction);

      expect(link).toContain('ChIJNzV6bIuipBIRaHGySaPK');
    });
  });

  describe('generateReservationLink', () => {
    it('generates restaurant link', () => {
      const element = {
        type: 'restaurant' as const,
        name: 'El Xampanyet',
        address: 'Carrer de Montcada, 22, Barcelona',
      };

      const link = generateReservationLink(element, {});

      expect(link).toContain('google.com/maps');
    });

    it('generates hotel link with dates', () => {
      const element = {
        type: 'hotel' as const,
        name: 'Mandarin Oriental',
        city: 'Barcelona',
      };

      const context = {
        checkIn: '2026-01-28',
        checkOut: '2026-01-31',
      };

      const link = generateReservationLink(element, context);

      expect(link).toContain('booking.com');
      expect(link).toContain('2026-01-28');
    });

    it('generates flight link with date', () => {
      const element = {
        type: 'flight' as const,
        origin: 'CDG',
        destination: 'BCN',
      };

      const context = {
        date: '2026-01-28',
      };

      const link = generateReservationLink(element, context);

      expect(link).toContain('google.com/travel/flights');
    });

    it('generates attraction link', () => {
      const element = {
        type: 'attraction' as const,
        name: 'Museu Picasso',
        address: 'Carrer de Montcada, 15-23, Barcelona',
      };

      const link = generateReservationLink(element, {});

      expect(link).toContain('google.com/maps');
    });
  });

  describe('Real-world scenarios', () => {
    it('generates complete itinerary links for Barcelona trip', () => {
      const tripContext = {
        checkIn: '2026-01-28',
        checkOut: '2026-01-31',
      };

      // Flight
      const flightLink = generateFlightLink(
        { origin: 'CDG', destination: 'BCN' },
        { date: '2026-01-28' }
      );
      expect(flightLink).toContain('CDG');
      expect(flightLink).toContain('BCN');

      // Hotel
      const hotelLink = generateHotelLink(
        { name: 'Hotel Arts', city: 'Barcelona' },
        tripContext
      );
      expect(hotelLink).toContain('checkin=2026-01-28');
      expect(hotelLink).toContain('checkout=2026-01-31');

      // Restaurant
      const restaurantLink = generateRestaurantLink({
        name: 'Can Paixano',
        address: 'Carrer de la Reina Cristina, 7, Barcelona',
      });
      expect(restaurantLink).toContain('Can%20Paixano');

      // Attraction
      const attractionLink = generateAttractionLink({
        name: 'La Pedrera',
        address: 'Passeig de Gràcia, 92, Barcelona',
        website: 'https://www.lapedrera.com',
      });
      expect(attractionLink).toBe('https://www.lapedrera.com');
    });

    it('all links are valid URLs', () => {
      const links = [
        generateRestaurantLink({ name: 'Test', address: 'Test Address' }),
        generateHotelLink({ name: 'Test Hotel', city: 'Paris' }, { checkIn: '2026-01-01', checkOut: '2026-01-02' }),
        generateFlightLink({ origin: 'CDG', destination: 'BCN' }, { date: '2026-01-01' }),
        generateAttractionLink({ name: 'Test Attraction', address: 'Test Address' }),
      ];

      for (const link of links) {
        expect(() => new URL(link)).not.toThrow();
      }
    });
  });
});
