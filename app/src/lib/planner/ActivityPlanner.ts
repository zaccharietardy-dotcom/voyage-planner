/**
 * ActivityPlanner - Planifie les activités (attractions) dans une journée
 *
 * Responsabilités:
 * - Répartition matin/après-midi des attractions
 * - Vérification horaires d'ouverture, temps de trajet, doublons
 * - Remplissage des trous (gap filling) avant déjeuner et dîner
 * - Intégration avec MealScheduler pour la séquence repas/activités
 */

import {
  TripItem,
  TripItemType,
  TripPreferences,
} from '../types';
import { Attraction, estimateTravelTime } from '../services/attractions';
import { DayScheduler, parseTime, formatTime as formatScheduleTime } from '../services/scheduler';
import { generateGoogleMapsUrl, generateGoogleMapsSearchUrl } from '../services/directions';
import { createLocationTracker } from '../services/locationTracker';
import { PlannerContext, Coordinates, DayType } from './types';
import { MealScheduler, MealResult } from './MealScheduler';

// ============================================
// Helpers
// ============================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// ============================================
// Types
// ============================================

export interface ActivityPlannerConfig {
  scheduler: DayScheduler;
  context: PlannerContext;
  date: Date;
  dayNumber: number;
  dayType: DayType;
  attractions: Attraction[];
  allAttractions: Attraction[];
  tripUsedAttractionIds: Set<string>;
  endHour: number;
}

export interface ActivityResult {
  items: TripItem[];
  lastCoords: Coordinates;
  orderIndex: number;
}

// ============================================
// ActivityPlanner
// ============================================

export class ActivityPlanner {
  private config: ActivityPlannerConfig;
  private items: TripItem[] = [];
  private lastCoords: Coordinates;
  private orderIndex: number;
  private mealScheduler: MealScheduler;

  constructor(
    config: ActivityPlannerConfig,
    startCoords: Coordinates,
    startOrderIndex: number,
    mealScheduler: MealScheduler,
  ) {
    this.config = config;
    this.lastCoords = startCoords;
    this.orderIndex = startOrderIndex;
    this.mealScheduler = mealScheduler;
  }

  /**
   * Planifie toute la journée: petit-déj → matin → déjeuner → après-midi → dîner
   */
  async planDay(): Promise<ActivityResult> {
    const { dayType } = this.config;
    const isFirstDay = dayType === 'arrival' || dayType === 'single_day';
    const isLastDay = dayType === 'departure' || dayType === 'single_day';

    // 1. Petit-déjeuner
    const breakfast = await this.mealScheduler.scheduleBreakfast();
    if (breakfast) {
      this.items.push(breakfast.item);
      this.lastCoords = breakfast.coords;
      this.mealScheduler.updateLastCoords(this.lastCoords);
    }

    // 2. Activités du matin (pas le jour 1)
    if (!isFirstDay) {
      await this.scheduleMorningActivities();
      await this.fillGapsBeforeLunch();
    }

    // 3. Déjeuner
    this.mealScheduler.updateLastCoords(this.lastCoords);
    const lunch = await this.mealScheduler.scheduleLunch();
    if (lunch) {
      this.items.push(lunch.item);
      this.lastCoords = lunch.coords;
      this.mealScheduler.updateLastCoords(this.lastCoords);
    }

    // 4. Activités de l'après-midi
    await this.scheduleAfternoonActivities(isFirstDay);
    await this.fillGapsBeforeDinner();

    // 5. Dîner
    this.mealScheduler.updateLastCoords(this.lastCoords);
    const dinner = await this.mealScheduler.scheduleDinner();
    if (dinner) {
      this.items.push(dinner.item);
      this.lastCoords = dinner.coords;
    }

    this.orderIndex = this.mealScheduler.getOrderIndex();

    return {
      items: this.items,
      lastCoords: this.lastCoords,
      orderIndex: this.orderIndex,
    };
  }

  // ============================================
  // Morning Activities
  // ============================================

