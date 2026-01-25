/**
 * Tests d'INTÉGRATION des vols RÉELS
 *
 * Ces tests vérifient que l'API Amadeus retourne de VRAIS vols.
 * ILS BLOQUENT si les vols ne sont pas valides.
 *
 * Pour lancer ces tests:
 * npm test -- src/lib/__tests__/flightIntegration.test.ts
 */

import { validateFlight, isValidFlightNumber, FlightToValidate } from './flightValidation.test';

// Ces tests nécessitent les variables d'environnement
const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

const isAmadeusConfigured = !!(AMADEUS_API_KEY && AMADEUS_API_SECRET);

describe('Flight Integration - REAL API TESTS', () => {

  // Skip all tests if Amadeus is not configured
  (isAmadeusConfigured ? describe : describe.skip)('Amadeus API Integration', () => {

    let accessToken: string | null = null;

    beforeAll(async () => {
      // Get Amadeus access token
      try {
        const tokenResponse = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `grant_type=client_credentials&client_id=${AMADEUS_API_KEY}&client_secret=${AMADEUS_API_SECRET}`,
        });

        if (tokenResponse.ok) {
          const data = await tokenResponse.json();
          accessToken = data.access_token;
        }
      } catch (error) {
        console.error('Failed to get Amadeus token:', error);
      }
    }, 30000);

    it('devrait obtenir un token Amadeus valide', () => {
      expect(accessToken).toBeTruthy();
      expect(typeof accessToken).toBe('string');
      expect(accessToken!.length).toBeGreaterThan(10);
    });

    it('devrait trouver des vols RÉELS Paris → Barcelone', async () => {
      if (!accessToken) {
        throw new Error('Amadeus token not available');
      }

      // Chercher des vols dans 30 jours
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const departureDate = futureDate.toISOString().split('T')[0];

      const searchParams = new URLSearchParams({
        originLocationCode: 'CDG',
        destinationLocationCode: 'BCN',
        departureDate,
        adults: '1',
        currencyCode: 'EUR',
        max: '5',
      });

      const response = await fetch(
        `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);

      // On doit trouver au moins 1 vol
      expect(data.data.length).toBeGreaterThan(0);

      // Valider chaque vol retourné
      for (const offer of data.data) {
        for (const itinerary of offer.itineraries || []) {
          const segments = itinerary.segments || [];
          expect(segments.length).toBeGreaterThan(0);

          const firstSegment = segments[0];
          const lastSegment = segments[segments.length - 1];

          const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;

          // VALIDATION BLOQUANTE: Le numéro de vol doit être valide
          const flightValidation = isValidFlightNumber(flightNumber);
          expect(flightValidation.valid).toBe(true);

          // Les codes aéroports doivent être valides
          expect(firstSegment.departure.iataCode).toMatch(/^[A-Z]{3}$/);
          expect(lastSegment.arrival.iataCode).toMatch(/^[A-Z]{3}$/);

          console.log(`✅ Vol réel trouvé: ${flightNumber} ${firstSegment.departure.iataCode} → ${lastSegment.arrival.iataCode}`);
        }
      }
    }, 30000);

    it('devrait trouver des vols RÉELS Paris → Rome', async () => {
      if (!accessToken) {
        throw new Error('Amadeus token not available');
      }

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45);
      const departureDate = futureDate.toISOString().split('T')[0];

      const searchParams = new URLSearchParams({
        originLocationCode: 'CDG',
        destinationLocationCode: 'FCO',
        departureDate,
        adults: '1',
        currencyCode: 'EUR',
        max: '5',
      });

      const response = await fetch(
        `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.data.length).toBeGreaterThan(0);

      const firstOffer = data.data[0];
      const firstSegment = firstOffer.itineraries[0].segments[0];
      const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;

      const validation = isValidFlightNumber(flightNumber);
      expect(validation.valid).toBe(true);

      console.log(`✅ Vol réel Paris → Rome: ${flightNumber}`);
    }, 30000);

    it('devrait retourner des prix réalistes', async () => {
      if (!accessToken) {
        throw new Error('Amadeus token not available');
      }

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const departureDate = futureDate.toISOString().split('T')[0];

      const searchParams = new URLSearchParams({
        originLocationCode: 'CDG',
        destinationLocationCode: 'BCN',
        departureDate,
        adults: '1',
        currencyCode: 'EUR',
        max: '3',
      });

      const response = await fetch(
        `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const data = await response.json();

      for (const offer of data.data) {
        const price = parseFloat(offer.price?.total || '0');

        // Prix réaliste pour un vol court-courrier: 30€ - 500€
        expect(price).toBeGreaterThan(30);
        expect(price).toBeLessThan(500);

        console.log(`✅ Prix réaliste: ${price}€`);
      }
    }, 30000);
  });

  describe('Validation des vols MOCK (doivent ÉCHOUER)', () => {
    it('devrait rejeter un vol inventé', () => {
      const fakeFlights: FlightToValidate[] = [
        { flightNumber: 'FAKE123', departureAirportCode: 'CDG', arrivalAirportCode: 'BCN' },
        { flightNumber: 'AB1234', departureAirportCode: 'CDG', arrivalAirportCode: 'BCN' },
        { flightNumber: 'undefined', departureAirportCode: 'CDG', arrivalAirportCode: 'BCN' },
        { flightNumber: '', departureAirportCode: 'CDG', arrivalAirportCode: 'BCN' },
      ];

      for (const fake of fakeFlights) {
        const result = validateFlight(fake);
        expect(result.valid).toBe(false);
        console.log(`✅ Vol fake rejeté: ${fake.flightNumber}`);
      }
    });

    it('devrait rejeter un vol avec aéroport invalide', () => {
      const invalidAirports: FlightToValidate[] = [
        { flightNumber: 'AF1234', departureAirportCode: 'XX', arrivalAirportCode: 'BCN' },
        { flightNumber: 'AF1234', departureAirportCode: 'CDG', arrivalAirportCode: '123' },
        { flightNumber: 'AF1234', departureAirportCode: '', arrivalAirportCode: 'BCN' },
      ];

      for (const invalid of invalidAirports) {
        const result = validateFlight(invalid);
        expect(result.valid).toBe(false);
        console.log(`✅ Aéroport invalide rejeté: ${invalid.departureAirportCode} → ${invalid.arrivalAirportCode}`);
      }
    });
  });
});

// Fonction utilitaire pour valider les vols avant utilisation dans l'app
export async function assertValidFlights(flights: FlightToValidate[]): Promise<void> {
  const errors: string[] = [];

  for (const flight of flights) {
    const result = validateFlight(flight);
    if (!result.valid) {
      errors.push(`Vol ${flight.flightNumber}: ${result.errors.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`❌ VOLS INVALIDES DÉTECTÉS:\n${errors.join('\n')}`);
  }
}
