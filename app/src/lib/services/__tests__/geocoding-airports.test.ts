import { findNearbyAirports } from '../geocoding';

describe('geocoding airport mapping', () => {
  it('maps Lausanne to Swiss airports (and not Los Angeles)', () => {
    const airports = findNearbyAirports('Lausanne');
    expect(airports[0]?.code).toBe('GVA');
    expect(airports.some((airport) => airport.code === 'LAX')).toBe(false);
  });

  it('maps Vevey and Montreux to Geneva airport', () => {
    expect(findNearbyAirports('Vevey')[0]?.code).toBe('GVA');
    expect(findNearbyAirports('Montreux')[0]?.code).toBe('GVA');
  });

  it('still supports LA shorthand and full Los Angeles names', () => {
    expect(findNearbyAirports('LA')[0]?.code).toBe('LAX');
    expect(findNearbyAirports('Los Angeles')[0]?.code).toBe('LAX');
  });
});
