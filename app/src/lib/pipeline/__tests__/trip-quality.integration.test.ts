/**
 * Trip Quality Integration Tests
 *
 * Tests that actually verify the quality of generated trips, not just plumbing.
 * - Test 1: Barcelona 3 days couple, 2 must-sees (mock, deterministic)
 * - Test 2: Rome 5 days family, day 5 early departure (mock, deterministic)
 * - Test 3: Real API Barcelona 3 days (skipped without GOOGLE_MAPS_API_KEY)
 */

import { unifiedScheduleV3Days } from '../step8910-unified-schedule';
import { validateContracts } from '../step11-contracts';
import { getMinDuration, getMaxDuration } from '../utils/constants';
import type { ActivityCluster, ScoredActivity, FetchedData } from '../types';
import type { DayTravelTimes, TravelLeg } from '../step7b-travel-times';
import type { DayTimeWindow } from '../step4-anchor-transport';
import type { Restaurant, Accommodation, TripPreferences, TripDay, TripItem } from '../../types';

// ============================================
// Haversine (local — avoids importing calculateDistance)
// ============================================

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================
// Test Helpers
// ============================================

function makeActivity(overrides: Partial<ScoredActivity> = {}): ScoredActivity {
  return {
    id: 'act-1',
    name: 'Test Activity',
    type: 'culture',
    description: 'A test activity',
    duration: 90,
    estimatedCost: 20,
    latitude: 41.4036,
    longitude: 2.1744,
    rating: 4.7,
    mustSee: false,
    bookingRequired: false,
    openingHours: { open: '09:00', close: '18:00' },
    score: 80,
    source: 'google_places',
    reviewCount: 1000,
    ...overrides,
  } as ScoredActivity;
}

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'rest-1',
    name: 'Restaurant Test',
    address: 'Test Address',
    latitude: 41.4036,
    longitude: 2.1744,
    rating: 4.6,
    reviewCount: 500,
    priceLevel: 2 as 1 | 2 | 3 | 4,
    cuisineTypes: ['mediterranean'],
    dietaryOptions: [],
    openingHours: {
      monday: { open: '07:00', close: '23:00' },
      tuesday: { open: '07:00', close: '23:00' },
      wednesday: { open: '07:00', close: '23:00' },
      thursday: { open: '07:00', close: '23:00' },
      friday: { open: '07:00', close: '23:00' },
      saturday: { open: '07:00', close: '23:00' },
      sunday: { open: '07:00', close: '23:00' },
    },
    ...overrides,
  };
}

function makeHotel(overrides: Partial<Accommodation> = {}): Accommodation {
  return {
    id: 'hotel-1',
    name: 'Hotel Test',
    type: 'hotel',
    address: 'Test Address',
    latitude: 41.3900,
    longitude: 2.1700,
    rating: 8.5,
    reviewCount: 200,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: [],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    ...overrides,
  };
}

function makeCluster(dayNumber: number, activities: ScoredActivity[]): ActivityCluster {
  const lat = activities.length > 0 ? activities.reduce((s, a) => s + a.latitude, 0) / activities.length : 41.3851;
  const lng = activities.length > 0 ? activities.reduce((s, a) => s + a.longitude, 0) / activities.length : 2.1734;
  return {
    dayNumber,
    activities,
    centroid: { lat, lng },
    totalIntraDistance: 0.5,
  };
}

function makeTimeWindow(dayNumber: number, overrides: Partial<DayTimeWindow> = {}): DayTimeWindow {
  return {
    dayNumber,
    activityStartTime: '08:30',
    activityEndTime: '21:00',
    hasArrivalTransport: false,
    hasDepartureTransport: false,
    ...overrides,
  };
}

function makeTravelTimes(dayNumber: number, legs: TravelLeg[] = []): DayTravelTimes {
  return { dayNumber, legs, totalTravelMinutes: legs.reduce((s, l) => s + l.durationMinutes, 0) };
}

function emptyData(destCoords = { lat: 41.3851, lng: 2.1734 }): FetchedData {
  return {
    destCoords,
    originCoords: { lat: 48.8566, lng: 2.3522 },
    originAirports: [],
    destAirports: [],
    googlePlacesAttractions: [],
    serpApiAttractions: [],
    overpassAttractions: [],
    viatorActivities: [],
    mustSeeAttractions: [],
    tripAdvisorRestaurants: [],
    serpApiRestaurants: [],
    bookingHotels: [],
    transportOptions: [],
    outboundFlight: null,
    returnFlight: null,
    flightAlternatives: { outbound: [], return: [] },
    weatherForecasts: [],
    dayTripSuggestions: [],
    dayTripActivities: {},
    dayTripRestaurants: {},
    travelTips: {},
    budgetStrategy: {} as any,
    resolvedBudget: {} as any,
  } as FetchedData;
}

// ============================================
// Barcelona Fixtures (3 days couple)
// ============================================

const BARCELONA_DEST = { lat: 41.3851, lng: 2.1734 };

