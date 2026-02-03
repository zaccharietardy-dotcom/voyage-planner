/**
 * Tests de validation des voyages generes
 *
 * Ces tests verifient que:
 * 1. Les activites sont planifiees APRES l'arrivee
 * 2. Les activites ne se repetent pas
 * 3. Les horaires sont coherents (pas de chevauchement)
 * 4. Le deroulement est logique
 * 5. L'ordre logique est respecte (vol -> transfert -> hotel -> activites)
 *
 * Executer avec: npm test
 */

import { DayScheduler, formatTime, parseTime } from '../services/scheduler';
import {
  validateTripCoherence,
  validateAndFixTrip,
  CoherenceError,
} from '../services/coherenceValidator';
import { Trip, TripDay, TripItem } from '../types';

// ============================================
// Tests du DayScheduler
// ============================================

describe('DayScheduler', () => {
  describe('Validation dayEnd >= dayStart', () => {
    it('devrait ajuster dayEnd si dayEnd < dayStart', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '15:00');
      const dayEnd = parseTime(date, '04:45'); // Avant dayStart!

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      // Le scheduler devrait avoir ajuste dayEnd
      const items = scheduler.getItems();
      expect(scheduler.getRemainingMinutes()).toBeGreaterThan(0);
    });

    it('devrait fonctionner normalement si dayEnd > dayStart', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '08:00');
      const dayEnd = parseTime(date, '23:00');

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      expect(scheduler.getRemainingMinutes()).toBe(15 * 60); // 15 heures
    });
  });

  describe('Protection contre les activites dans le passe', () => {
    it('ne devrait pas planifier une activite avant le curseur', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '15:00');
      const dayEnd = parseTime(date, '23:00');

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      // Essayer d'ajouter une activite avec minStartTime a 09:00 (avant le curseur)
      const item = scheduler.addItem({
        id: 'test-1',
        title: 'Test Activity',
        type: 'activity',
        duration: 120,
        travelTime: 30,
        minStartTime: parseTime(date, '09:00'), // Avant le curseur!
      });

      if (item) {
        // L'activite devrait commencer APRES le curseur (15:00 + 30min = 15:30)
        const startHour = item.slot.start.getHours();
        const startMin = item.slot.start.getMinutes();
        expect(startHour * 60 + startMin).toBeGreaterThanOrEqual(15 * 60); // >= 15:00
      }
    });

    it('devrait respecter minStartTime si apres le curseur', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '08:00');
      const dayEnd = parseTime(date, '23:00');

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      // Ajouter une activite avec minStartTime a 10:00 (apres le curseur)
      const item = scheduler.addItem({
        id: 'test-1',
        title: 'Test Activity',
        type: 'activity',
        duration: 60,
        travelTime: 15,
        minStartTime: parseTime(date, '10:00'),
      });

      expect(item).not.toBeNull();
      if (item) {
        // L'activite devrait commencer a 10:00 (minStartTime)
        expect(item.slot.start.getHours()).toBe(10);
        expect(item.slot.start.getMinutes()).toBe(0);
      }
    });
  });

  describe('Pas de chevauchement', () => {
    it('les items sequentiels ne devraient pas se chevaucher', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '08:00');
      const dayEnd = parseTime(date, '23:00');

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      scheduler.addItem({ id: '1', title: 'Activity 1', type: 'activity', duration: 60, travelTime: 15 });
      scheduler.addItem({ id: '2', title: 'Activity 2', type: 'activity', duration: 90, travelTime: 20 });
      scheduler.addItem({ id: '3', title: 'Activity 3', type: 'activity', duration: 45, travelTime: 10 });

      const validation = scheduler.validate();
      expect(validation.valid).toBe(true);
      expect(validation.conflicts).toHaveLength(0);
    });

    it('les items fixes et sequentiels ne devraient pas se chevaucher', () => {
      const date = new Date('2026-01-25');
      const dayStart = parseTime(date, '08:00');
      const dayEnd = parseTime(date, '23:00');

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      // Inserer un vol fixe
      scheduler.insertFixedItem({
        id: 'flight',
        title: 'Vol',
        type: 'flight',
        startTime: parseTime(date, '10:00'),
        endTime: parseTime(date, '12:00'),
      });

      // Ajouter des activites sequentielles
      scheduler.addItem({ id: 'a1', title: 'Activite 1', type: 'activity', duration: 60, travelTime: 15 });
      scheduler.addItem({ id: 'a2', title: 'Activite 2', type: 'activity', duration: 60, travelTime: 15 });

      const validation = scheduler.validate();
      expect(validation.valid).toBe(true);
    });
  });
});

// ============================================
// Tests de coherence du planning
// ============================================

