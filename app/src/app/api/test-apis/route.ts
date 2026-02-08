/**
 * API Route: /api/test-apis
 *
 * Teste toutes les APIs du projet avec des requêtes réelles
 * Retourne les résultats catégorisés avec liens et données
 */

import { NextResponse } from 'next/server';
import { searchFlights } from '@/lib/services/flights';
import { searchRestaurants } from '@/lib/services/restaurants';
import { searchHotels } from '@/lib/services/hotels';
import { searchViatorActivities } from '@/lib/services/viator';
import { compareTransportOptions } from '@/lib/services/transport';
import { getDirections } from '@/lib/services/directions';

// Test destination: Paris → Barcelona (popular, lots of data)
const TEST_CONFIG = {
  origin: 'Paris',
  originCoords: { lat: 48.8566, lng: 2.3522 },
  originAirport: 'CDG',
  destination: 'Barcelona',
  destCoords: { lat: 41.3851, lng: 2.1734 },
  destAirport: 'BCN',
  // Dates dynamiques: dans 30 jours pour 4 nuits
  get departureDate() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  },
  get returnDate() {
    const d = new Date();
    d.setDate(d.getDate() + 34);
    return d.toISOString().split('T')[0];
  },
  get checkInDate() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d;
  },
  get checkOutDate() {
    const d = new Date();
    d.setDate(d.getDate() + 34);
    return d;
  },
  adults: 2,
};

interface TestResult {
  category: string;
  name: string;
  status: 'ok' | 'error' | 'not_configured';
  latencyMs: number;
  count?: number;
  items?: any[];
  error?: string;
}