const BARCELONA_ACTIVITIES: ScoredActivity[] = [
  // Day 1: Gothic Quarter cluster
  makeActivity({ id: 'sagrada-familia', name: 'Sagrada Familia', duration: 90, latitude: 41.4036, longitude: 2.1744, mustSee: true, score: 98, openingHours: { open: '09:00', close: '20:00' }, estimatedCost: 26 }),
  makeActivity({ id: 'park-guell', name: 'Park Güell', type: 'nature', duration: 75, latitude: 41.4145, longitude: 2.1527, mustSee: true, score: 95, openingHours: { open: '09:30', close: '19:30' }, estimatedCost: 10 }),
  makeActivity({ id: 'casa-batllo', name: 'Casa Batlló', duration: 60, latitude: 41.3916, longitude: 2.1650, score: 90, openingHours: { open: '09:00', close: '21:00' }, estimatedCost: 35 }),
  // Day 2: Waterfront cluster
  makeActivity({ id: 'la-boqueria', name: 'Mercat de la Boqueria', type: 'culture', duration: 45, latitude: 41.3816, longitude: 2.1719, score: 85, openingHours: { open: '08:00', close: '20:30' } }),
  makeActivity({ id: 'barceloneta', name: 'Barceloneta Beach', type: 'beach', duration: 90, latitude: 41.3784, longitude: 2.1925, score: 78, openingHours: { open: '06:00', close: '22:00' } }),
  makeActivity({ id: 'palau-musica', name: 'Palau de la Música Catalana', duration: 60, latitude: 41.3876, longitude: 2.1753, score: 82, openingHours: { open: '10:00', close: '15:30' } }),
  // Day 3: Montjuïc cluster
  makeActivity({ id: 'mnac', name: 'MNAC Museum', duration: 120, latitude: 41.3685, longitude: 2.1527, score: 80, openingHours: { open: '10:00', close: '18:00' }, estimatedCost: 12 }),
  makeActivity({ id: 'font-magica', name: 'Font Màgica de Montjuïc', type: 'nature', duration: 30, latitude: 41.3712, longitude: 2.1519, score: 75, openingHours: { open: '09:00', close: '21:00' } }),
  makeActivity({ id: 'fundacio-miro', name: 'Fundació Joan Miró', duration: 90, latitude: 41.3685, longitude: 2.1600, score: 77, openingHours: { open: '10:00', close: '18:00' }, estimatedCost: 14 }),
];

const BARCELONA_RESTAURANTS: Restaurant[] = [
  // Breakfast-capable
  makeRestaurant({ id: 'bar-federal', name: 'Federal Café', latitude: 41.3820, longitude: 2.1740, cuisineTypes: ['cafe', 'brunch'], openingHours: { monday: { open: '08:00', close: '23:00' }, tuesday: { open: '08:00', close: '23:00' }, wednesday: { open: '08:00', close: '23:00' }, thursday: { open: '08:00', close: '23:00' }, friday: { open: '08:00', close: '23:00' }, saturday: { open: '09:00', close: '23:00' }, sunday: { open: '09:00', close: '16:00' } } }),
  // Lunch + dinner
  makeRestaurant({ id: 'bar-centric', name: 'Bar Cèntric', latitude: 41.3870, longitude: 2.1690, cuisineTypes: ['catalan', 'tapas'], rating: 4.5 }),
  makeRestaurant({ id: 'cerveceria-catalana', name: 'Cervecería Catalana', latitude: 41.3930, longitude: 2.1615, cuisineTypes: ['spanish', 'tapas'], rating: 4.7 }),
  // Split hours restaurant — forces scheduler to handle split openings
  makeRestaurant({ id: 'can-sole', name: 'Can Solé', latitude: 41.3790, longitude: 2.1890, cuisineTypes: ['seafood', 'mediterranean'], rating: 4.4, openingHours: { monday: null, tuesday: { open: '13:00', close: '16:00' }, wednesday: { open: '13:00', close: '16:00' }, thursday: { open: '13:00', close: '16:00' }, friday: { open: '13:00', close: '16:00' }, saturday: { open: '13:00', close: '16:00' }, sunday: { open: '13:00', close: '16:00' } } }),
  // Near Montjuïc
  makeRestaurant({ id: 'elche', name: 'Restaurant Elche', latitude: 41.3740, longitude: 2.1550, cuisineTypes: ['mediterranean', 'catalan'], rating: 4.3 }),
  makeRestaurant({ id: 'quimet-quimet', name: 'Quimet & Quimet', latitude: 41.3810, longitude: 2.1730, cuisineTypes: ['tapas'], rating: 4.6 }),
  // Near Sagrada
  makeRestaurant({ id: 'la-paradeta', name: 'La Paradeta Sagrada Familia', latitude: 41.4010, longitude: 2.1730, cuisineTypes: ['seafood'], rating: 4.2 }),
];

// ============================================
// Rome Fixtures (5 days family)
// ============================================

const ROME_DEST = { lat: 41.9028, lng: 12.4964 };

