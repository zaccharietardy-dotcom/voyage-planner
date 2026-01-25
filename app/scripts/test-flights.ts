/**
 * Test Battery for REAL Flight Search
 *
 * This script tests the flight search APIs to verify:
 * 1. Real flights are returned (not mock data)
 * 2. Flight numbers follow real airline patterns
 * 3. Booking URLs are specific (not generic Google Flights)
 * 4. Multiple routes work correctly
 *
 * Run with: npx tsx scripts/test-flights.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env.local manually
function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          const value = trimmed.slice(eqIndex + 1).trim();
          process.env[key] = value;
        }
      }
    }
  } catch (e) {
    console.error('Failed to load .env.local:', e);
  }
}

loadEnv();

// Known real airline codes and their flight number patterns
const AIRLINE_PATTERNS: Record<string, { minFlight: number; maxFlight: number }> = {
  'AF': { minFlight: 1, maxFlight: 9999 },      // Air France
  'BA': { minFlight: 1, maxFlight: 9999 },      // British Airways
  'LH': { minFlight: 1, maxFlight: 9999 },      // Lufthansa
  'IB': { minFlight: 1, maxFlight: 9999 },      // Iberia
  'VY': { minFlight: 1000, maxFlight: 9999 },   // Vueling
  'FR': { minFlight: 1, maxFlight: 9999 },      // Ryanair
  'U2': { minFlight: 1000, maxFlight: 9999 },   // easyJet
  'TO': { minFlight: 1000, maxFlight: 9999 },   // Transavia
  'AZ': { minFlight: 1, maxFlight: 9999 },      // ITA Airways
  'TP': { minFlight: 1, maxFlight: 9999 },      // TAP Portugal
  'KL': { minFlight: 1, maxFlight: 9999 },      // KLM
  'LX': { minFlight: 1, maxFlight: 9999 },      // Swiss
  'OS': { minFlight: 1, maxFlight: 9999 },      // Austrian
  'SN': { minFlight: 1, maxFlight: 9999 },      // Brussels Airlines
  'EI': { minFlight: 1, maxFlight: 9999 },      // Aer Lingus
};

// Test routes
const TEST_ROUTES = [
  { origin: 'CDG', destination: 'BCN', name: 'Paris → Barcelona' },
  { origin: 'CDG', destination: 'FCO', name: 'Paris → Rome' },
  { origin: 'CDG', destination: 'LIS', name: 'Paris → Lisbon' },
  { origin: 'ORY', destination: 'BCN', name: 'Paris Orly → Barcelona' },
  { origin: 'CDG', destination: 'MAD', name: 'Paris → Madrid' },
];

interface Flight {
  id: string;
  airline: string;
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  bookingUrl?: string;
}

interface TestResult {
  route: string;
  source: string;
  totalFlights: number;
  validFlights: number;
  invalidFlights: Flight[];
  hasSpecificBookingUrls: boolean;
  sampleFlights: Flight[];
  errors: string[];
}

// Validate flight number format
function isValidFlightNumber(flightNumber: string): { valid: boolean; reason?: string } {
  if (!flightNumber || flightNumber === 'N/A') {
    return { valid: false, reason: 'Missing flight number' };
  }

  // Extract airline code (2 letters) and number
  const match = flightNumber.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!match) {
    return { valid: false, reason: `Invalid format: ${flightNumber}` };
  }

  const [, airlineCode, flightNum] = match;
  const num = parseInt(flightNum);

  // Check if airline is known
  if (!AIRLINE_PATTERNS[airlineCode]) {
    // Unknown airline - still could be valid, just warn
    return { valid: true, reason: `Unknown airline: ${airlineCode}` };
  }

  const pattern = AIRLINE_PATTERNS[airlineCode];
  if (num < pattern.minFlight || num > pattern.maxFlight) {
    return { valid: false, reason: `Flight number ${num} out of range for ${airlineCode}` };
  }

  return { valid: true };
}

// Check if booking URL is specific (not generic)
function isSpecificBookingUrl(url: string | undefined, flight: Flight): boolean {
  if (!url) return false;

  // Generic URLs we want to avoid
  const genericPatterns = [
    /google\.com\/travel\/flights\?q=Flights\+from/,
    /google\.com\/travel\/flights\?q=flights%20from/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(url)) {
      // Check if it at least includes the flight number
      if (flight.flightNumber && url.includes(flight.flightNumber)) {
        return true; // Specific enough - includes flight number
      }
      return false;
    }
  }

  // Specific booking sites
  const specificSites = [
    'kiwi.com',
    'skyscanner',
    'kayak',
    'expedia',
    'booking.com',
    'airfrance.fr',
    'vueling.com',
    'ryanair.com',
    'easyjet.com',
  ];

  for (const site of specificSites) {
    if (url.includes(site)) return true;
  }

  // Google Flights with specific flight number query
  if (url.includes('google.com/travel/flights') && flight.flightNumber) {
    if (url.includes(encodeURIComponent(flight.flightNumber)) || url.includes(flight.flightNumber)) {
      return true;
    }
  }

  return false;
}

// Test SerpAPI
async function testSerpApi(origin: string, destination: string, date: string): Promise<Flight[]> {
  const SERPAPI_KEY = process.env.SERPAPI_KEY?.trim();
  if (!SERPAPI_KEY) {
    console.log('  [SerpAPI] Not configured');
    return [];
  }

  const params = new URLSearchParams({
    api_key: SERPAPI_KEY,
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: date,
    currency: 'EUR',
    hl: 'fr',
    gl: 'fr',
    adults: '1',
  });

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!response.ok) {
      console.log(`  [SerpAPI] HTTP Error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (data.error) {
      console.log(`  [SerpAPI] API Error: ${data.error}`);
      return [];
    }

    const flights: Flight[] = [];
    const allFlights = [...(data.best_flights || []), ...(data.other_flights || [])];

    for (const flightOffer of allFlights.slice(0, 10)) {
      const firstLeg = flightOffer.flights[0];
      const lastLeg = flightOffer.flights[flightOffer.flights.length - 1];
      if (!firstLeg || !lastLeg) continue;

      const flightNum = firstLeg.flight_number || '';
      const specificUrl = flightNum
        ? `https://www.google.com/travel/flights?q=${encodeURIComponent(`${flightNum} ${origin} ${destination} ${date}`)}&curr=EUR`
        : `https://www.google.com/travel/flights?q=flights%20from%20${origin}%20to%20${destination}`;

      flights.push({
        id: `serp-${firstLeg.flight_number}-${date}`,
        airline: firstLeg.flight_number?.slice(0, 2) || 'XX',
        flightNumber: firstLeg.flight_number || 'N/A',
        departureAirportCode: firstLeg.departure_airport.id,
        arrivalAirportCode: lastLeg.arrival_airport.id,
        departureTime: firstLeg.departure_airport.time,
        arrivalTime: lastLeg.arrival_airport.time,
        price: flightOffer.price,
        bookingUrl: specificUrl,
      });
    }

    return flights;
  } catch (error) {
    console.log(`  [SerpAPI] Error: ${error}`);
    return [];
  }
}

// Test Amadeus API
async function testAmadeusApi(origin: string, destination: string, date: string): Promise<Flight[]> {
  const AMADEUS_API_KEY = process.env.AMADEUS_API_KEY;
  const AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET;

  if (!AMADEUS_API_KEY || !AMADEUS_API_SECRET) {
    console.log('  [Amadeus] Not configured (need both KEY and SECRET)');
    return [];
  }

  try {
    // Get token
    const tokenResponse = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${AMADEUS_API_KEY}&client_secret=${AMADEUS_API_SECRET}`,
    });

    if (!tokenResponse.ok) {
      console.log(`  [Amadeus] Token error: ${tokenResponse.status}`);
      return [];
    }

    const { access_token } = await tokenResponse.json();

    // Search flights
    const searchParams = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: date,
      adults: '1',
      currencyCode: 'EUR',
      max: '10',
    });

    const flightsResponse = await fetch(
      `https://test.api.amadeus.com/v2/shopping/flight-offers?${searchParams}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!flightsResponse.ok) {
      const errorText = await flightsResponse.text();
      console.log(`  [Amadeus] Search error: ${flightsResponse.status} - ${errorText.slice(0, 100)}`);
      return [];
    }

    const data = await flightsResponse.json();
    const flights: Flight[] = [];

    for (const offer of data.data || []) {
      for (const itinerary of offer.itineraries || []) {
        const segments = itinerary.segments || [];
        const firstSegment = segments[0];
        const lastSegment = segments[segments.length - 1];
        if (!firstSegment || !lastSegment) continue;

        const flightNumber = `${firstSegment.carrierCode}${firstSegment.number}`;

        flights.push({
          id: `amadeus-${offer.id}`,
          airline: firstSegment.carrierCode,
          flightNumber,
          departureAirportCode: firstSegment.departure.iataCode,
          arrivalAirportCode: lastSegment.arrival.iataCode,
          departureTime: firstSegment.departure.at,
          arrivalTime: lastSegment.arrival.at,
          price: parseFloat(offer.price?.total || '0'),
          bookingUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(`${flightNumber} ${origin} ${destination} ${date}`)}&curr=EUR`,
        });
      }
    }

    return flights;
  } catch (error) {
    console.log(`  [Amadeus] Error: ${error}`);
    return [];
  }
}

// Main test function
async function runTests() {
  console.log('='.repeat(60));
  console.log('FLIGHT SEARCH API TEST BATTERY');
  console.log('='.repeat(60));
  console.log('');

  // Check configured APIs
  console.log('API Configuration:');
  console.log(`  SerpAPI: ${process.env.SERPAPI_KEY?.trim() ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`  Amadeus: ${process.env.AMADEUS_API_KEY && process.env.AMADEUS_API_SECRET ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`  Gemini:  ${process.env.GOOGLE_AI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log('');

  // Calculate test date (7 days from now)
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + 7);
  const dateStr = testDate.toISOString().split('T')[0];
  console.log(`Test date: ${dateStr}`);
  console.log('');

  const results: TestResult[] = [];

  // Test each route
  for (const route of TEST_ROUTES) {
    console.log('-'.repeat(60));
    console.log(`Testing: ${route.name} (${route.origin} → ${route.destination})`);
    console.log('-'.repeat(60));

    // Test SerpAPI
    console.log('\n[SerpAPI]');
    const serpFlights = await testSerpApi(route.origin, route.destination, dateStr);
    const serpResult = analyzeFlights(serpFlights, route.name, 'SerpAPI');
    results.push(serpResult);
    printResult(serpResult);

    // Test Amadeus
    console.log('\n[Amadeus]');
    const amadeusFlights = await testAmadeusApi(route.origin, route.destination, dateStr);
    const amadeusResult = analyzeFlights(amadeusFlights, route.name, 'Amadeus');
    results.push(amadeusResult);
    printResult(amadeusResult);

    console.log('');
  }

  // Print summary
  printSummary(results);
}

function analyzeFlights(flights: Flight[], route: string, source: string): TestResult {
  const result: TestResult = {
    route,
    source,
    totalFlights: flights.length,
    validFlights: 0,
    invalidFlights: [],
    hasSpecificBookingUrls: false,
    sampleFlights: flights.slice(0, 3),
    errors: [],
  };

  if (flights.length === 0) {
    result.errors.push('No flights returned');
    return result;
  }

  let specificUrls = 0;

  for (const flight of flights) {
    const validation = isValidFlightNumber(flight.flightNumber);
    if (validation.valid) {
      result.validFlights++;
    } else {
      result.invalidFlights.push(flight);
      result.errors.push(`Invalid: ${flight.flightNumber} - ${validation.reason}`);
    }

    if (isSpecificBookingUrl(flight.bookingUrl, flight)) {
      specificUrls++;
    }
  }

  result.hasSpecificBookingUrls = specificUrls > flights.length * 0.5; // >50% specific

  return result;
}

function printResult(result: TestResult) {
  if (result.totalFlights === 0) {
    console.log('  ❌ No flights found');
    return;
  }

  const validPct = Math.round((result.validFlights / result.totalFlights) * 100);
  const status = validPct >= 80 ? '✅' : validPct >= 50 ? '⚠️' : '❌';

  console.log(`  ${status} ${result.totalFlights} flights, ${result.validFlights} valid (${validPct}%)`);
  console.log(`  Booking URLs: ${result.hasSpecificBookingUrls ? '✅ Specific' : '⚠️ Generic'}`);

  if (result.sampleFlights.length > 0) {
    console.log('  Sample flights:');
    for (const flight of result.sampleFlights.slice(0, 2)) {
      console.log(`    - ${flight.flightNumber}: ${flight.departureAirportCode}→${flight.arrivalAirportCode} at ${flight.departureTime} (${flight.price}€)`);
    }
  }

  if (result.errors.length > 0 && result.errors.length <= 3) {
    console.log('  Issues:');
    for (const error of result.errors) {
      console.log(`    - ${error}`);
    }
  }
}

function printSummary(results: TestResult[]) {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const bySource: Record<string, TestResult[]> = {};
  for (const result of results) {
    if (!bySource[result.source]) bySource[result.source] = [];
    bySource[result.source].push(result);
  }

  for (const [source, sourceResults] of Object.entries(bySource)) {
    const totalFlights = sourceResults.reduce((sum, r) => sum + r.totalFlights, 0);
    const validFlights = sourceResults.reduce((sum, r) => sum + r.validFlights, 0);
    const routesWithFlights = sourceResults.filter(r => r.totalFlights > 0).length;
    const routesWithSpecificUrls = sourceResults.filter(r => r.hasSpecificBookingUrls).length;

    console.log(`\n${source}:`);
    console.log(`  Routes with flights: ${routesWithFlights}/${sourceResults.length}`);
    console.log(`  Total flights: ${totalFlights}`);
    console.log(`  Valid flight numbers: ${validFlights}/${totalFlights} (${totalFlights > 0 ? Math.round(validFlights/totalFlights*100) : 0}%)`);
    console.log(`  Routes with specific URLs: ${routesWithSpecificUrls}/${routesWithFlights}`);

    const status = totalFlights > 0 && validFlights / totalFlights >= 0.8 ? '✅ PASSED' : '❌ FAILED';
    console.log(`  Status: ${status}`);
  }

  console.log('\n' + '='.repeat(60));

  // Overall verdict
  const allValid = results.filter(r => r.totalFlights > 0 && r.validFlights / r.totalFlights >= 0.8);
  const hasRealFlights = allValid.length > 0;

  if (hasRealFlights) {
    console.log('✅ REAL FLIGHTS ARE BEING RETURNED');
    console.log(`   ${allValid.length} test(s) passed with valid flight numbers`);
  } else {
    console.log('❌ NO REAL FLIGHTS DETECTED');
    console.log('   Check API configuration and try again');
  }
  console.log('='.repeat(60));
}

// Run
runTests().catch(console.error);