  private async scheduleMorningActivities(): Promise<void> {
    const { scheduler, attractions, date, dayNumber, tripUsedAttractionIds, context } = this.config;

    const cursorHour = scheduler.getCurrentTime().getHours();
    if (cursorHour >= 12) return;

    const morningCount = Math.floor(attractions.length / 2);
    const morningAttractions = attractions.slice(0, morningCount);

    for (const attraction of morningAttractions) {
      if (tripUsedAttractionIds.has(attraction.id)) continue;

      const lunchTime = parseTime(date, '12:30');
      const travelTime = estimateTravelTime(
        { latitude: this.lastCoords.lat, longitude: this.lastCoords.lng } as Attraction,
        attraction
      );

      // Check if we have time before lunch
      if (scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration) * 60 * 1000 > lunchTime.getTime()) {
        continue;
      }

      const added = this.tryAddAttraction(attraction, travelTime);
      if (added) {
        console.log(`[Jour ${dayNumber}] Attraction matin: ${attraction.name}`);
      }
    }
  }

  // ============================================
  // Afternoon Activities
  // ============================================

  private async scheduleAfternoonActivities(isFirstDay: boolean): Promise<void> {
    const { attractions, dayNumber, tripUsedAttractionIds, scheduler, date, endHour } = this.config;

    let afternoonAttractions: Attraction[];
    if (isFirstDay) {
      afternoonAttractions = attractions;
    } else {
      const morningCount = Math.floor(attractions.length / 2);
      afternoonAttractions = attractions.slice(morningCount);
    }

    for (const attraction of afternoonAttractions) {
      if (tripUsedAttractionIds.has(attraction.id)) continue;

      const travelTime = estimateTravelTime(
        { latitude: this.lastCoords.lat, longitude: this.lastCoords.lng } as Attraction,
        attraction
      );

      // Check time before dinner or end of day
      const dinnerTime = parseTime(date, '19:30');
      const dayEnd = parseTime(date, `${endHour}:00`);
      const maxTime = endHour >= 20 ? dinnerTime : dayEnd;

      if (scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration) * 60 * 1000 > maxTime.getTime()) {
        continue;
      }

      const added = this.tryAddAttraction(attraction, travelTime);
      if (added) {
        console.log(`[Jour ${dayNumber}] Attraction après-midi: ${attraction.name}`);
      }
    }
  }

  // ============================================
  // Gap Filling
  // ============================================

  private async fillGapsBeforeLunch(): Promise<void> {
    const { scheduler, date, dayNumber, allAttractions, tripUsedAttractionIds } = this.config;

    const currentTime = scheduler.getCurrentTime();
    const lunchTime = parseTime(date, '12:30');
    const timeBeforeLunchMin = (lunchTime.getTime() - currentTime.getTime()) / (60 * 1000);

    // Fill gaps >= 45 min (enough for a short attraction + travel)
    if (timeBeforeLunchMin <= 45) return;

    console.log(`[Jour ${dayNumber}] ${Math.round(timeBeforeLunchMin / 60)}h libre avant déjeuner - remplissage`);

    const unused = allAttractions.filter(a => !tripUsedAttractionIds.has(a.id));
    for (const attraction of unused) {
      const travelTime = estimateTravelTime(
        { latitude: this.lastCoords.lat, longitude: this.lastCoords.lng } as Attraction,
        attraction
      );
      const estimatedEnd = new Date(scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration + 15) * 60 * 1000);
      if (estimatedEnd > lunchTime) continue;

      if (this.checkOpeningHours(attraction, travelTime, lunchTime)) {
        const added = this.tryAddAttraction(attraction, travelTime);
        if (added) {
          console.log(`[Jour ${dayNumber}] Attraction supplémentaire (matin): ${attraction.name}`);
        }
      }
    }
  }

  private async fillGapsBeforeDinner(): Promise<void> {
    const { scheduler, date, dayNumber, allAttractions, tripUsedAttractionIds } = this.config;

    const currentTime = scheduler.getCurrentTime();
    const dinnerTime = parseTime(date, '19:00');
    const timeBeforeDinnerMin = (dinnerTime.getTime() - currentTime.getTime()) / (60 * 1000);

    // Fill gaps >= 45 min (enough for a short attraction + travel)
    if (timeBeforeDinnerMin <= 45) return;

    console.log(`[Jour ${dayNumber}] ${Math.round(timeBeforeDinnerMin / 60)}h libre avant dîner - remplissage`);

    const unused = allAttractions.filter(a => !tripUsedAttractionIds.has(a.id));
    for (const attraction of unused) {
      const travelTime = estimateTravelTime(
        { latitude: this.lastCoords.lat, longitude: this.lastCoords.lng } as Attraction,
        attraction
      );
      const estimatedEnd = new Date(scheduler.getCurrentTime().getTime() + (travelTime + attraction.duration + 15) * 60 * 1000);
      if (estimatedEnd > dinnerTime) continue;

      if (this.checkOpeningHours(attraction, travelTime, null)) {
        const added = this.tryAddAttraction(attraction, travelTime);
        if (added) {
          console.log(`[Jour ${dayNumber}] Attraction supplémentaire (après-midi): ${attraction.name}`);
        }
      }
    }
  }

  // ============================================
  // Shared Logic
  // ============================================

  /**
   * Vérifie les horaires d'ouverture d'une attraction
   */
  private checkOpeningHours(
    attraction: Attraction,
    travelTime: number,
    deadline: Date | null,
  ): boolean {
    const { scheduler, date } = this.config;

    const openTime = parseTime(date, attraction.openingHours.open);
    const closeTime = parseTime(date, attraction.openingHours.close);
    const safeCloseTime = new Date(closeTime.getTime() - 30 * 60 * 1000);

    let actualStart = new Date(scheduler.getCurrentTime().getTime() + travelTime * 60 * 1000);
    if (actualStart < openTime) actualStart = openTime;

    const potentialEnd = new Date(actualStart.getTime() + attraction.duration * 60 * 1000);
    if (potentialEnd > safeCloseTime) return false;
    if (deadline && potentialEnd > deadline) return false;

    return true;
  }

  /**
   * Tente d'ajouter une attraction au scheduler et aux items
   */
  private tryAddAttraction(attraction: Attraction, travelTime: number): boolean {
    const { scheduler, date, dayNumber, tripUsedAttractionIds, context } = this.config;

    // Budget check: skip if activity costs more than remaining budget
    const cost = (attraction.estimatedCost || 0) * (context.preferences.groupSize || 1);
    if (cost > 0 && context.budgetTracker && !context.budgetTracker.canAfford('activities', cost)) {
      return false;
    }

    const openTime = parseTime(date, attraction.openingHours.open);

    const activityItem = scheduler.addItem({
      id: generateId(),
      title: attraction.name,
      type: 'activity',
      duration: attraction.duration,
      travelTime,
      minStartTime: openTime,
      data: { attraction },
    });

    if (!activityItem) return false;

    // Track spending
    if (cost > 0 && context.budgetTracker) {
      context.budgetTracker.spend('activities', cost);
    }

    tripUsedAttractionIds.add(attraction.id);

    const attractionCoords = {
      lat: attraction.latitude || context.cityCenter.lat + (Math.random() - 0.5) * 0.02,
      lng: attraction.longitude || context.cityCenter.lng + (Math.random() - 0.5) * 0.02,
    };

    const googleMapsUrl = generateGoogleMapsUrl(this.lastCoords, attractionCoords, 'transit');

    // Google Maps search URL (plus fiable que les coordonnées)
    const locationParts = context.preferences.destination.split(',');
    const city = locationParts[0].trim();
    const googleMapsPlaceUrl = generateGoogleMapsSearchUrl(attraction.name, city);

    const item: TripItem = {
      id: activityItem.id,
      type: 'activity' as TripItemType,
      title: attraction.name,
      description: attraction.description,
      startTime: formatScheduleTime(activityItem.slot.start),
      endTime: formatScheduleTime(activityItem.slot.end),
      duration: activityItem.duration,
      locationName: `${attraction.name}, ${context.preferences.destination}`,
      latitude: attractionCoords.lat,
      longitude: attractionCoords.lng,
      estimatedCost: attraction.estimatedCost * (context.preferences.groupSize || 1),
      rating: attraction.rating,
      bookingUrl: attraction.bookingUrl,
      timeFromPrevious: travelTime,
      googleMapsUrl,
      googleMapsPlaceUrl,
      dataReliability: attraction.dataReliability || 'verified',
      imageUrl: attraction.imageUrl,
      dayNumber,
      orderIndex: this.orderIndex++,
    };

    this.items.push(item);
    this.lastCoords = attractionCoords;
    this.mealScheduler.updateLastCoords(this.lastCoords);

    return true;
  }
}
