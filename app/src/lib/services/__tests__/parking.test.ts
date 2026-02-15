import { buildAirportParkingBookingUrl, searchParkings } from '../parking';

describe('parking service', () => {
  it('adds a booking url for generic airport parkings', () => {
    const parkings = searchParkings('HND', 5);

    expect(parkings.length).toBeGreaterThan(0);
    for (const parking of parkings) {
      expect(parking.bookingUrl).toBeTruthy();
      expect(parking.totalPrice).toBe(parking.pricePerDay * 5);
    }
  });

  it('builds a maps fallback booking url', () => {
    const url = buildAirportParkingBookingUrl('CDG', 'Paris Charles de Gaulle', 'Paris');
    expect(url).toContain('google.com/maps/search/');
    expect(url).toContain('parking');
  });
});
