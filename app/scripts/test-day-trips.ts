/**
 * Quick test of updated suggestDayTrips function
 */

import { suggestDayTrips } from '../src/lib/services/dayTripSuggestions';

// Test 1: Paris with 3 days (should get 1 day trip)
console.log('\n=== Test 1: Paris, 3 days ===');
const paris3days = suggestDayTrips(
  'Paris',
  { lat: 48.8566, lng: 2.3522 },
  {
    durationDays: 3,
    groupType: 'couple',
    budgetLevel: 'moderate',
    preferredActivities: ['culture', 'nature'],
  }
);
console.log(`Found ${paris3days.length} day trip(s):`);
paris3days.forEach((trip) => {
  console.log(`- ${trip.name} (minDays: ${trip.minDays}, fullDay: ${trip.fullDayRequired}, from: ${trip.fromCity})`);
});

// Test 2: Paris with 7 days (should get up to 2 day trips)
console.log('\n=== Test 2: Paris, 7 days ===');
const paris7days = suggestDayTrips(
  'Paris',
  { lat: 48.8566, lng: 2.3522 },
  {
    durationDays: 7,
    groupType: 'couple',
    budgetLevel: 'moderate',
    preferredActivities: ['culture', 'nature'],
  }
);
console.log(`Found ${paris7days.length} day trip(s):`);
paris7days.forEach((trip) => {
  console.log(`- ${trip.name} (minDays: ${trip.minDays}, fullDay: ${trip.fullDayRequired}, from: ${trip.fromCity})`);
});

// Test 3: Paris with pre-purchased ticket for Versailles
console.log('\n=== Test 3: Paris, 5 days, with Versailles ticket ===');
const parisWithTicket = suggestDayTrips(
  'Paris',
  { lat: 48.8566, lng: 2.3522 },
  {
    durationDays: 5,
    groupType: 'couple',
    budgetLevel: 'moderate',
    preferredActivities: ['culture', 'nature'],
    prePurchasedTickets: [
      { name: 'Versailles', notes: 'Already booked' }
    ],
  }
);
console.log(`Found ${parisWithTicket.length} day trip(s):`);
parisWithTicket.forEach((trip) => {
  console.log(`- ${trip.name} (minDays: ${trip.minDays}, fullDay: ${trip.fullDayRequired}, from: ${trip.fromCity})`);
});

// Test 4: Tokyo
console.log('\n=== Test 4: Tokyo, 5 days ===');
const tokyo = suggestDayTrips(
  'Tokyo',
  { lat: 35.6762, lng: 139.6503 },
  {
    durationDays: 5,
    groupType: 'family_with_kids',
    budgetLevel: 'comfort',
    preferredActivities: ['nature', 'culture'],
  }
);
console.log(`Found ${tokyo.length} day trip(s):`);
tokyo.forEach((trip) => {
  console.log(`- ${trip.name} (minDays: ${trip.minDays}, fullDay: ${trip.fullDayRequired}, from: ${trip.fromCity})`);
});

// Test 5: Unknown city (should return empty)
console.log('\n=== Test 5: Unknown city ===');
const unknown = suggestDayTrips(
  'UnknownCity',
  { lat: 0, lng: 0 },
  {
    durationDays: 5,
    groupType: 'couple',
    budgetLevel: 'moderate',
    preferredActivities: ['culture'],
  }
);
console.log(`Found ${unknown.length} day trip(s) (expected 0)`);
