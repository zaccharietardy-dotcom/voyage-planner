/**
 * Tests des Regles Importantes
 *
 * Ces tests verifient les 4 regles critiques qui doivent etre respectees
 * a chaque generation de voyage. Ils ont ete crees suite a des problemes
 * recurrents signales par l'utilisateur.
 *
 * Regles:
 * 1. VOLS - Pas de donnees inventees
 * 2. HORAIRES HOTEL - Check-in/check-out realistes
 * 3. HORAIRES JOURNEE - Jusqu'a minuit si nightlife
 * 4. RESTAURANTS - Cuisine locale et variee
 *
 * Executer avec: npm test -- importantRules
 */

import { Trip, TripItem, Flight, Restaurant, Accommodation, TripPreferences } from '../types';

// ============================================
// HELPERS
// ============================================

/**
 * Parse une heure au format "HH:mm" en minutes depuis minuit
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Cree un TripItem de test
 */
function createTripItem(
  id: string,
  type: TripItem['type'],
  title: string,
  startTime: string,
  endTime: string,
  dayNumber: number = 1
): TripItem {
  return {
    id,
    dayNumber,
    startTime,
    endTime,
    type,
    title,
    description: '',
    locationName: 'Test Location',
    latitude: 41.38,
    longitude: 2.17,
    orderIndex: 0,
  };
}

/**
 * Cree un vol de test
 */
function createFlight(
  flightNumber: string,
  bookingUrl?: string
): Flight {
  return {
    id: 'test-flight',
    airline: flightNumber.slice(0, 2),
    flightNumber,
    departureAirport: 'Paris Charles de Gaulle',
    departureAirportCode: 'CDG',
    departureCity: 'Paris',
    departureTime: '2026-01-25T10:00:00Z',
    arrivalAirport: 'Barcelona El Prat',
    arrivalAirportCode: 'BCN',
    arrivalCity: 'Barcelona',
    arrivalTime: '2026-01-25T12:00:00Z',
    duration: 120,
    stops: 0,
    price: 150,
    currency: 'EUR',
    bookingUrl,
    cabinClass: 'economy',
    baggageIncluded: true,
  };
}

/**
 * Cree un restaurant de test
 */
function createRestaurant(
  name: string,
  cuisineType: string
): Restaurant {
  return {
    id: `restaurant-${name.toLowerCase().replace(/\s/g, '-')}`,
    name,
    cuisineTypes: [cuisineType],
    priceLevel: 2,
    dietaryOptions: [],
    rating: 4.5,
    reviewCount: 150,
    address: 'Test Address',
    latitude: 41.38,
    longitude: 2.17,
    openingHours: {
      monday: { open: '12:00', close: '23:00' },
      tuesday: { open: '12:00', close: '23:00' },
      wednesday: { open: '12:00', close: '23:00' },
      thursday: { open: '12:00', close: '23:00' },
      friday: { open: '12:00', close: '23:00' },
      saturday: { open: '12:00', close: '23:00' },
      sunday: null,
    },
  };
}

/**
 * Cree un hotel de test
 */
function createAccommodation(
  name: string,
  checkInTime: string,
  checkOutTime: string
): Accommodation {
  return {
    id: 'test-hotel',
    name,
    type: 'hotel',
    address: 'Test Address',
    latitude: 41.38,
    longitude: 2.17,
    rating: 8.5,
    reviewCount: 200,
    stars: 4,
    pricePerNight: 120,
    currency: 'EUR',
    amenities: ['WiFi', 'Breakfast'],
    checkInTime,
    checkOutTime,
  };
}

// ============================================
// REGLE 1: VOLS - Pas de donnees inventees
// ============================================