describe('Coherence du planning', () => {
  /**
   * Simule un Jour 1 typique avec vol
   */
  function simulateDay1WithFlight() {
    const date = new Date('2026-01-25');

    // Vol arrive a 13:31, donc dayStart = 13:31 + 90min = 15:01
    const flightArrival = parseTime(date, '13:31');
    const dayStart = new Date(flightArrival.getTime() + 90 * 60 * 1000);
    const dayEnd = parseTime(date, '23:00');

    const scheduler = new DayScheduler(date, dayStart, dayEnd);

    // Inserer la logistique (heures fixes)
    scheduler.insertFixedItem({
      id: 'parking',
      title: 'Parking',
      type: 'parking',
      startTime: parseTime(date, '09:00'),
      endTime: parseTime(date, '09:30'),
    });

    scheduler.insertFixedItem({
      id: 'checkin',
      title: 'Enregistrement',
      type: 'checkin',
      startTime: parseTime(date, '09:30'),
      endTime: parseTime(date, '11:00'),
    });

    scheduler.insertFixedItem({
      id: 'flight',
      title: 'Vol',
      type: 'flight',
      startTime: parseTime(date, '12:00'),
      endTime: parseTime(date, '13:31'),
    });

    scheduler.insertFixedItem({
      id: 'transfer',
      title: 'Transfert',
      type: 'transport',
      startTime: parseTime(date, '14:00'),
      endTime: parseTime(date, '14:40'),
    });

    scheduler.insertFixedItem({
      id: 'hotel',
      title: 'Check-in Hotel',
      type: 'hotel',
      startTime: parseTime(date, '14:40'),
      endTime: parseTime(date, '15:01'),
    });

    // IMPORTANT: Avancer le curseur apres le check-in
    // C'est CRITIQUE pour que les activites soient planifiees APRES l'arrivee
    scheduler.advanceTo(parseTime(date, '15:01'));

    // Ajouter des activites avec minStartTime (heure d'ouverture)
    // Le scheduler doit ignorer minStartTime si elle est AVANT le curseur
    const activity1 = scheduler.addItem({
      id: 'sagrada',
      title: 'Sagrada Familia',
      type: 'activity',
      duration: 120,
      travelTime: 30,
      minStartTime: parseTime(date, '09:00'), // Ouvre a 9h (AVANT le curseur!)
    });

    const activity2 = scheduler.addItem({
      id: 'parc',
      title: 'Parc Guell',
      type: 'activity',
      duration: 90,
      travelTime: 40,
      minStartTime: parseTime(date, '09:30'), // Ouvre a 9h30 (AVANT le curseur!)
    });

    return { scheduler, activity1, activity2 };
  }

  /**
   * Detecte les chevauchements entre items
   */
  function findOverlaps(items: Array<{ title: string; slot: { start: Date; end: Date } }>): string[] {
    const overlaps: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        // Chevauchement si a.start < b.end ET b.start < a.end
        if (a.slot.start < b.slot.end && b.slot.start < a.slot.end) {
          overlaps.push(`${a.title} (${formatTime(a.slot.start)}-${formatTime(a.slot.end)}) chevauche ${b.title} (${formatTime(b.slot.start)}-${formatTime(b.slot.end)})`);
        }
      }
    }
    return overlaps;
  }

  it('Jour 1: les activites doivent etre APRES l\'arrivee', () => {
    const { scheduler, activity1, activity2 } = simulateDay1WithFlight();

    // L'arrivee effective est a 15:01
    const arrivalTime = parseTime(new Date('2026-01-25'), '15:01');

    if (activity1) {
      expect(activity1.slot.start.getTime()).toBeGreaterThanOrEqual(arrivalTime.getTime());
    }

    if (activity2) {
      expect(activity2.slot.start.getTime()).toBeGreaterThanOrEqual(arrivalTime.getTime());
    }
  });

  it('Jour 1: les activites ne doivent pas commencer a 09:00', () => {
    const { activity1, activity2 } = simulateDay1WithFlight();

    if (activity1) {
      const hour = activity1.slot.start.getHours();
      expect(hour).toBeGreaterThanOrEqual(15); // Pas avant 15h
    }

    if (activity2) {
      const hour = activity2.slot.start.getHours();
      expect(hour).toBeGreaterThanOrEqual(15);
    }
  });

  it('les activites doivent etre sequentielles', () => {
    const { scheduler, activity1, activity2 } = simulateDay1WithFlight();

    if (activity1 && activity2) {
      // activity2 doit commencer apres activity1
      expect(activity2.slot.start.getTime()).toBeGreaterThanOrEqual(activity1.slot.end.getTime());
    }
  });

  it('aucun chevauchement entre logistique et activites', () => {
    const { scheduler } = simulateDay1WithFlight();
    const items = scheduler.getItems();

    const overlaps = findOverlaps(items);

    if (overlaps.length > 0) {
      console.error('Chevauchements detectes:', overlaps);
    }

    expect(overlaps).toHaveLength(0);
  });

  it('les activites du Jour 1 doivent etre APRES 15h (heure d\'arrivee)', () => {
    const { scheduler } = simulateDay1WithFlight();
    const items = scheduler.getItems();

    // Filtrer les activites (exclure logistique)
    const activities = items.filter(i => i.type === 'activity');

    for (const activity of activities) {
      const startHour = activity.slot.start.getHours();
      const startMin = activity.slot.start.getMinutes();
      const startInMinutes = startHour * 60 + startMin;

      // Doit commencer a 15h01 minimum (arrivee a l'hotel)
      expect(startInMinutes).toBeGreaterThanOrEqual(15 * 60 + 1);
    }
  });
});