const ROME_ACTIVITIES: ScoredActivity[] = [
  // Day 1: Ancient Rome cluster
  makeActivity({ id: 'colosseum', name: 'Colosseum', duration: 120, latitude: 41.8902, longitude: 12.4922, mustSee: true, score: 99, openingHours: { open: '09:00', close: '19:00' }, estimatedCost: 16 }),
  makeActivity({ id: 'roman-forum', name: 'Roman Forum', duration: 90, latitude: 41.8925, longitude: 12.4853, score: 92, openingHours: { open: '09:00', close: '19:00' }, estimatedCost: 16 }),
  makeActivity({ id: 'palatine-hill', name: 'Palatine Hill', duration: 60, latitude: 41.8893, longitude: 12.4875, score: 85, openingHours: { open: '09:00', close: '19:00' } }),
  // Day 2: Vatican cluster
  makeActivity({ id: 'vatican-museums', name: 'Vatican Museums', duration: 180, latitude: 41.9065, longitude: 12.4536, score: 96, openingHours: { open: '09:00', close: '18:00' }, estimatedCost: 17 }),
  makeActivity({ id: 'st-peters', name: "St. Peter's Basilica", duration: 60, latitude: 41.9022, longitude: 12.4539, score: 93, openingHours: { open: '07:00', close: '18:30' } }),
  makeActivity({ id: 'castel-sant-angelo', name: "Castel Sant'Angelo", duration: 75, latitude: 41.9031, longitude: 12.4663, score: 84, openingHours: { open: '09:00', close: '19:30' }, estimatedCost: 15 }),
  // Day 3: Centro Storico
  makeActivity({ id: 'trevi-fountain', name: 'Trevi Fountain', type: 'culture', duration: 30, latitude: 41.9009, longitude: 12.4833, mustSee: true, score: 97, openingHours: { open: '00:00', close: '23:59' } }),
  makeActivity({ id: 'pantheon', name: 'Pantheon', duration: 45, latitude: 41.8986, longitude: 12.4769, score: 94, openingHours: { open: '09:00', close: '19:00' } }),
  makeActivity({ id: 'piazza-navona', name: 'Piazza Navona', type: 'culture', duration: 30, latitude: 41.8992, longitude: 12.4731, score: 83, openingHours: { open: '00:00', close: '23:59' } }),
  // Day 4: Trastevere + further
  makeActivity({ id: 'villa-borghese', name: 'Villa Borghese Gardens', type: 'nature', duration: 90, latitude: 41.9142, longitude: 12.4921, score: 81, openingHours: { open: '07:00', close: '19:00' } }),
  makeActivity({ id: 'trastevere', name: 'Trastevere Neighborhood Stroll', type: 'culture', duration: 60, latitude: 41.8871, longitude: 12.4700, score: 79, openingHours: { open: '09:00', close: '21:00' } }),
  // Ostia Antica: 35km away — P0.6 should NOT fire (under 100km)
  makeActivity({ id: 'ostia-antica', name: 'Ostia Antica', duration: 150, latitude: 41.7558, longitude: 12.2914, score: 82, openingHours: { open: '08:30', close: '18:00' }, estimatedCost: 12 }),
  // Day 5: Short day
  makeActivity({ id: 'spanish-steps', name: 'Spanish Steps', type: 'culture', duration: 30, latitude: 41.9060, longitude: 12.4828, score: 76, openingHours: { open: '00:00', close: '23:59' } }),
  makeActivity({ id: 'borghese-gallery', name: 'Galleria Borghese', duration: 120, latitude: 41.9142, longitude: 12.4921, score: 88, openingHours: { open: '09:00', close: '19:00' }, estimatedCost: 15 }),
];