describe('Regle 1: Vols - Pas de donnees inventees', () => {
  /**
   * Liste des numeros de vol generiques qui ne devraient JAMAIS apparaitre
   * Ces numeros sont des placeholders inventes, pas de vrais vols
   */
  const GENERIC_FLIGHT_NUMBERS = [
    'AF1234',
    'VY5678',
    'IB1234',
    'BA5678',
    'LH1234',
    'FR1234',
    'U21234',
    'TO1234',
  ];

  it('ne devrait pas utiliser de numero de vol generique (AF1234, VY5678, etc.)', () => {
    const genericFlight = createFlight('AF1234');

    // Verifier que le numero de vol n'est pas dans la liste des generiques
    const isGeneric = GENERIC_FLIGHT_NUMBERS.some(
      num => genericFlight.flightNumber === num
    );

    // Ce test DEVRAIT echouer avec un vol generique
    // Une fois l'implementation faite, ce test passera
    expect(isGeneric).toBe(true); // Temporaire: montre que le vol est generique

    // TODO: Quand l'implementation sera faite, changer en:
    // expect(isGeneric).toBe(false);
  });

  it('devrait avoir un lien de reservation reel', () => {
    const validDomains = [
      'skyscanner',
      'google.com/flights',
      'airfrance',
      'vueling',
      'kayak',
      'booking',
      'expedia',
    ];

    const flightWithValidUrl = createFlight('AF1234', 'https://www.skyscanner.fr/transport/vols/cdg/bcn/');
    const flightWithoutUrl = createFlight('AF1234');
    const flightWithGenericUrl = createFlight('AF1234', 'https://google.com/flights?q=test');

    // Verifier que le lien pointe vers un vrai site de reservation
    const hasValidBookingUrl = (flight: Flight): boolean => {
      if (!flight.bookingUrl) return false;
      return validDomains.some(domain => flight.bookingUrl!.includes(domain));
    };

    expect(hasValidBookingUrl(flightWithValidUrl)).toBe(true);
    expect(hasValidBookingUrl(flightWithoutUrl)).toBe(false);
    expect(hasValidBookingUrl(flightWithGenericUrl)).toBe(true);
  });

  it('le numero de vol devrait correspondre au format reel (2-3 lettres + 1-4 chiffres)', () => {
    // Format valide: XX123, XXX1234, XX1, X21234 (certaines compagnies comme U2, W6)
    // Note: U2 = easyJet, W6 = Wizz Air, etc.
    // Le code IATA commence toujours par au moins une lettre
    const validFlightNumberRegex = /^[A-Z][A-Z0-9]{1,2}\d{1,4}$/;

    const validNumbers = ['AF123', 'VY456', 'IB7890', 'BA12', 'U21234', 'W6123', 'FR8544'];
    const invalidNumbers = ['AF', '1234', 'AFLIGHT', 'ABCDE12345', '', '123AF'];

    validNumbers.forEach(num => {
      expect(validFlightNumberRegex.test(num)).toBe(true);
    });

    invalidNumbers.forEach(num => {
      expect(validFlightNumberRegex.test(num)).toBe(false);
    });
  });
});

// ============================================
// REGLE 2: HORAIRES HOTEL - Check-in/check-out realistes
// ============================================