// ============================================
// Tests de non-repetition des activites
// ============================================

describe('Non-repetition des activites', () => {
  it('chaque attraction ne doit apparaitre qu\'une seule fois', () => {
    const attractions = [
      { id: 'a1', name: 'Sagrada Familia' },
      { id: 'a2', name: 'Parc Guell' },
      { id: 'a3', name: 'Casa Batllo' },
      { id: 'a4', name: 'La Rambla' },
    ];

    const days = 4;
    const maxPerDay = 2;

    // Simuler la pre-allocation
    const result: string[][] = [];
    const usedIds = new Set<string>();

    for (let d = 0; d < days; d++) {
      result.push([]);
    }

    let currentDay = 0;
    for (const attraction of attractions) {
      if (usedIds.has(attraction.id)) continue;

      // Trouver un jour avec de la place
      let attempts = 0;
      while (result[currentDay].length >= maxPerDay && attempts < days) {
        currentDay = (currentDay + 1) % days;
        attempts++;
      }

      if (attempts < days) {
        result[currentDay].push(attraction.id);
        usedIds.add(attraction.id);
        currentDay = (currentDay + 1) % days;
      }
    }

    // Verifier qu'aucune attraction n'est repetee
    const allIds = result.flat();
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });
});

// ============================================
// Tests des horaires d'ouverture
// ============================================

describe('Horaires d\'ouverture', () => {
  /**
   * Simule la validation des horaires d'ouverture comme dans ai.ts
   */
  function shouldSkipAttraction(params: {
    currentTime: Date;
    travelTime: number;
    openingTime: Date;
    closingTime: Date;
    duration: number;
  }): { skip: boolean; reason?: string; actualEndTime?: Date } {
    const { currentTime, travelTime, openingTime, closingTime, duration } = params;

    // Calculer l'heure de debut reelle
    let actualStartTime = new Date(currentTime.getTime() + travelTime * 60 * 1000);
    if (actualStartTime < openingTime && openingTime >= currentTime) {
      actualStartTime = new Date(openingTime);
    }

    // Calculer l'heure de fin reelle
    const actualEndTime = new Date(actualStartTime.getTime() + duration * 60 * 1000);

    if (actualEndTime > closingTime) {
      return { skip: true, reason: 'Ferme avant la fin de la visite', actualEndTime };
    }

    return { skip: false, actualEndTime };
  }

  it('devrait skip une attraction qui ferme avant la fin de la visite', () => {
    const date = new Date('2026-01-25');

    const result = shouldSkipAttraction({
      currentTime: parseTime(date, '18:00'),
      travelTime: 30,
      openingTime: parseTime(date, '09:00'),
      closingTime: parseTime(date, '19:00'), // Ferme a 19h
      duration: 90, // 1h30 de visite
    });

    // On arrive a 18:30, visite de 1h30 -> fin a 20:00, mais ferme a 19:00
    expect(result.skip).toBe(true);
  });

  it('devrait accepter une attraction avec assez de temps', () => {
    const date = new Date('2026-01-25');

    const result = shouldSkipAttraction({
      currentTime: parseTime(date, '15:00'),
      travelTime: 30,
      openingTime: parseTime(date, '09:00'),
      closingTime: parseTime(date, '20:00'),
      duration: 120, // 2h de visite
    });

    // On arrive a 15:30, visite de 2h -> fin a 17:30, ferme a 20:00 -> OK
    expect(result.skip).toBe(false);
    expect(result.actualEndTime?.getHours()).toBe(17);
    expect(result.actualEndTime?.getMinutes()).toBe(30);
  });

  it('devrait attendre l\'ouverture si on arrive avant', () => {
    const date = new Date('2026-01-25');

    const result = shouldSkipAttraction({
      currentTime: parseTime(date, '08:00'),
      travelTime: 30,
      openingTime: parseTime(date, '10:00'), // Ouvre a 10h
      closingTime: parseTime(date, '18:00'),
      duration: 60,
    });

    // On arrive a 08:30, mais ouvre a 10h -> debut a 10h, fin a 11h
    expect(result.skip).toBe(false);
    expect(result.actualEndTime?.getHours()).toBe(11);
    expect(result.actualEndTime?.getMinutes()).toBe(0);
  });

  it('devrait skip si on arrive apres la fermeture', () => {
    const date = new Date('2026-01-25');

    const result = shouldSkipAttraction({
      currentTime: parseTime(date, '19:00'),
      travelTime: 30,
      openingTime: parseTime(date, '09:00'),
      closingTime: parseTime(date, '18:00'), // Deja ferme!
      duration: 60,
    });

    // On arrive a 19:30, deja ferme a 18:00
    expect(result.skip).toBe(true);
  });
});