const ROME_RESTAURANTS: Restaurant[] = [
  // Breakfast near Colosseum area
  makeRestaurant({ id: 'rome-breakfast-1', name: 'Antico Caffè Greco', latitude: 41.9058, longitude: 12.4802, cuisineTypes: ['cafe', 'italian'], openingHours: { monday: { open: '07:00', close: '21:00' }, tuesday: { open: '07:00', close: '21:00' }, wednesday: { open: '07:00', close: '21:00' }, thursday: { open: '07:00', close: '21:00' }, friday: { open: '07:00', close: '21:00' }, saturday: { open: '07:00', close: '21:00' }, sunday: { open: '07:00', close: '21:00' } } }),
  // Lunch spots
  makeRestaurant({ id: 'roscioli', name: 'Roscioli', latitude: 41.8930, longitude: 12.4860, cuisineTypes: ['italian', 'deli'], rating: 4.7, openingHours: { monday: { open: '08:00', close: '16:00' }, tuesday: { open: '08:00', close: '16:00' }, wednesday: { open: '08:00', close: '16:00' }, thursday: { open: '08:00', close: '16:00' }, friday: { open: '08:00', close: '16:00' }, saturday: { open: '08:00', close: '16:00' }, sunday: null } }),
  // Dinner-only restaurant (near Colosseum/Forum area)
  makeRestaurant({ id: 'tonnarello', name: 'Tonnarello', latitude: 41.8910, longitude: 12.4890, cuisineTypes: ['roman', 'pasta'], rating: 4.5, openingHours: { monday: { open: '19:00', close: '23:30' }, tuesday: { open: '19:00', close: '23:30' }, wednesday: { open: '19:00', close: '23:30' }, thursday: { open: '19:00', close: '23:30' }, friday: { open: '19:00', close: '23:30' }, saturday: { open: '19:00', close: '23:30' }, sunday: { open: '19:00', close: '23:30' } } }),
  // Near Vatican
  makeRestaurant({ id: 'dal-toscano', name: 'Dal Toscano', latitude: 41.9075, longitude: 12.4545, cuisineTypes: ['tuscan', 'italian'], rating: 4.3 }),
  // Near Piazza Navona
  makeRestaurant({ id: 'da-baffetto', name: 'Da Baffetto', latitude: 41.8989, longitude: 12.4714, cuisineTypes: ['pizza'], rating: 4.4 }),
  // All-day restaurant near Centro
  makeRestaurant({ id: 'armando', name: 'Armando al Pantheon', latitude: 41.8985, longitude: 12.4770, cuisineTypes: ['roman', 'italian'], rating: 4.6 }),
  // Near Ostia (for day trip lunch)
  makeRestaurant({ id: 'ostia-rest', name: 'Ristorante Cipriani Ostia', latitude: 41.7530, longitude: 12.2930, cuisineTypes: ['seafood', 'italian'], rating: 4.1 }),
  // Near Borghese
  makeRestaurant({ id: 'rome-pincio', name: 'Caffè del Pincio', latitude: 41.9000, longitude: 12.4810, cuisineTypes: ['cafe', 'italian'], rating: 4.0 }),
];

// ============================================
// assertTripQuality — Independent P0 validation
// ============================================