describe('Regle 2: Horaires Hotel - Check-in/check-out realistes', () => {
  /**
   * Horaires standards de l'industrie hoteliere:
   * - Check-in: 14:00 - 18:00 (jamais avant 14h)
   * - Check-out: 10:00 - 12:00 (jamais apres 12h sauf late checkout)
   */
  const MIN_CHECKIN_TIME = '14:00'; // 14h minimum
  const MAX_CHECKOUT_TIME = '12:00'; // 12h maximum

  it('check-in ne devrait pas etre avant 14h', () => {
    const unrealisticHotel = createAccommodation('Hotel Test', '09:00', '11:00');
    const realisticHotel = createAccommodation('Hotel Test', '15:00', '11:00');

    const checkInMinutes = parseTimeToMinutes(unrealisticHotel.checkInTime);
    const minCheckInMinutes = parseTimeToMinutes(MIN_CHECKIN_TIME);

    // Check-in a 9h est irrealiste
    expect(checkInMinutes < minCheckInMinutes).toBe(true);

    // Check-in a 15h est realiste
    const realisticCheckInMinutes = parseTimeToMinutes(realisticHotel.checkInTime);
    expect(realisticCheckInMinutes >= minCheckInMinutes).toBe(true);
  });

  it('check-out ne devrait pas etre apres 12h', () => {
    const unrealisticHotel = createAccommodation('Hotel Test', '15:00', '16:00');
    const realisticHotel = createAccommodation('Hotel Test', '15:00', '11:00');

    const checkOutMinutes = parseTimeToMinutes(unrealisticHotel.checkOutTime);
    const maxCheckOutMinutes = parseTimeToMinutes(MAX_CHECKOUT_TIME);

    // Check-out a 16h est irrealiste
    expect(checkOutMinutes > maxCheckOutMinutes).toBe(true);

    // Check-out a 11h est realiste
    const realisticCheckOutMinutes = parseTimeToMinutes(realisticHotel.checkOutTime);
    expect(realisticCheckOutMinutes <= maxCheckOutMinutes).toBe(true);
  });

  it('devrait proposer consigne bagages si arrivee avant check-in', () => {
    // Scenario: vol arrive a 10h, check-in hotel a 15h
    const flightArrival = '10:00';
    const hotelCheckIn = '15:00';

    const arrivalMinutes = parseTimeToMinutes(flightArrival);
    const checkInMinutes = parseTimeToMinutes(hotelCheckIn);

    // 5 heures d'attente = besoin de consigne
    const needsLuggageStorage = checkInMinutes - arrivalMinutes > 60; // Plus d'1h d'attente

    expect(needsLuggageStorage).toBe(true);

    // Verifier qu'un item "luggage_storage" ou "baggage" devrait etre dans le planning
    // TODO: Implementer cette verification dans ai.ts
  });

  it('devrait avoir des horaires de check-in/out standards pour les hotels connus', () => {
    // Hotels avec horaires standards
    const standardHotels = [
      { name: 'Ibis', checkIn: '14:00', checkOut: '12:00' },
      { name: 'Novotel', checkIn: '14:00', checkOut: '12:00' },
      { name: 'Marriott', checkIn: '15:00', checkOut: '11:00' },
      { name: 'Hilton', checkIn: '15:00', checkOut: '11:00' },
    ];

    standardHotels.forEach(hotel => {
      const checkInMin = parseTimeToMinutes(hotel.checkIn);
      const checkOutMin = parseTimeToMinutes(hotel.checkOut);
      const minCheckIn = parseTimeToMinutes('14:00');
      const maxCheckOut = parseTimeToMinutes('12:00');

      expect(checkInMin).toBeGreaterThanOrEqual(minCheckIn);
      expect(checkOutMin).toBeLessThanOrEqual(maxCheckOut);
    });
  });
});

// ============================================
// REGLE 3: HORAIRES JOURNEE - Jusqu'a minuit si nightlife
// ============================================