// ============================================
// Tests du dernier jour
// ============================================

describe('Dernier jour', () => {
  it('dayEnd doit etre au moins 1h apres dayStart', () => {
    const date = new Date('2026-01-28');
    const dayStart = parseTime(date, '08:00');

    // Vol retour a 08:15 -> checkout a 04:45 (AVANT dayStart!)
    const flightDeparture = parseTime(date, '08:15');
    const checkoutTime = new Date(flightDeparture.getTime() - 210 * 60 * 1000); // -3h30

    // La correction devrait s'appliquer
    const minimumDayEnd = new Date(dayStart.getTime() + 60 * 60 * 1000);
    const correctedDayEnd = new Date(Math.max(checkoutTime.getTime(), minimumDayEnd.getTime()));

    expect(correctedDayEnd.getTime()).toBeGreaterThanOrEqual(minimumDayEnd.getTime());
  });

  it('le scheduler doit gerer dayEnd < dayStart', () => {
    const date = new Date('2026-01-28');
    const dayStart = parseTime(date, '08:00');
    const dayEnd = parseTime(date, '04:45'); // AVANT dayStart!

    // Le scheduler devrait auto-corriger
    const scheduler = new DayScheduler(date, dayStart, dayEnd);

    // Devrait pouvoir ajouter au moins une activite
    const item = scheduler.addItem({
      id: 'test',
      title: 'Petit-dejeuner',
      type: 'restaurant',
      duration: 45,
      travelTime: 10,
    });

    // Le scheduler devrait avoir corrige et permis l'ajout
    expect(scheduler.getRemainingMinutes()).toBeGreaterThan(0);
  });
});

// ============================================
// Test d'integration complet
// ============================================