function assertTripQuality(
  days: TripDay[],
  destCoords: { lat: number; lng: number },
  mustSeeNames: string[],
  startDateStr: string,
): void {
  const errors: string[] = [];

  for (const day of days) {
    const items = day.items.filter(i => i.type === 'activity' || i.type === 'restaurant');
    const activities = day.items.filter(i => i.type === 'activity');
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === days.length;

    // Density: at least 1 activity per day
    if (activities.length === 0) {
      errors.push(`Day ${day.dayNumber}: no activities`);
    }

    let hasLunch = false;
    let hasDinner = false;

    for (const item of day.items) {
      // P0.5: No (0,0) coordinates
      if (item.latitude === 0 && item.longitude === 0 && (item.type === 'activity' || item.type === 'restaurant')) {
        errors.push(`P0.5: Day ${day.dayNumber} "${item.title}" has (0,0) coordinates`);
      }

      // P0.6: No cross-country items (>100km from dest)
      if (item.latitude && item.longitude && (item.type === 'activity' || item.type === 'restaurant')) {
        const dist = haversine(item.latitude, item.longitude, destCoords.lat, destCoords.lng);
        if (dist > 100) {
          errors.push(`P0.6: Day ${day.dayNumber} "${item.title}" is ${dist.toFixed(0)}km from destination`);
        }
      }

      // P0.7: Duration bounds (activities only)
      if (item.type === 'activity' && item.duration) {
        const minDur = getMinDuration(item.title || '', item.type);
        const maxDur = getMaxDuration(item.title || '', item.type);
        if (item.duration < minDur * 0.8) {
          errors.push(`P0.7: Day ${day.dayNumber} "${item.title}" duration ${item.duration}min < min ${minDur}min (with 20% tolerance)`);
        }
        if (maxDur && item.duration > maxDur * 1.2) {
          errors.push(`P0.7: Day ${day.dayNumber} "${item.title}" duration ${item.duration}min > max ${maxDur}min (with 20% tolerance)`);
        }
      }

      // P0.1: Opening hours (15min tolerance)
      if (item.type === 'activity' && item.openingHours) {
        const open = timeToMinutes(item.openingHours.open);
        const close = timeToMinutes(item.openingHours.close);
        const start = timeToMinutes(item.startTime);
        const end = timeToMinutes(item.endTime);
        // 24h places are always OK
        if (!(open === 0 && close >= 23 * 60 + 59)) {
          if (start < open - 15 || end > close + 15) {
            errors.push(`P0.1: Day ${day.dayNumber} "${item.title}" scheduled ${item.startTime}-${item.endTime} outside hours ${item.openingHours.open}-${item.openingHours.close}`);
          }
        }
      }

      // Track meals for P0.3
      if (item.type === 'restaurant') {
        const mealType = item.mealType;
        const titleLower = (item.title || '').toLowerCase();
        if (mealType === 'lunch' || titleLower.includes('lunch') || (titleLower.includes('déjeuner') && !titleLower.includes('petit-déjeuner'))) {
          hasLunch = true;
        }
        if (mealType === 'dinner' || titleLower.includes('dinner') || titleLower.includes('dîner') || titleLower.includes('diner')) {
          hasDinner = true;
        }

        // P0.2: Restaurant proximity (lunch/dinner only, skip self_meal_fallback)
        const isSelfMealFallback = item.qualityFlags?.includes('self_meal_fallback') === true;
        const isLunchOrDinner = mealType === 'lunch' || mealType === 'dinner';
        if (!isSelfMealFallback && isLunchOrDinner && item.latitude && item.longitude) {
          const dayActivities = day.items.filter(i => i.type === 'activity' && i.latitude && i.longitude);
          if (dayActivities.length > 0) {
            const minDist = Math.min(...dayActivities.map(a => haversine(item.latitude!, item.longitude!, a.latitude!, a.longitude!)));
            if (minDist > 1.2) {
              errors.push(`P0.2: Day ${day.dayNumber} "${item.title}" is ${(minDist * 1000).toFixed(0)}m from nearest activity (max 1200m)`);
            }
          }
        }
      }
    }

    // P0.3: Missing meals
    if (!hasLunch && !isFirstDay && !isLastDay) {
      errors.push(`P0.3: Day ${day.dayNumber} has no lunch`);
    }
    if (!hasDinner && !isLastDay) {
      errors.push(`P0.3: Day ${day.dayNumber} has no dinner`);
    }

    // Temporal ordering: items sorted by startTime
    for (let i = 1; i < items.length; i++) {
      const prev = timeToMinutes(items[i - 1].startTime);
      const curr = timeToMinutes(items[i].startTime);
      if (curr < prev) {
        errors.push(`Day ${day.dayNumber}: "${items[i].title}" starts at ${items[i].startTime} before "${items[i - 1].title}" at ${items[i - 1].startTime}`);
      }
    }

    // No overlaps: no item starts before previous ends
    for (let i = 1; i < items.length; i++) {
      const prevEnd = timeToMinutes(items[i - 1].endTime);
      const currStart = timeToMinutes(items[i].startTime);
      if (currStart < prevEnd - 1) { // 1min tolerance for rounding
        errors.push(`Day ${day.dayNumber}: "${items[i].title}" (${items[i].startTime}) overlaps with "${items[i - 1].title}" (ends ${items[i - 1].endTime})`);
      }
    }
  }

  // P0.8: Must-sees present (substring match, case + accent insensitive)
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const allTitles = days.flatMap(d => d.items.filter(i => i.type === 'activity').map(i => stripAccents(i.title || '')));
  for (const mustSee of mustSeeNames) {
    const norm = stripAccents(mustSee);
    const found = allTitles.some(title => title.includes(norm) || norm.includes(title));
    if (!found) {
      errors.push(`P0.8: Must-see "${mustSee}" not found in plan`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Trip quality failures:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

// ============================================
// Test 1: Barcelona 3 days couple, 2 must-sees
// ============================================

describe('Trip quality integration', () => {
  describe('Barcelona 3-day couple trip', () => {
    it('generates a quality trip with must-sees and valid P0 invariants', () => {
      const preferences: TripPreferences = {
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-05-04T00:00:00.000Z'), // Monday
        durationDays: 3,
        transport: 'plane',
        carRental: false,
        groupSize: 2,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture', 'beach'],
        dietary: ['none'],
        mustSee: 'Sagrada Familia, Park Güell',
      };

      const hotel = makeHotel({
        id: 'hotel-bcn',
        name: 'Hotel Barcelona Centro',
        latitude: 41.3900,
        longitude: 2.1700,
      });

      const clusters = [
        makeCluster(1, [BARCELONA_ACTIVITIES[0], BARCELONA_ACTIVITIES[1], BARCELONA_ACTIVITIES[2]]), // Sagrada, Park Güell, Casa Batlló
        makeCluster(2, [BARCELONA_ACTIVITIES[3], BARCELONA_ACTIVITIES[4], BARCELONA_ACTIVITIES[5]]), // Boqueria, Barceloneta, Palau
        makeCluster(3, [BARCELONA_ACTIVITIES[6], BARCELONA_ACTIVITIES[7], BARCELONA_ACTIVITIES[8]]), // MNAC, Font Mágica, Miró
      ];

      const timeWindows = [
        makeTimeWindow(1, { activityStartTime: '10:00', hasArrivalTransport: true }), // Arrival day
        makeTimeWindow(2),
        makeTimeWindow(3, { activityEndTime: '18:00', hasDepartureTransport: true }), // Departure day
      ];

      const travelTimes = [
        makeTravelTimes(1, [
          { fromId: 'sagrada-familia', toId: 'park-guell', fromName: 'Sagrada Familia', toName: 'Park Güell', distanceKm: 1.8, durationMinutes: 12, mode: 'transit', isEstimate: true },
          { fromId: 'park-guell', toId: 'casa-batllo', fromName: 'Park Güell', toName: 'Casa Batlló', distanceKm: 2.9, durationMinutes: 18, mode: 'transit', isEstimate: true },
        ]),
        makeTravelTimes(2, [
          { fromId: 'la-boqueria', toId: 'barceloneta', fromName: 'Boqueria', toName: 'Barceloneta', distanceKm: 1.6, durationMinutes: 10, mode: 'walk', isEstimate: true },
          { fromId: 'barceloneta', toId: 'palau-musica', fromName: 'Barceloneta', toName: 'Palau', distanceKm: 1.2, durationMinutes: 8, mode: 'walk', isEstimate: true },
        ]),
        makeTravelTimes(3, [
          { fromId: 'mnac', toId: 'font-magica', fromName: 'MNAC', toName: 'Font Màgica', distanceKm: 0.3, durationMinutes: 5, mode: 'walk', isEstimate: true },
          { fromId: 'font-magica', toId: 'fundacio-miro', fromName: 'Font Màgica', toName: 'Miró', distanceKm: 0.8, durationMinutes: 8, mode: 'walk', isEstimate: true },
        ]),
      ];

      const data = emptyData(BARCELONA_DEST);

      const result = unifiedScheduleV3Days(
        clusters,
        travelTimes,
        timeWindows,
        hotel,
        preferences,
        data,
        BARCELONA_RESTAURANTS,
        BARCELONA_ACTIVITIES,
        BARCELONA_DEST,
      );

      // Basic structure
      expect(result.days).toHaveLength(3);
      expect(result.days.every(d => d.items.length > 0)).toBe(true);

      // Run our independent quality assertions
      assertTripQuality(result.days, BARCELONA_DEST, ['Sagrada Familia', 'Park Güell'], '2026-05-04');

      // Also run the contract validator as double-check
      const mustSeeIds = new Set(BARCELONA_ACTIVITIES.filter(a => a.mustSee).map(a => a.id));
      const contractResult = validateContracts(
        result.days,
        '2026-05-04',
        mustSeeIds,
        BARCELONA_DEST,
        BARCELONA_ACTIVITIES.filter(a => a.mustSee).map(a => ({ id: a.id, name: a.name })),
      );

      expect(contractResult.score).toBeGreaterThanOrEqual(75);
      // P0 violations should be zero or very few (scheduler + repair should handle them)
      expect(contractResult.violations.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================
  // Test 2: Rome 5 days family, day 5 early departure
  // ============================================

  describe('Rome 5-day family trip', () => {
    it('generates a quality trip with early departure on last day and remote Ostia Antica', () => {
      const preferences: TripPreferences = {
        origin: 'Paris',
        destination: 'Rome',
        startDate: new Date('2026-06-09T00:00:00.000Z'), // Monday
        durationDays: 5,
        transport: 'plane',
        carRental: false,
        groupSize: 4,
        groupType: 'family',
        budgetLevel: 'moderate',
        activities: ['culture', 'nature'],
        dietary: ['none'],
        mustSee: 'Colosseum, Trevi Fountain',
      };

      const hotel = makeHotel({
        id: 'hotel-rome',
        name: 'Hotel Roma Centro',
        latitude: 41.8990,
        longitude: 12.4800,
      });

      const clusters = [
        makeCluster(1, [ROME_ACTIVITIES[0], ROME_ACTIVITIES[1], ROME_ACTIVITIES[2]]),   // Colosseum, Forum, Palatine
        makeCluster(2, [ROME_ACTIVITIES[3], ROME_ACTIVITIES[4], ROME_ACTIVITIES[5]]),   // Vatican, St Peter's, Castel
        makeCluster(3, [ROME_ACTIVITIES[6], ROME_ACTIVITIES[7], ROME_ACTIVITIES[8]]),   // Trevi, Pantheon, Navona
        makeCluster(4, [ROME_ACTIVITIES[9], ROME_ACTIVITIES[10], ROME_ACTIVITIES[11]]), // Borghese, Trastevere, Ostia
        makeCluster(5, [ROME_ACTIVITIES[12], ROME_ACTIVITIES[13]]),                     // Spanish Steps, Galleria Borghese
      ];

      const timeWindows = [
        makeTimeWindow(1, { activityStartTime: '10:00', hasArrivalTransport: true }),
        makeTimeWindow(2),
        makeTimeWindow(3),
        makeTimeWindow(4),
        makeTimeWindow(5, { activityEndTime: '14:00', hasDepartureTransport: true }), // Early departure!
      ];

      const travelTimes = [
        makeTravelTimes(1, [
          { fromId: 'colosseum', toId: 'roman-forum', fromName: 'Colosseum', toName: 'Roman Forum', distanceKm: 0.5, durationMinutes: 5, mode: 'walk', isEstimate: true },
          { fromId: 'roman-forum', toId: 'palatine-hill', fromName: 'Roman Forum', toName: 'Palatine Hill', distanceKm: 0.3, durationMinutes: 4, mode: 'walk', isEstimate: true },
        ]),
        makeTravelTimes(2, [
          { fromId: 'vatican-museums', toId: 'st-peters', fromName: 'Vatican Museums', toName: "St. Peter's", distanceKm: 0.6, durationMinutes: 8, mode: 'walk', isEstimate: true },
          { fromId: 'st-peters', toId: 'castel-sant-angelo', fromName: "St. Peter's", toName: "Castel Sant'Angelo", distanceKm: 0.9, durationMinutes: 12, mode: 'walk', isEstimate: true },
        ]),
        makeTravelTimes(3, [
          { fromId: 'trevi-fountain', toId: 'pantheon', fromName: 'Trevi', toName: 'Pantheon', distanceKm: 0.6, durationMinutes: 8, mode: 'walk', isEstimate: true },
          { fromId: 'pantheon', toId: 'piazza-navona', fromName: 'Pantheon', toName: 'Piazza Navona', distanceKm: 0.4, durationMinutes: 5, mode: 'walk', isEstimate: true },
        ]),
        makeTravelTimes(4, [
          { fromId: 'villa-borghese', toId: 'trastevere', fromName: 'Villa Borghese', toName: 'Trastevere', distanceKm: 3.5, durationMinutes: 20, mode: 'transit', isEstimate: true },
          { fromId: 'trastevere', toId: 'ostia-antica', fromName: 'Trastevere', toName: 'Ostia Antica', distanceKm: 25.0, durationMinutes: 45, mode: 'transit', isEstimate: true },
        ]),
        makeTravelTimes(5, [
          { fromId: 'spanish-steps', toId: 'borghese-gallery', fromName: 'Spanish Steps', toName: 'Galleria Borghese', distanceKm: 1.2, durationMinutes: 10, mode: 'walk', isEstimate: true },
        ]),
      ];

      const data = emptyData(ROME_DEST);

      const result = unifiedScheduleV3Days(
        clusters,
        travelTimes,
        timeWindows,
        hotel,
        preferences,
        data,
        ROME_RESTAURANTS,
        ROME_ACTIVITIES,
        ROME_DEST,
      );

      // Basic structure
      expect(result.days).toHaveLength(5);

      // Ostia Antica (35km) should NOT trigger P0.6 (100km threshold)
      const ostiaInPlan = result.days
        .flatMap(d => d.items)
        .some(i => (i.title || '').toLowerCase().includes('ostia'));
      // Ostia may or may not be in the plan (scheduler may drop it), but if present it shouldn't violate P0.6
      if (ostiaInPlan) {
        const ostiaDist = haversine(41.7558, 12.2914, ROME_DEST.lat, ROME_DEST.lng);
        expect(ostiaDist).toBeLessThan(100); // ~35km, well under 100km
      }

      // Day 5 has early departure (14:00) — dinner should be excused (last day P0.3)
      const day5 = result.days.find(d => d.dayNumber === 5)!;
      expect(day5).toBeDefined();
      const day5Activities = day5.items.filter(i => i.type === 'activity');
      // Day 5 should have fewer activities than a full day (constrained by early departure)
      expect(day5Activities.length).toBeLessThanOrEqual(3);

      // Run independent quality check
      assertTripQuality(result.days, ROME_DEST, ['Colosseum', 'Trevi Fountain'], '2026-06-09');

      // Contract validator double-check
      const mustSeeIds = new Set(ROME_ACTIVITIES.filter(a => a.mustSee).map(a => a.id));
      const contractResult = validateContracts(
        result.days,
        '2026-06-09',
        mustSeeIds,
        ROME_DEST,
        ROME_ACTIVITIES.filter(a => a.mustSee).map(a => ({ id: a.id, name: a.name })),
      );

      expect(contractResult.score).toBeGreaterThanOrEqual(70);
      expect(contractResult.violations.length).toBeLessThanOrEqual(3);
    });
  });

  // ============================================
  // Test 3: Real API — Barcelona 3 days
  // ============================================

  describe('Real API', () => {
    const hasApiKey = !!process.env.GOOGLE_MAPS_API_KEY;
    const savedEnv: Record<string, string | undefined> = {};

    beforeAll(() => {
      savedEnv.PIPELINE_CONTRACTS_MODE = process.env.PIPELINE_CONTRACTS_MODE;
      savedEnv.PIPELINE_LLM_DECOR = process.env.PIPELINE_LLM_DECOR;
      savedEnv.PIPELINE_DIRECTIONS_MODE = process.env.PIPELINE_DIRECTIONS_MODE;
    });

    afterAll(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    });

    (hasApiKey ? it : it.skip)('generates a real trip via generateTripV3 with valid quality', async () => {
      // Lazy-import to avoid pulling in all pipeline deps for mock tests
      const { generateTripV3 } = await import('../index');

      process.env.PIPELINE_CONTRACTS_MODE = 'warn';
      process.env.PIPELINE_LLM_DECOR = 'off';
      process.env.PIPELINE_DIRECTIONS_MODE = 'off'; // Reduce API costs

      const prefs: TripPreferences = {
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-05-04T00:00:00.000Z'),
        durationDays: 3,
        transport: 'plane',
        carRental: false,
        groupSize: 2,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: ['none'],
        mustSee: 'Sagrada Familia',
      };

      const trip = await generateTripV3(prefs);

      // --- Basic structure ---
      expect(trip.days).toHaveLength(3);
      expect(trip.qualityMetrics!.score).toBeGreaterThanOrEqual(75);
      // Le contrat P0.2 est strict (800m) — avec des données réelles on tolère quelques dépassements
      expect(trip.qualityMetrics!.violations.length).toBeLessThanOrEqual(2);

      // --- P0 invariants (independent check) ---
      assertTripQuality(
        trip.days,
        BARCELONA_DEST,
        ['Sagrada Familia'],
        '2026-05-04',
      );

      // --- No "Repas libre" on a 3-day Barcelona trip ---
      const allItems = trip.days.flatMap(d => d.items);
      const selfMealFallbacks = allItems.filter(i =>
        i.qualityFlags?.includes('self_meal_fallback') ||
        (i.title || '').toLowerCase().includes('repas libre')
      );
      expect(selfMealFallbacks).toEqual([]);

      // --- Density: ≥2 activities per full day (day 2), ≥1 for first/last ---
      for (const day of trip.days) {
        const activities = day.items.filter(i => i.type === 'activity');
        const isEdgeDay = day.dayNumber === 1 || day.dayNumber === trip.days.length;
        const minActivities = isEdgeDay ? 1 : 2;
        expect(activities.length).toBeGreaterThanOrEqual(minActivities);
      }

      // --- No big gaps: max 1 trou >2h (hors post-breakfast) sur tout le trip ---
      const bigGaps: string[] = [];
      for (const day of trip.days) {
        const scheduled = day.items
          .filter(i => ['activity', 'restaurant'].includes(i.type))
          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        for (let i = 1; i < scheduled.length; i++) {
          const prev = scheduled[i - 1];
          const isAfterBreakfast = prev.mealType === 'breakfast' || (prev.title || '').toLowerCase().includes('petit-déjeuner');
          if (isAfterBreakfast) continue;
          const gap = timeToMinutes(scheduled[i].startTime) - timeToMinutes(prev.endTime);
          if (gap > 120) {
            bigGaps.push(`Day ${day.dayNumber}: ${gap}min between "${prev.title}" and "${scheduled[i].title}"`);
          }
        }
      }
      expect(bigGaps.length).toBeLessThanOrEqual(1);

      // --- Proximité géo : restaurants proches des activités, pas de sauts énormes ---
      const geoViolations: string[] = [];
      for (const day of trip.days) {
        const geoItems = day.items
          .filter(i => ['activity', 'restaurant'].includes(i.type) && i.latitude && i.longitude)
          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        const dayActivities = geoItems.filter(i => i.type === 'activity');

        // Restaurants : chacun doit être <2km de l'activité la plus proche du jour
        const dayRestaurants = geoItems.filter(i => i.type === 'restaurant');
        for (const r of dayRestaurants) {
          if (dayActivities.length === 0) continue;
          const minDist = Math.min(
            ...dayActivities.map(a => haversine(r.latitude!, r.longitude!, a.latitude!, a.longitude!))
          );
          if (minDist >= 2) {
            geoViolations.push(`Day ${day.dayNumber}: "${r.title}" is ${(minDist).toFixed(1)}km from nearest activity`);
          }
        }

        // Activités consécutives : pas de saut >5km
        const activities = geoItems.filter(i => i.type === 'activity');
        for (let i = 1; i < activities.length; i++) {
          const dist = haversine(activities[i - 1].latitude!, activities[i - 1].longitude!, activities[i].latitude!, activities[i].longitude!);
          if (dist >= 5) {
            geoViolations.push(`Day ${day.dayNumber}: ${(dist).toFixed(1)}km between "${activities[i-1].title}" and "${activities[i].title}"`);
          }
        }
      }
      // Tolère max 1 violation géo sur tout le trip (données réelles = variance)
      expect(geoViolations.length).toBeLessThanOrEqual(1);

      // --- Restaurant diversity: no same restaurant twice across the trip ---
      const restaurantNames = allItems
        .filter(i => i.type === 'restaurant' && !i.qualityFlags?.includes('self_meal_fallback'))
        .map(i => (i.title || '').replace(/^(Petit-déjeuner|Déjeuner|Dîner)\s*—\s*/i, '').toLowerCase());
      const uniqueNames = new Set(restaurantNames);
      // Allow at most 1 repeat (breakfast spot reuse is common)
      expect(uniqueNames.size).toBeGreaterThanOrEqual(restaurantNames.length - 1);

      // --- 3 meals per full day (day 2) ---
      for (const day of trip.days) {
        if (day.dayNumber === 1 || day.dayNumber === trip.days.length) continue;
        const meals = day.items.filter(i => i.type === 'restaurant');
        expect(meals.length).toBeGreaterThanOrEqual(3); // breakfast + lunch + dinner
      }
    }, 120_000);
  });
});