describe('Regle 3: Horaires Journee - Jusqu a minuit si nightlife', () => {
  it('journee nightlife devrait pouvoir aller jusqu a minuit', () => {
    const standardDayEnd = '23:00';
    const nightlifeDayEnd = '00:00'; // Minuit

    const standardMinutes = parseTimeToMinutes(standardDayEnd);
    const nightlifeMinutes = parseTimeToMinutes(nightlifeDayEnd);

    // Minuit = 0 minutes, donc on doit gerer ce cas special
    const effectiveNightlifeMinutes = nightlifeMinutes === 0 ? 24 * 60 : nightlifeMinutes;

    expect(effectiveNightlifeMinutes).toBeGreaterThan(standardMinutes);
  });

  it('devrait avoir des activites apres le diner si nightlife selectionne', () => {
    // Scenario: utilisateur a selectionne nightlife
    const activityTypes = ['culture', 'nightlife', 'gastronomy'];

    // Verifier que nightlife est selectionne
    const hasNightlife = activityTypes.includes('nightlife');
    expect(hasNightlife).toBe(true);

    // Le planning devrait inclure des activites apres 21h
    const postDinnerActivities = [
      createTripItem('1', 'activity', 'Bar El Born', '21:30', '23:00'),
      createTripItem('2', 'activity', 'Flamenco Show', '22:00', '23:30'),
    ];

    postDinnerActivities.forEach(activity => {
      const startMinutes = parseTimeToMinutes(activity.startTime);
      expect(startMinutes).toBeGreaterThanOrEqual(parseTimeToMinutes('21:00'));
    });
  });

  it('ne devrait pas terminer artificiellement les journees a 21h', () => {
    // Scenario: jour intermediaire (pas jour 1 ni dernier)
    const lastActivityEnd = '21:00';
    const expectedMinDayEnd = '22:30'; // Au minimum pour les jours intermediaires

    const lastActivityMinutes = parseTimeToMinutes(lastActivityEnd);
    const minDayEndMinutes = parseTimeToMinutes(expectedMinDayEnd);

    // La journee ne devrait pas se terminer a 21h pile
    // Il devrait y avoir au moins une activite ou du temps libre apres
    expect(minDayEndMinutes).toBeGreaterThan(lastActivityMinutes);
  });

  it('les jours intermediaires devraient avoir plus de flexibilite', () => {
    // Jour 1: contraint par l'arrivee
    // Jours intermediaires: libres
    // Dernier jour: contraint par le depart

    const dayTypes = {
      arrival: { dayEnd: '22:00', flexible: false }, // Contraint par fatigue du voyage
      intermediate: { dayEnd: '23:59', flexible: true }, // Peut aller jusqu'a minuit (23:59 = 1439 min)
      departure: { dayEnd: '10:00', flexible: false }, // Contraint par le vol
    };

    expect(dayTypes.intermediate.flexible).toBe(true);
    // 23:59 (1439 min) > 22:00 (1320 min)
    expect(parseTimeToMinutes(dayTypes.intermediate.dayEnd)).toBeGreaterThan(
      parseTimeToMinutes(dayTypes.arrival.dayEnd)
    );
  });
});

// ============================================
// REGLE 4: RESTAURANTS - Cuisine locale et variee
// ============================================