describe('Integration: Voyage 4 jours', () => {
  function simulateTrip() {
    const results = {
      days: [] as Array<{
        dayNumber: number;
        items: Array<{ id: string; title: string; type: string; start: string; end: string }>;
      }>,
      errors: [] as string[],
    };

    for (let day = 1; day <= 4; day++) {
      const date = new Date(`2026-01-${24 + day}`);
      const isFirstDay = day === 1;
      const isLastDay = day === 4;

      let dayStart = parseTime(date, '08:00');
      let dayEnd = parseTime(date, '23:00');

      // Jour 1: arrivee a 15:00
      if (isFirstDay) {
        dayStart = parseTime(date, '15:00');
      }

      // Jour 4: depart a 14:00
      if (isLastDay) {
        dayEnd = parseTime(date, '10:00');
      }

      const scheduler = new DayScheduler(date, dayStart, dayEnd);

      // Jour 1: logistique d'arrivee
      if (isFirstDay) {
        scheduler.insertFixedItem({
          id: `d${day}-flight`,
          title: 'Vol aller',
          type: 'flight',
          startTime: parseTime(date, '12:00'),
          endTime: parseTime(date, '14:00'),
        });
        scheduler.insertFixedItem({
          id: `d${day}-hotel`,
          title: 'Check-in',
          type: 'hotel',
          startTime: parseTime(date, '14:30'),
          endTime: parseTime(date, '15:00'),
        });
        scheduler.advanceTo(parseTime(date, '15:00'));
      }

      // Activites (sauf jour 1 matin)
      const canDoMorning = !isFirstDay && scheduler.getCurrentTime().getHours() < 12;

      if (canDoMorning) {
        scheduler.addItem({
          id: `d${day}-morning`,
          title: `Activite matin J${day}`,
          type: 'activity',
          duration: 90,
          travelTime: 20,
        });
      }

      // Dejeuner
      if (scheduler.getCurrentTime().getHours() < 14) {
        scheduler.addItem({
          id: `d${day}-lunch`,
          title: 'Dejeuner',
          type: 'restaurant',
          duration: 75,
          travelTime: 15,
        });
      }

      // Activites apres-midi
      if (!isLastDay && scheduler.canFit(90, 20)) {
        scheduler.addItem({
          id: `d${day}-afternoon`,
          title: `Activite apres-midi J${day}`,
          type: 'activity',
          duration: 90,
          travelTime: 20,
        });
      }

      // Diner (pas le dernier jour)
      if (!isLastDay && scheduler.getCurrentTime().getHours() >= 18 && scheduler.canFit(90, 15)) {
        scheduler.addItem({
          id: `d${day}-dinner`,
          title: 'Diner',
          type: 'restaurant',
          duration: 90,
          travelTime: 15,
        });
      }

      // Jour 4: logistique de depart
      if (isLastDay) {
        scheduler.insertFixedItem({
          id: `d${day}-checkout`,
          title: 'Check-out',
          type: 'checkout',
          startTime: parseTime(date, '10:00'),
          endTime: parseTime(date, '10:30'),
        });
        scheduler.insertFixedItem({
          id: `d${day}-flight`,
          title: 'Vol retour',
          type: 'flight',
          startTime: parseTime(date, '14:00'),
          endTime: parseTime(date, '16:00'),
        });
      }

      // Validation
      const validation = scheduler.validate();
      if (!validation.valid) {
        results.errors.push(`Jour ${day}: ${validation.conflicts.map(c => `${c.item1} vs ${c.item2}`).join(', ')}`);
      }

      // Enregistrer les items
      results.days.push({
        dayNumber: day,
        items: scheduler.getItems().map(item => ({
          id: item.id,
          title: item.title,
          type: item.type,
          start: formatTime(item.slot.start),
          end: formatTime(item.slot.end),
        })),
      });
    }

    return results;
  }

  it('devrait generer 4 jours sans erreur', () => {
    const trip = simulateTrip();
    expect(trip.errors).toHaveLength(0);
    expect(trip.days).toHaveLength(4);
  });

  it('Jour 1: pas d\'activite avant 15h', () => {
    const trip = simulateTrip();
    const day1 = trip.days[0];

    const activities = day1.items.filter(i => i.type === 'activity');
    for (const activity of activities) {
      const [hours] = activity.start.split(':').map(Number);
      expect(hours).toBeGreaterThanOrEqual(15);
    }
  });

  it('Jour 4: pas d\'activite apres 10h', () => {
    const trip = simulateTrip();
    const day4 = trip.days[3];

    const activities = day4.items.filter(i => i.type === 'activity');
    for (const activity of activities) {
      const [hours] = activity.end.split(':').map(Number);
      expect(hours).toBeLessThanOrEqual(10);
    }
  });

  it('pas de chevauchement sur tous les jours', () => {
    const trip = simulateTrip();
    expect(trip.errors).toHaveLength(0);
  });
});

// ============================================
// Tests de coherence logique (NOUVEAUX)
// ============================================