async function testFlights(): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await searchFlights({
      originCode: TEST_CONFIG.originAirport,
      destinationCode: TEST_CONFIG.destAirport,
      departureDate: TEST_CONFIG.departureDate,
      returnDate: TEST_CONFIG.returnDate,
      adults: TEST_CONFIG.adults,
    });
    const latencyMs = Date.now() - start;
    const allFlights = [...result.outboundFlights, ...result.returnFlights];
    return {
      category: 'transport',
      name: 'Vols (SerpAPI/Gemini)',
      status: allFlights.length > 0 ? 'ok' : 'error',
      latencyMs,
      count: allFlights.length,
      items: allFlights.slice(0, 3).map(f => ({
        type: 'flight',
        title: `${f.airline} ${f.flightNumber}`,
        subtitle: `${f.departureAirportCode} ${f.departureTimeDisplay} → ${f.arrivalAirportCode} ${f.arrivalTimeDisplay}`,
        price: `${f.price}€/pers`,
        duration: `${Math.floor(f.duration / 60)}h${String(f.duration % 60).padStart(2, '0')}`,
        stops: f.stops === 0 ? 'Direct' : `${f.stops} escale(s)`,
        link: f.bookingUrl || null,
        linkLabel: 'Voir sur Aviasales',
      })),
      error: result.error,
    };
  } catch (err: any) {
    return { category: 'transport', name: 'Vols (SerpAPI/Gemini)', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

async function testTrains(): Promise<TestResult> {
  const start = Date.now();
  try {
    const options = await compareTransportOptions({
      origin: TEST_CONFIG.origin,
      originCoords: TEST_CONFIG.originCoords,
      destination: TEST_CONFIG.destination,
      destCoords: TEST_CONFIG.destCoords,
      date: TEST_CONFIG.checkInDate,
      passengers: TEST_CONFIG.adults,
    });
    const latencyMs = Date.now() - start;
    return {
      category: 'transport',
      name: 'Trains / Bus / Voiture (Rome2Rio)',
      status: options.length > 0 ? 'ok' : 'error',
      latencyMs,
      count: options.length,
      items: options.slice(0, 4).map(o => ({
        type: 'transport',
        title: `${o.mode === 'train' ? 'Train' : o.mode === 'bus' ? 'Bus' : o.mode === 'car' ? 'Voiture' : o.mode === 'plane' ? 'Avion' : o.mode === 'combined' ? 'Combiné' : o.mode}`,
        subtitle: o.segments.map(s => `${s.from} → ${s.to}`).join(' | '),
        price: `${o.totalPrice}€`,
        duration: `${Math.floor(o.totalDuration / 60)}h${String(o.totalDuration % 60).padStart(2, '0')}`,
        co2: `${o.totalCO2.toFixed(1)} kg CO2`,
        recommended: o.recommended,
        link: o.bookingUrl || null,
        linkLabel: o.mode === 'train' ? 'Réserver (Omio/SNCF)' : o.mode === 'bus' ? 'Réserver (FlixBus)' : 'Voir',
        transitLegs: o.transitLegs?.slice(0, 3).map(l => ({
          line: l.line || l.operator || l.mode,
          from: l.from,
          to: l.to,
          departure: l.departure,
          arrival: l.arrival,
        })),
      })),
    };
  } catch (err: any) {
    return { category: 'transport', name: 'Trains / Bus / Voiture', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

async function testHotels(): Promise<TestResult> {
  const start = Date.now();
  try {
    const hotels = await searchHotels(TEST_CONFIG.destination, {
      budgetLevel: 'moderate',
      cityCenter: TEST_CONFIG.destCoords,
      checkInDate: TEST_CONFIG.checkInDate,
      checkOutDate: TEST_CONFIG.checkOutDate,
      guests: TEST_CONFIG.adults,
    });
    const latencyMs = Date.now() - start;
    return {
      category: 'hebergement',
      name: 'Hotels (Booking.com/SerpAPI)',
      status: hotels.length > 0 ? 'ok' : 'error',
      latencyMs,
      count: hotels.length,
      items: hotels.slice(0, 3).map(h => ({
        type: 'hotel',
        title: h.name,
        subtitle: `${'★'.repeat(h.stars || 0)} · ${h.type} · ${h.address}`,
        price: `${h.pricePerNight}€/nuit${h.totalPrice ? ` (total: ${h.totalPrice}€)` : ''}`,
        rating: h.rating ? `${h.rating}/10 (${h.reviewCount} avis)` : null,
        amenities: h.amenities?.slice(0, 5)?.join(', '),
        link: h.bookingUrl || null,
        linkLabel: 'Voir sur Booking.com',
      })),
    };
  } catch (err: any) {
    return { category: 'hebergement', name: 'Hotels (Booking.com/SerpAPI)', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

async function testRestaurants(): Promise<TestResult> {
  const start = Date.now();
  try {
    const restaurants = await searchRestaurants({
      latitude: TEST_CONFIG.destCoords.lat,
      longitude: TEST_CONFIG.destCoords.lng,
      destination: TEST_CONFIG.destination,
      mealType: 'dinner',
      limit: 10,
    });
    const latencyMs = Date.now() - start;
    const priceLevels: Record<number, string> = { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' };
    return {
      category: 'restaurants',
      name: 'Restaurants (Gemini/SerpAPI/Google Places)',
      status: restaurants.length > 0 ? 'ok' : 'error',
      latencyMs,
      count: restaurants.length,
      items: restaurants.slice(0, 4).map(r => ({
        type: 'restaurant',
        title: r.name,
        subtitle: (r.cuisineTypes?.filter(c => c !== 'none' && c !== 'unknown')?.join(', ')) || 'Restaurant',
        price: priceLevels[r.priceLevel] || '€€',
        rating: r.rating ? `${parseFloat(r.rating.toFixed(1))}/5 (${r.reviewCount || 0} avis)` : null,
        address: r.address,
        link: r.googleMapsUrl || r.reservationUrl || null,
        linkLabel: r.reservationUrl ? 'Réserver (TheFork)' : 'Voir sur Google Maps',
        reservationLink: r.reservationUrl || null,
      })),
    };
  } catch (err: any) {
    return { category: 'restaurants', name: 'Restaurants (Gemini/SerpAPI)', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

async function testActivities(): Promise<TestResult> {
  const start = Date.now();
  try {
    const activities = await searchViatorActivities(
      TEST_CONFIG.destination,
      TEST_CONFIG.destCoords,
      { limit: 15 }
    );
    const latencyMs = Date.now() - start;
    return {
      category: 'activites',
      name: 'Activités (Viator)',
      status: activities.length > 0 ? 'ok' : 'error',
      latencyMs,
      count: activities.length,
      items: activities.slice(0, 4).map(a => ({
        type: 'activity',
        title: a.name,
        subtitle: a.type || 'Activité',
        price: a.estimatedCost ? `${a.estimatedCost}€` : 'Prix variable',
        rating: a.rating ? `${a.rating}/5 (${a.reviewCount || 0} avis)` : null,
        duration: a.duration ? `${a.duration} min` : null,
        link: a.bookingUrl || null,
        linkLabel: 'Réserver sur Viator',
      })),
    };
  } catch (err: any) {
    return { category: 'activites', name: 'Activités (Viator)', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

async function testDirections(): Promise<TestResult> {
  const start = Date.now();
  try {
    // Test: centre de Barcelona → Sagrada Familia
    const result = await getDirections({
      from: TEST_CONFIG.destCoords,
      to: { lat: 41.4036, lng: 2.1744 },
      mode: 'transit',
    });
    const latencyMs = Date.now() - start;
    return {
      category: 'maps',
      name: 'Directions (Google Maps)',
      status: 'ok',
      latencyMs,
      count: result.steps.length,
      items: [{
        type: 'direction',
        title: `Centre → Sagrada Familia`,
        subtitle: `${result.distance.toFixed(1)} km · ${result.duration} min (${result.source})`,
        link: result.googleMapsUrl,
        linkLabel: 'Voir sur Google Maps',
        transitLines: result.transitLines.map(t => `${t.mode} ${t.number}`).join(', ') || 'À pied',
      }],
    };
  } catch (err: any) {
    return { category: 'maps', name: 'Directions (Google Maps)', status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

export async function GET() {
  const startTotal = Date.now();

  // Lancer tous les tests en parallèle
  const results = await Promise.allSettled([
    testFlights(),
    testTrains(),
    testHotels(),
    testRestaurants(),
    testActivities(),
    testDirections(),
  ]);

  const testResults = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      category: ['transport', 'transport', 'hebergement', 'restaurants', 'activites', 'maps'][i],
      name: ['Vols', 'Trains', 'Hotels', 'Restaurants', 'Activités', 'Directions'][i],
      status: 'error' as const,
      latencyMs: 0,
      error: r.reason?.message || 'Unknown error',
    };
  });

  return NextResponse.json({
    testRoute: `${TEST_CONFIG.origin} → ${TEST_CONFIG.destination}`,
    dates: `${TEST_CONFIG.departureDate} → ${TEST_CONFIG.returnDate}`,
    travelers: TEST_CONFIG.adults,
    totalLatencyMs: Date.now() - startTotal,
    results: testResults,
  });
}