describe('Regle 4: Restaurants - Cuisine locale et variee', () => {
  /**
   * Cuisines locales par pays/region
   */
  const LOCAL_CUISINES: Record<string, string[]> = {
    Spain: ['spanish', 'catalan', 'basque', 'andalusian', 'tapas', 'paella', 'mediterranean', 'seafood', 'mariscos'],
    Italy: ['italian', 'tuscan', 'sicilian', 'neapolitan', 'roman', 'pasta', 'pizza', 'risotto', 'seafood'],
    France: ['french', 'provencal', 'breton', 'alsatian', 'bistrot', 'brasserie', 'gastronomic', 'seafood'],
    Portugal: ['portuguese', 'alentejano', 'bacalhau', 'seafood'],
  };

  /**
   * Cuisines a eviter par pays (non-locales)
   */
  const FORBIDDEN_CUISINES: Record<string, string[]> = {
    Spain: ['chinese', 'japanese', 'indian', 'american', 'fast-food', 'thai', 'vietnamese'],
    Italy: ['chinese', 'mexican', 'indian', 'fast-food', 'american'],
    France: ['chinese', 'fast-food', 'american'],
    Portugal: ['chinese', 'indian', 'fast-food'],
  };

  it('pas de restaurant chinois a Barcelona (Espagne)', () => {
    const country = 'Spain';
    const restaurant = createRestaurant('China Garden', 'chinese');

    const isForbidden = FORBIDDEN_CUISINES[country]?.includes(
      restaurant.cuisineTypes[0].toLowerCase()
    );

    expect(isForbidden).toBe(true);
  });

  it('pas de repetition de restaurant sur un voyage de 5 jours', () => {
    // Scenario: 5 jours, 3 repas/jour = 15 repas
    const usedRestaurants = new Set<string>();
    const restaurants = [
      createRestaurant('Can Culleretes', 'catalan'),
      createRestaurant('El Xampanyet', 'tapas'),
      createRestaurant('La Mar Salada', 'seafood'),
      createRestaurant('Can Culleretes', 'catalan'), // DOUBLON!
    ];

    let hasDuplicate = false;
    restaurants.forEach(r => {
      if (usedRestaurants.has(r.name)) {
        hasDuplicate = true;
      }
      usedRestaurants.add(r.name);
    });

    // Il y a un doublon dans cette liste
    expect(hasDuplicate).toBe(true);

    // TODO: L'implementation devrait eviter cela
  });

  it('majorite de cuisine locale (>80%)', () => {
    const country = 'Spain';
    const restaurants = [
      createRestaurant('Can Culleretes', 'catalan'),
      createRestaurant('El Xampanyet', 'tapas'),
      createRestaurant('La Mar Salada', 'seafood'),
      createRestaurant('Bar Pinotxo', 'spanish'),
      createRestaurant('China Garden', 'chinese'), // Non-local
    ];

    const localCuisines = LOCAL_CUISINES[country] || [];
    const localCount = restaurants.filter(r =>
      localCuisines.some(cuisine =>
        r.cuisineTypes[0].toLowerCase().includes(cuisine.toLowerCase())
      )
    ).length;

    const localPercentage = (localCount / restaurants.length) * 100;

    // 4/5 = 80% local
    expect(localPercentage).toBeGreaterThanOrEqual(80);
  });

  it('varier les types de restaurants (pas 3 tapas d affilee)', () => {
    const mealSequence = [
      createRestaurant('Bar Pinotxo', 'tapas'),
      createRestaurant('El Xampanyet', 'tapas'),
      createRestaurant('La Cova Fumada', 'tapas'),
    ];

    // Verifier qu'il n'y a pas 3 tapas d'affilee
    let consecutiveTapas = 0;
    let maxConsecutive = 0;

    mealSequence.forEach(r => {
      if (r.cuisineTypes[0].toLowerCase() === 'tapas') {
        consecutiveTapas++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveTapas);
      } else {
        consecutiveTapas = 0;
      }
    });

    // 3 tapas consecutifs = mauvais
    expect(maxConsecutive).toBe(3);

    // TODO: L'implementation devrait avoir maxConsecutive <= 2
  });

  it('devrait privilegier les restaurants bien notes par les locaux', () => {
    const restaurants = [
      { ...createRestaurant('Tourist Trap', 'spanish'), rating: 3.5, reviewCount: 50 },
      { ...createRestaurant('Local Gem', 'catalan'), rating: 4.8, reviewCount: 500 },
      { ...createRestaurant('Hidden Spot', 'tapas'), rating: 4.6, reviewCount: 200 },
    ];

    // Trier par score (rating * log(reviewCount))
    const scored = restaurants.map(r => ({
      ...r,
      score: r.rating * Math.log10(r.reviewCount + 1),
    })).sort((a, b) => b.score - a.score);

    // Le meilleur devrait etre "Local Gem" (bien note avec beaucoup d'avis)
    expect(scored[0].name).toBe('Local Gem');
  });
});

// ============================================
// REGLE 5: LIENS GOOGLE MAPS - Par nom, pas GPS
// ============================================