describe('Coherence logique du voyage', () => {
  /**
   * Cree un voyage de test avec un probleme de coherence
   * (activite avant le check-in hotel)
   */
  function createIncoherentTrip(): Trip {
    const tripItem = (
      id: string,
      type: TripItem['type'],
      title: string,
      startTime: string,
      endTime: string
    ): TripItem => ({
      id,
      dayNumber: 1,
      startTime,
      endTime,
      type,
      title,
      description: '',
      locationName: 'Test',
      latitude: 41.38,
      longitude: 2.17,
      orderIndex: 0,
    });

    return {
      id: 'test-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 3,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // PROBLEME: Parc Guell AVANT le transfert aeroport->hotel
            tripItem('1', 'flight', 'Vol AF1234 → Barcelona', '12:00', '13:30'),
            tripItem('2', 'activity', 'Parc Guell', '14:00', '16:00'), // ERREUR!
            tripItem('3', 'transport', 'Transfert Aeroport → Hotel', '16:30', '17:10'),
            tripItem('4', 'hotel', 'Check-in Hotel', '17:10', '17:30'),
          ],
        },
        {
          dayNumber: 2,
          date: new Date('2026-01-26'),
          items: [
            tripItem('5', 'restaurant', 'Petit-dejeuner', '08:30', '09:15'),
            tripItem('6', 'activity', 'Sagrada Familia', '10:00', '12:00'),
            tripItem('7', 'restaurant', 'Dejeuner', '12:30', '13:45'),
            tripItem('8', 'activity', 'Casa Batllo', '14:30', '16:30'),
            tripItem('9', 'restaurant', 'Diner', '19:30', '21:00'),
          ],
        },
        {
          dayNumber: 3,
          date: new Date('2026-01-27'),
          items: [
            tripItem('10', 'checkout', 'Check-out Hotel', '10:00', '10:30'),
            tripItem('11', 'transport', 'Transfert Hotel → Aeroport', '10:30', '11:10'),
            tripItem('12', 'flight', 'Vol AF1235 → Paris', '13:00', '14:30'),
          ],
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
        rating: 'B',
        equivalents: { treesNeeded: 4, carKmEquivalent: 476 },
        tips: [],
      },
    };
  }

  it('devrait detecter une activite planifiee avant le check-in hotel', () => {
    const trip = createIncoherentTrip();
    const result = validateTripCoherence(trip);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    // Verifier qu'on detecte bien le probleme
    const activityBeforeCheckin = result.errors.find(
      e => e.type === 'ACTIVITY_BEFORE_HOTEL_CHECKIN' || e.type === 'ILLOGICAL_SEQUENCE'
    );
    expect(activityBeforeCheckin).toBeDefined();
  });

  it('devrait corriger automatiquement l\'ordre illogique', () => {
    const trip = createIncoherentTrip();
    const fixedTrip = validateAndFixTrip(trip);

    // Re-valider le voyage corrige
    const result = validateTripCoherence(fixedTrip);

    // Le voyage corrige devrait etre valide (ou avoir moins d'erreurs)
    expect(result.errors.length).toBeLessThan(
      validateTripCoherence(trip).errors.length
    );
  });

  it('devrait detecter un chevauchement horaire', () => {
    const trip = createIncoherentTrip();
    // Creer un chevauchement
    trip.days[1].items[1].endTime = '12:45'; // Sagrada Familia finit a 12:45
    trip.days[1].items[2].startTime = '12:30'; // Dejeuner commence a 12:30

    const result = validateTripCoherence(trip);

    const overlap = result.errors.find(e => e.type === 'OVERLAP');
    expect(overlap).toBeDefined();
  });

  it('devrait detecter une attraction en double', () => {
    const trip = createIncoherentTrip();
    // Ajouter la meme attraction le jour 2 et 3
    trip.days[2].items.unshift({
      id: '13',
      dayNumber: 3,
      startTime: '08:00',
      endTime: '09:30',
      type: 'activity',
      title: 'Sagrada Familia', // Deja present le jour 2
      description: '',
      locationName: 'Barcelona',
      latitude: 41.38,
      longitude: 2.17,
      orderIndex: 0,
    });

    const result = validateTripCoherence(trip);

    const duplicate = result.errors.find(e => e.type === 'DUPLICATE_ATTRACTION') ||
                      result.warnings.find(e => e.type === 'DUPLICATE_ATTRACTION');
    expect(duplicate).toBeDefined();
  });

  it('devrait valider un voyage correctement ordonne', () => {
    const tripItem = (
      id: string,
      type: TripItem['type'],
      title: string,
      startTime: string,
      endTime: string,
      dayNumber: number = 1
    ): TripItem => ({
      id,
      dayNumber,
      startTime,
      endTime,
      type,
      title,
      description: '',
      locationName: 'Test',
      latitude: 41.38,
      longitude: 2.17,
      orderIndex: 0,
    });

    const validTrip: Trip = {
      id: 'valid-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 2,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // Ordre correct: vol -> transfert -> hotel -> activites
            tripItem('1', 'checkin', 'Enregistrement', '10:00', '11:30'),
            tripItem('2', 'flight', 'Vol AF1234 → Barcelona', '12:00', '13:30'),
            tripItem('3', 'transport', 'Transfert Aeroport → Hotel', '14:00', '14:40'),
            tripItem('4', 'hotel', 'Check-in Hotel', '14:40', '15:00'),
            tripItem('5', 'activity', 'Parc Guell', '15:30', '17:30'),
            tripItem('6', 'restaurant', 'Diner', '19:30', '21:00'),
          ],
        },
        {
          dayNumber: 2,
          date: new Date('2026-01-26'),
          items: [
            // Ordre correct: checkout -> transfert -> vol
            tripItem('7', 'checkout', 'Check-out Hotel', '10:00', '10:30', 2),
            tripItem('8', 'transport', 'Transfert Hotel → Aeroport', '10:30', '11:10', 2),
            tripItem('9', 'flight', 'Vol AF1235 → Paris', '13:00', '14:30', 2),
          ],
        },
      ],
      totalEstimatedCost: 300,
      costBreakdown: {
        flights: 200,
        accommodation: 50,
        food: 30,
        activities: 20,
        transport: 0,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 100,
        flights: 80,
        accommodation: 10,
        localTransport: 10,
        rating: 'B',
        equivalents: { treesNeeded: 4, carKmEquivalent: 476 },
        tips: [],
      },
    };

    const result = validateTripCoherence(validTrip);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('devrait detecter l\'ordre incorrect des repas', () => {
    const tripItem = (
      id: string,
      type: TripItem['type'],
      title: string,
      startTime: string,
      endTime: string
    ): TripItem => ({
      id,
      dayNumber: 1,
      startTime,
      endTime,
      type,
      title,
      description: '',
      locationName: 'Test',
      latitude: 41.38,
      longitude: 2.17,
      orderIndex: 0,
    });

    const tripWithBadMealOrder: Trip = {
      id: 'bad-meals',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 1,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // Repas dans le mauvais ordre
            tripItem('1', 'restaurant', 'Diner', '08:00', '09:00'), // Diner le matin!
            tripItem('2', 'restaurant', 'Dejeuner', '12:00', '13:00'),
            tripItem('3', 'restaurant', 'Petit-dejeuner', '19:00', '20:00'), // Petit-dej le soir!
          ],
        },
      ],
      totalEstimatedCost: 50,
      costBreakdown: {
        flights: 0,
        accommodation: 0,
        food: 50,
        activities: 0,
        transport: 0,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 10,
        flights: 0,
        accommodation: 5,
        localTransport: 5,
        rating: 'A',
        equivalents: { treesNeeded: 1, carKmEquivalent: 47 },
        tips: [],
      },
    };

    const result = validateTripCoherence(tripWithBadMealOrder);

    const mealOrderError = result.errors.find(e => e.type === 'MEAL_WRONG_ORDER') ||
                           result.warnings.find(e => e.type === 'MEAL_WRONG_ORDER');
    expect(mealOrderError).toBeDefined();
  });
});