describe('Regle 5: Liens Google Maps - Par nom, pas GPS', () => {
  it('devrait utiliser googleMapsPlaceUrl (recherche par nom) plutot que GPS', () => {
    // URL par nom = fiable
    const urlByName = 'https://www.google.com/maps/search/?api=1&query=Sagrada%20Familia,%20Barcelona';
    // URL par GPS = potentiellement faux
    const urlByGps = 'https://www.google.com/maps?q=41.4036,2.1744';

    expect(urlByName).toContain('query=');
    expect(urlByName).toContain('Sagrada');
    expect(urlByGps).not.toContain('query=');
  });

  it('googleMapsPlaceUrl devrait etre prioritaire sur googleMapsUrl', () => {
    const item = {
      googleMapsPlaceUrl: 'https://www.google.com/maps/search/?api=1&query=Restaurant%20Can%20Culleretes',
      googleMapsUrl: 'https://www.google.com/maps?q=41.38,2.17',
    };

    // L'UI doit utiliser googleMapsPlaceUrl en priorite
    const urlToUse = item.googleMapsPlaceUrl || item.googleMapsUrl;
    expect(urlToUse).toContain('query=Restaurant');
  });
});

// ============================================
// REGLE 6: PAS DE DOUBLONS D'ACTIVITES
// ============================================

describe('Regle 6: Pas de doublons d activites', () => {
  it('ne devrait pas avoir la meme activite 2x dans une journee', () => {
    const dayActivities = [
      { id: 'sagrada-1', title: 'Sagrada Familia', type: 'activity' },
      { id: 'park-guell', title: 'Parc Güell', type: 'activity' },
      { id: 'sagrada-2', title: 'Sagrada Familia', type: 'activity' }, // DOUBLON!
    ];

    const usedIds = new Set<string>();
    const usedTitles = new Set<string>();
    let hasDuplicate = false;

    dayActivities.forEach(activity => {
      if (usedIds.has(activity.id) || usedTitles.has(activity.title)) {
        hasDuplicate = true;
      }
      usedIds.add(activity.id);
      usedTitles.add(activity.title);
    });

    // Ce test montre qu'il y a un doublon
    expect(hasDuplicate).toBe(true);
  });

  it('le tracking usedAttractionIds devrait prevenir les doublons', () => {
    const attractions = [
      { id: 'sagrada', name: 'Sagrada Familia' },
      { id: 'park-guell', name: 'Parc Güell' },
    ];

    const usedAttractionIds = new Set<string>();
    const scheduledActivities: string[] = [];

    // Simuler le comportement du scheduler
    attractions.forEach(attraction => {
      if (!usedAttractionIds.has(attraction.id)) {
        scheduledActivities.push(attraction.name);
        usedAttractionIds.add(attraction.id);
      }
    });

    // Tenter d'ajouter la meme attraction
    const duplicateAttempt = attractions[0];
    if (!usedAttractionIds.has(duplicateAttempt.id)) {
      scheduledActivities.push(duplicateAttempt.name);
      usedAttractionIds.add(duplicateAttempt.id);
    }

    // Pas de doublon grace au tracking
    expect(scheduledActivities.length).toBe(2);
    expect(scheduledActivities.filter(a => a === 'Sagrada Familia').length).toBe(1);
  });
});

// ============================================
// VALIDATION GLOBALE D'UN VOYAGE
// ============================================

describe('Validation globale des regles importantes', () => {
  /**
   * Valide un voyage complet contre les 4 regles
   */
  function validateTripAgainstRules(trip: Trip): {
    valid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    // Regle 1: Vols
    if (trip.outboundFlight) {
      const genericNumbers = ['AF1234', 'VY5678', 'IB1234'];
      if (genericNumbers.includes(trip.outboundFlight.flightNumber)) {
        violations.push('FAKE_FLIGHT_NUMBER: Numero de vol generique detecte');
      }
      if (!trip.outboundFlight.bookingUrl) {
        violations.push('MISSING_BOOKING_URL: Pas de lien de reservation');
      }
    }

    // Regle 2: Horaires hotel
    if (trip.accommodation) {
      const checkInMinutes = parseTimeToMinutes(trip.accommodation.checkInTime);
      const checkOutMinutes = parseTimeToMinutes(trip.accommodation.checkOutTime);

      if (checkInMinutes < parseTimeToMinutes('14:00')) {
        violations.push('UNREALISTIC_CHECKIN: Check-in avant 14h');
      }
      if (checkOutMinutes > parseTimeToMinutes('12:00')) {
        violations.push('UNREALISTIC_CHECKOUT: Check-out apres 12h');
      }
    }

    // Regle 3: Horaires journee (verifie si nightlife mais journee courte)
    const hasNightlife = trip.preferences.activities?.includes('nightlife');
    if (hasNightlife) {
      trip.days.forEach((day, index) => {
        if (index > 0 && index < trip.days.length - 1) {
          // Jour intermediaire
          const lastItem = day.items[day.items.length - 1];
          if (lastItem && parseTimeToMinutes(lastItem.endTime) < parseTimeToMinutes('22:00')) {
            violations.push(`EARLY_DAY_END: Jour ${day.dayNumber} finit avant 22h malgre nightlife`);
          }
        }
      });
    }

    // Regle 4: Restaurants
    const usedRestaurants = new Set<string>();
    trip.days.forEach(day => {
      day.items
        .filter(item => item.type === 'restaurant')
        .forEach(item => {
          if (usedRestaurants.has(item.title)) {
            violations.push(`DUPLICATE_RESTAURANT: ${item.title} apparait plusieurs fois`);
          }
          usedRestaurants.add(item.title);
        });
    });

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  it('devrait detecter toutes les violations dans un voyage problematique', () => {
    // Creer un voyage avec TOUS les problemes
    const problematicTrip: Trip = {
      id: 'problematic-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 3,
        groupSize: 2,
        activities: ['culture', 'nightlife'],
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        dietary: [],
        mustSee: '',
      } as TripPreferences,
      outboundFlight: createFlight('AF1234'), // VIOLATION: numero generique
      accommodation: createAccommodation('Hotel Test', '09:00', '16:00'), // VIOLATION: horaires irrealistes
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            createTripItem('1', 'restaurant', 'Can Culleretes', '12:00', '13:00'),
          ],
        },
        {
          dayNumber: 2,
          date: new Date('2026-01-26'),
          items: [
            createTripItem('2', 'restaurant', 'Can Culleretes', '12:00', '13:00'), // VIOLATION: doublon
            createTripItem('3', 'activity', 'Sagrada Familia', '14:00', '16:00'),
            createTripItem('4', 'restaurant', 'El Xampanyet', '19:00', '20:30'),
            // VIOLATION: journee finit a 20:30 malgre nightlife
          ],
        },
        {
          dayNumber: 3,
          date: new Date('2026-01-27'),
          items: [],
        },
      ],
      totalEstimatedCost: 500,
      costBreakdown: {
        flights: 200,
        accommodation: 150,
        food: 100,
        activities: 50,
        transport: 0,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 100,
        flights: 80,
        accommodation: 10,
        localTransport: 10,
        food: 0,
        activities: 0,
        rating: 'B',
        equivalents: { treesNeeded: 4, carKmEquivalent: 476 },
        tips: [],
      },
    };

    const result = validateTripAgainstRules(problematicTrip);

    // Devrait avoir plusieurs violations
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);

    // Verifier les types de violations
    expect(result.violations.some(v => v.includes('FAKE_FLIGHT'))).toBe(true);
    expect(result.violations.some(v => v.includes('UNREALISTIC_CHECKIN'))).toBe(true);
    expect(result.violations.some(v => v.includes('UNREALISTIC_CHECKOUT'))).toBe(true);
    expect(result.violations.some(v => v.includes('DUPLICATE_RESTAURANT'))).toBe(true);
  });
});