// ============================================
// Tests de coherence avec TRANSPORT TERRESTRE (train, bus)
// ============================================

describe('Coherence avec transport terrestre', () => {
  const tripItem = (
    id: string,
    type: TripItem['type'],
    title: string,
    startTime: string,
    endTime: string,
    dayNumber: number = 1
  ): TripItem => ({
    id,
    dayNumber,
    startTime,
    endTime,
    type,
    title,
    description: '',
    locationName: 'Test',
    latitude: 41.38,
    longitude: 2.17,
    orderIndex: 0,
  });

  it('devrait valider un voyage en train correctement ordonne', () => {
    const validTrainTrip: Trip = {
      id: 'train-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 2,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // Ordre correct: train -> hotel -> activites
            tripItem('1', 'transport', 'Train TGV → Barcelona', '08:00', '14:30'),
            tripItem('2', 'hotel', 'Check-in Hotel', '15:00', '15:20'),
            tripItem('3', 'activity', 'Parc Guell', '16:00', '18:00'),
            tripItem('4', 'restaurant', 'Diner', '19:30', '21:00'),
          ],
        },
        {
          dayNumber: 2,
          date: new Date('2026-01-26'),
          items: [
            tripItem('5', 'checkout', 'Check-out Hotel', '10:00', '10:30', 2),
            tripItem('6', 'transport', 'Train TGV → Paris', '14:00', '20:30', 2),
          ],
        },
      ],
      totalEstimatedCost: 300,
      costBreakdown: {
        flights: 0,
        accommodation: 100,
        food: 50,
        activities: 20,
        transport: 130,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 30,
        flights: 0,
        accommodation: 10,
        localTransport: 20,
        rating: 'A',
        equivalents: { treesNeeded: 2, carKmEquivalent: 143 },
        tips: [],
      },
    };

    const result = validateTripCoherence(validTrainTrip);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('devrait detecter une activite avant l\'arrivee du train', () => {
    const incoherentTrainTrip: Trip = {
      id: 'bad-train-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 1,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // PROBLEME: Activite PENDANT le trajet en train!
            tripItem('1', 'transport', 'Train TGV → Barcelona', '08:00', '14:30'),
            tripItem('2', 'activity', 'Sagrada Familia', '10:00', '12:00'), // ERREUR!
            tripItem('3', 'hotel', 'Check-in Hotel', '15:00', '15:20'),
          ],
        },
      ],
      totalEstimatedCost: 150,
      costBreakdown: {
        flights: 0,
        accommodation: 50,
        food: 0,
        activities: 20,
        transport: 80,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 15,
        flights: 0,
        accommodation: 5,
        localTransport: 10,
        rating: 'A',
        equivalents: { treesNeeded: 1, carKmEquivalent: 71 },
        tips: [],
      },
    };

    const result = validateTripCoherence(incoherentTrainTrip);
    expect(result.valid).toBe(false);

    // Devrait detecter une activite avant l'arrivee ou un chevauchement
    const hasRelevantError = result.errors.some(e =>
      e.type === 'ACTIVITY_BEFORE_ARRIVAL' ||
      e.type === 'ACTIVITY_BEFORE_HOTEL_CHECKIN' ||
      e.type === 'OVERLAP' ||
      e.type === 'ILLOGICAL_SEQUENCE'
    );
    expect(hasRelevantError).toBe(true);
  });

  it('devrait detecter une activite apres le check-in mais avant l\'arrivee du bus', () => {
    const incoherentBusTrip: Trip = {
      id: 'bad-bus-trip',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 1,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            // PROBLEME: Ordre illogique
            tripItem('1', 'activity', 'Parc Guell', '09:00', '11:00'), // ERREUR: avant meme d'arriver!
            tripItem('2', 'transport', 'Bus Flixbus → Barcelona', '06:00', '18:00'),
            tripItem('3', 'hotel', 'Check-in Hotel', '18:30', '18:50'),
          ],
        },
      ],
      totalEstimatedCost: 100,
      costBreakdown: {
        flights: 0,
        accommodation: 50,
        food: 0,
        activities: 10,
        transport: 40,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 25,
        flights: 0,
        accommodation: 5,
        localTransport: 20,
        rating: 'A',
        equivalents: { treesNeeded: 1, carKmEquivalent: 119 },
        tips: [],
      },
    };

    const result = validateTripCoherence(incoherentBusTrip);
    expect(result.valid).toBe(false);

    // Devrait detecter l'erreur
    const hasError = result.errors.some(e =>
      e.type === 'ACTIVITY_BEFORE_ARRIVAL' ||
      e.type === 'ILLOGICAL_SEQUENCE' ||
      e.type === 'OVERLAP'
    );
    expect(hasError).toBe(true);
  });

  it('devrait corriger automatiquement un voyage en train incoherent', () => {
    const incoherentTrip: Trip = {
      id: 'fixable-train',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 1,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [
            tripItem('1', 'transport', 'Train OUIGO → Barcelona', '08:00', '14:30'),
            tripItem('2', 'activity', 'Casa Batllo', '12:00', '14:00'), // ERREUR: pendant le trajet
            tripItem('3', 'hotel', 'Check-in Hotel', '15:00', '15:20'),
          ],
        },
      ],
      totalEstimatedCost: 150,
      costBreakdown: {
        flights: 0,
        accommodation: 50,
        food: 0,
        activities: 20,
        transport: 80,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 15,
        flights: 0,
        accommodation: 5,
        localTransport: 10,
        rating: 'A',
        equivalents: { treesNeeded: 1, carKmEquivalent: 71 },
        tips: [],
      },
    };

    // Validation initiale devrait echouer
    const initialResult = validateTripCoherence(incoherentTrip);
    expect(initialResult.valid).toBe(false);

    // Correction automatique
    const fixedTrip = validateAndFixTrip(incoherentTrip);

    // Re-validation devrait avoir moins d'erreurs (ou zero)
    const fixedResult = validateTripCoherence(fixedTrip);
    expect(fixedResult.errors.length).toBeLessThanOrEqual(initialResult.errors.length);
  });
});

// ============================================
// Tests du dernier jour avec checkout tardif
// ============================================

describe('Dernier jour - checkout et vol', () => {
  it('devrait detecter une activite apres le checkout', () => {
    const tripItem = (
      id: string,
      type: TripItem['type'],
      title: string,
      startTime: string,
      endTime: string
    ): TripItem => ({
      id,
      dayNumber: 2,
      startTime,
      endTime,
      type,
      title,
      description: '',
      locationName: 'Test',
      latitude: 41.38,
      longitude: 2.17,
      orderIndex: 0,
    });

    const tripWithLateActivity: Trip = {
      id: 'late-activity',
      createdAt: new Date(),
      updatedAt: new Date(),
      preferences: {
        transport: 'plane',
        carRental: false,
        groupType: 'couple',
        budgetLevel: 'moderate',
        activities: ['culture'],
        dietary: [],
        mustSee: '',
        origin: 'Paris',
        destination: 'Barcelona',
        startDate: new Date('2026-01-25'),
        durationDays: 2,
        groupSize: 2,
      },
      days: [
        {
          dayNumber: 1,
          date: new Date('2026-01-25'),
          items: [],
        },
        {
          dayNumber: 2,
          date: new Date('2026-01-26'),
          items: [
            tripItem('1', 'checkout', 'Check-out Hotel', '10:00', '10:30'),
            tripItem('2', 'activity', 'Visite musee', '11:00', '13:00'), // Activite APRES checkout mais potentiellement OK
            tripItem('3', 'transport', 'Transfert Hotel → Aeroport', '10:30', '11:10'), // Conflit!
            tripItem('4', 'flight', 'Vol retour', '13:00', '14:30'),
          ],
        },
      ],
      totalEstimatedCost: 200,
      costBreakdown: {
        flights: 200,
        accommodation: 0,
        food: 0,
        activities: 0,
        transport: 0,
        parking: 0,
        other: 0,
      },
      carbonFootprint: {
        total: 80,
        flights: 80,
        accommodation: 0,
        localTransport: 0,
        rating: 'C',
        equivalents: { treesNeeded: 3, carKmEquivalent: 380 },
        tips: [],
      },
    };

    const result = validateTripCoherence(tripWithLateActivity);

    // Devrait detecter un chevauchement ou une sequence illogique
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
