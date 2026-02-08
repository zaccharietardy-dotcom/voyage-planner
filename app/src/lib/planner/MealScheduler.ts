/**
 * MealScheduler - Gère la planification des repas
 *
 * Responsabilités:
 * - Petit-déjeuner: 7h-10h (hôtel ou restaurant externe)
 * - Déjeuner: 12h30 fixe (pause obligatoire)
 * - Dîner: 19h minimum, 90min
 * - Respecte hotelHasBreakfast, budget, groupSize
 */

import {
  TripItem,
  TripItemType,
  Accommodation,
  TripPreferences,
  BudgetLevel,
  BudgetStrategy,
  Restaurant,
} from '../types';
import { DayScheduler, parseTime } from '../services/scheduler';
import { estimateMealPrice } from '../services/restaurants';
import { generateGoogleMapsUrl } from '../services/directions';
import { PlannerContext, Coordinates } from './types';
import { BudgetTracker } from '../services/budgetTracker';

/** Function type for finding restaurants - injected from ai.ts */
export type RestaurantFinder = (
  mealType: 'breakfast' | 'lunch' | 'dinner',
  cityCenter: { lat: number; lng: number },
  preferences: TripPreferences,
  dayNumber: number,
  lastCoords?: { lat: number; lng: number },
) => Promise<Restaurant | null>;

// ============================================
// Helpers
// ============================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function getBudgetPriceLevel(budgetLevel?: BudgetLevel): 1 | 2 | 3 | 4 {
  switch (budgetLevel) {
    case 'economic': return 1;
    case 'moderate': return 2;
    case 'comfort': return 3;
    case 'luxury': return 4;
    default: return 2;
  }
}

function getReliableGoogleMapsPlaceUrl(
  restaurant: { name: string; address?: string; googleMapsUrl?: string } | null,
  destination: string,
): string | undefined {
  if (!restaurant) return undefined;
  if (restaurant.googleMapsUrl) return restaurant.googleMapsUrl;
  const hasRealAddress = restaurant.address && !restaurant.address.includes('non disponible');
  const searchQuery = hasRealAddress
    ? `${restaurant.name}, ${restaurant.address}`
    : `${restaurant.name}, ${destination}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
}

function getHotelLocationName(accommodation: Accommodation | null, destination: string): string {
  if (accommodation?.name) {
    return `${accommodation.name}, ${destination}`;
  }
  return `Hébergement, ${destination}`;
}

// ============================================
// Types
// ============================================

export interface MealResult {
  item: TripItem;
  coords: Coordinates;
}

export interface MealSchedulerConfig {
  scheduler: DayScheduler;
  context: PlannerContext;
  date: Date;
  dayNumber: number;
  lastCoords: Coordinates;
  isFirstDay: boolean;
  isLastDay: boolean;
  endHour: number;
  findRestaurant: RestaurantFinder;
  budgetStrategy?: BudgetStrategy;
  budgetTracker?: BudgetTracker;
  /** Activités planifiées ce jour (pour détecter activités longues → picnic) */
  plannedActivities?: Array<{ name: string; startTime: Date; endTime: Date; duration: number }>;
  /** true si les courses ont déjà été faites (on peut cuisiner) */
  groceriesDone?: boolean;
}

// ============================================
// MealScheduler
// ============================================

export class MealScheduler {
  private config: MealSchedulerConfig;
  private orderIndex: number;

  constructor(config: MealSchedulerConfig, startOrderIndex: number) {
    this.config = config;
    this.orderIndex = startOrderIndex;
  }

  getOrderIndex(): number {
    return this.orderIndex;
  }

  /**
   * Détermine si un repas doit être self-catered (mixed logic intelligente)
   */
  private shouldSelfCater(mealType: 'breakfast' | 'lunch' | 'dinner'): boolean {
    const { budgetStrategy, dayNumber, context } = this.config;
    if (!budgetStrategy) return false;
    if (budgetStrategy.accommodationType !== 'airbnb_with_kitchen') return false;

    // On ne peut pas cuisiner si les courses n'ont pas encore été faites
    if (this.config.groceriesDone === false) return false;

    const strategy = budgetStrategy.mealsStrategy[mealType];
    if (strategy === 'self_catered') return true;
    if (strategy === 'restaurant') return false;

    // Logique mixed
    if (strategy === 'mixed') {
      const totalDays = context.preferences.durationDays || 999;
      const lastFullDay = totalDays - 1;
      if (dayNumber === 1) return false; // Jour 1: restaurant
      if (dayNumber === lastFullDay && mealType === 'dinner') return false; // Dernier soir: restaurant
      return dayNumber % 2 === 1; // Alternance
    }
    return false;
  }

  /**
   * Petit-déjeuner: avant 10h, pas le jour 1
   * Supporte: hôtel inclus, self-catering (appartement), restaurant
   */
  async scheduleBreakfast(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isFirstDay, budgetStrategy, budgetTracker } = this.config;
    let { lastCoords } = this.config;

    const currentHour = scheduler.getCurrentTime().getHours();
    if (currentHour >= 10 || isFirstDay) return null;

    const hotelHasBreakfast = context.accommodation?.breakfastIncluded === true;
    const isSelfCatered = !hotelHasBreakfast && this.shouldSelfCater('breakfast');

    const breakfastItem = scheduler.addItem({
      id: generateId(),
      title: hotelHasBreakfast ? `Petit-déjeuner à l'hôtel` : isSelfCatered ? 'Petit-déjeuner à l\'appartement' : 'Petit-déjeuner',
      type: hotelHasBreakfast ? 'hotel' : 'restaurant',
      duration: hotelHasBreakfast ? 30 : isSelfCatered ? 20 : 45,
      travelTime: (hotelHasBreakfast || isSelfCatered) ? 0 : 10,
    });

    if (!breakfastItem) return null;

    const { preferences } = context;

    // Hôtel avec breakfast inclus
    if (hotelHasBreakfast) {
      const coords = {
        lat: context.accommodation?.latitude || context.cityCenter.lat,
        lng: context.accommodation?.longitude || context.cityCenter.lng,
      };
      const item: TripItem = {
        id: breakfastItem.id,
        type: 'hotel' as TripItemType,
        title: `Petit-déjeuner à l'hôtel`,
        description: `Inclus dans le prix de l'hôtel | ${context.accommodation?.name}`,
        startTime: breakfastItem.slot.start.toISOString(),
        endTime: breakfastItem.slot.end.toISOString(),
        duration: breakfastItem.duration,
        locationName: getHotelLocationName(context.accommodation, preferences.destination),
        latitude: coords.lat,
        longitude: coords.lng,
        estimatedCost: 0,
        dayNumber,
        orderIndex: this.orderIndex++,
      };
      return { item, coords };
    }

    // Self-catered (appartement avec cuisine)
    if (isSelfCatered) {
      const coords = {
        lat: context.accommodation?.latitude || context.cityCenter.lat,
        lng: context.accommodation?.longitude || context.cityCenter.lng,
      };
      const costPerPerson = 4;
      const totalCost = costPerPerson * (preferences.groupSize || 1);
      if (budgetTracker) budgetTracker.spend('food', totalCost);

      const item: TripItem = {
        id: breakfastItem.id,
        type: 'restaurant' as TripItemType,
        title: `Petit-déjeuner à l'appartement`,
        description: `Préparé avec les courses | ~${costPerPerson}€/pers`,
        startTime: breakfastItem.slot.start.toISOString(),
        endTime: breakfastItem.slot.end.toISOString(),
        duration: breakfastItem.duration,
        locationName: getHotelLocationName(context.accommodation, preferences.destination),
        latitude: coords.lat,
        longitude: coords.lng,
        estimatedCost: totalCost,
        dayNumber,
        orderIndex: this.orderIndex++,
      };
      return { item, coords };
    }

    // Restaurant externe
    const restaurant = await this.config.findRestaurant('breakfast', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

    const cost = estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'breakfast') * (preferences.groupSize || 1);
    if (budgetTracker) budgetTracker.spend('food', cost);

    const item: TripItem = {
      id: breakfastItem.id,
      type: 'restaurant' as TripItemType,
      title: restaurant?.name || 'Petit-déjeuner',
      description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Petit-déjeuner local',
      startTime: breakfastItem.slot.start.toISOString(),
      endTime: breakfastItem.slot.end.toISOString(),
      duration: breakfastItem.duration,
      locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
      latitude: coords.lat,
      longitude: coords.lng,
      estimatedCost: cost,
      rating: restaurant?.rating,
      googleMapsUrl,
      googleMapsPlaceUrl: restaurantGoogleMapsUrl,
      dayNumber,
      orderIndex: this.orderIndex++,
    };
    return { item, coords };
  }

  /**
   * Déjeuner: forcé à 12h30, 1h15
   * Supporte: restaurant, self-catered, picnic (activité longue en cours)
   */
  async scheduleLunch(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isFirstDay, endHour, budgetStrategy, budgetTracker, plannedActivities } = this.config;
    let { lastCoords } = this.config;

    const shouldHaveLunch = !isFirstDay && endHour >= 14;
    if (!shouldHaveLunch) return null;

    // Détecter si une activité longue (>3h) couvre la fenêtre déjeuner → picnic
    const lunchWindowStart = parseTime(date, '12:00');
    const lunchWindowEnd = parseTime(date, '14:00');
    const longActivityAtLunch = plannedActivities?.find(a => {
      return a.startTime < lunchWindowEnd && a.endTime > lunchWindowStart && a.duration > 180;
    });

    // Si activité Viator (bookée) en cours → pas de repas (souvent inclus/pause prévue)
    const isBookedTour = longActivityAtLunch?.name?.toLowerCase().includes('tour') ||
      longActivityAtLunch?.name?.toLowerCase().includes('excursion') ||
      longActivityAtLunch?.name?.toLowerCase().includes('visite guidée');

    if (longActivityAtLunch && isBookedTour) {
      // Tour guidé : pause incluse, on skip le déjeuner formel
      return null;
    }

    const isSelfCatered = this.shouldSelfCater('lunch');
    const isPicnic = !!longActivityAtLunch || isSelfCatered;
    const picnicDuration = isPicnic ? 30 : 75;

    // Essayer plusieurs créneaux dans la fenêtre déjeuner (12:00-14:00)
    const lunchSlots = ['12:30', '12:00', '13:00', '13:30'];
    let lunchItem = null;

    for (const slot of lunchSlots) {
      const targetTime = parseTime(date, slot);
      const endTime = new Date(targetTime.getTime() + picnicDuration * 60 * 1000);
      lunchItem = scheduler.insertFixedItem({
        id: generateId(),
        title: isPicnic ? 'Pique-nique' : 'Déjeuner',
        type: 'restaurant',
        startTime: targetTime,
        endTime,
      });
      if (lunchItem) break;
    }

    // Si tous les créneaux fixes échouent, essayer juste après l'activité bloquante
    if (!lunchItem && plannedActivities) {
      const blockingActivity = plannedActivities.find(a => {
        return a.startTime < lunchWindowEnd && a.endTime > lunchWindowStart;
      });
      if (blockingActivity) {
        const afterActivity = new Date(blockingActivity.endTime.getTime() + 5 * 60 * 1000);
        const afterEnd = new Date(afterActivity.getTime() + picnicDuration * 60 * 1000);
        // Seulement si c'est encore une heure raisonnable pour déjeuner (avant 14:30)
        if (afterActivity.getHours() < 14 || (afterActivity.getHours() === 14 && afterActivity.getMinutes() <= 30)) {
          lunchItem = scheduler.insertFixedItem({
            id: generateId(),
            title: isPicnic ? 'Pique-nique' : 'Déjeuner',
            type: 'restaurant',
            startTime: afterActivity,
            endTime: afterEnd,
          });
        }
      }
    }

    if (!lunchItem) return null;

    const { preferences } = context;

    // Avancer le curseur après le déjeuner
    scheduler.advanceTo(lunchItem.slot.end);

    // Picnic
    if (isPicnic) {
      const costPerPerson = 8;
      const totalCost = costPerPerson * (preferences.groupSize || 1);
      if (budgetTracker) budgetTracker.spend('food', totalCost);

      const description = longActivityAtLunch
        ? `Pique-nique pendant ${longActivityAtLunch.name} | ~${costPerPerson}€/pers`
        : `Sandwichs préparés à l'appartement | ~${costPerPerson}€/pers`;

      const item: TripItem = {
        id: lunchItem.id,
        type: 'restaurant' as TripItemType,
        title: 'Pique-nique',
        description,
        startTime: lunchItem.slot.start.toISOString(),
        endTime: lunchItem.slot.end.toISOString(),
        duration: lunchItem.duration,
        locationName: longActivityAtLunch ? longActivityAtLunch.name : `${preferences.destination}`,
        latitude: lastCoords.lat,
        longitude: lastCoords.lng,
        estimatedCost: totalCost,
        dayNumber,
        orderIndex: this.orderIndex++,
      };
      return { item, coords: lastCoords };
    }

    // Restaurant classique
    const restaurant = await this.config.findRestaurant('lunch', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

    const cost = estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * (preferences.groupSize || 1);
    if (budgetTracker) budgetTracker.spend('food', cost);

    const item: TripItem = {
      id: lunchItem.id,
      type: 'restaurant' as TripItemType,
      title: restaurant?.name || 'Déjeuner',
      description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Déjeuner local',
      startTime: lunchItem.slot.start.toISOString(),
      endTime: lunchItem.slot.end.toISOString(),
      duration: lunchItem.duration,
      locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
      latitude: coords.lat,
      longitude: coords.lng,
      estimatedCost: cost,
      rating: restaurant?.rating,
      googleMapsUrl,
      googleMapsPlaceUrl: restaurantGoogleMapsUrl,
      dayNumber,
      orderIndex: this.orderIndex++,
    };
    return { item, coords };
  }

  /**
   * Dîner: 19h minimum, 90min, pas le dernier jour
   * Supporte: self-catered (appartement) ou restaurant
   */
  async scheduleDinner(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isLastDay, endHour, budgetStrategy, budgetTracker } = this.config;
    let { lastCoords } = this.config;

    const daySupportsDinner = endHour >= 20;
    const canHaveDinner = scheduler.canFit(90, 15);
    if (isLastDay || !daySupportsDinner || !canHaveDinner) return null;

    const isSelfCatered = this.shouldSelfCater('dinner');

    const dinnerMinTime = parseTime(date, '19:00');
    const dinnerItem = scheduler.addItem({
      id: generateId(),
      title: isSelfCatered ? 'Dîner à l\'appartement' : 'Dîner',
      type: 'restaurant',
      duration: isSelfCatered ? 60 : 90,
      travelTime: isSelfCatered ? 10 : 15,
      minStartTime: dinnerMinTime,
    });

    if (!dinnerItem) return null;

    const { preferences } = context;

    // Self-catered dinner
    if (isSelfCatered) {
      const costPerPerson = 10;
      const totalCost = costPerPerson * (preferences.groupSize || 1);
      if (budgetTracker) budgetTracker.spend('food', totalCost);

      const coords = {
        lat: context.accommodation?.latitude || context.cityCenter.lat,
        lng: context.accommodation?.longitude || context.cityCenter.lng,
      };

      const item: TripItem = {
        id: dinnerItem.id,
        type: 'restaurant' as TripItemType,
        title: `Dîner à l'appartement`,
        description: `Cuisine maison avec les courses | ~${costPerPerson}€/pers`,
        startTime: dinnerItem.slot.start.toISOString(),
        endTime: dinnerItem.slot.end.toISOString(),
        duration: dinnerItem.duration,
        locationName: getHotelLocationName(context.accommodation, preferences.destination),
        latitude: coords.lat,
        longitude: coords.lng,
        estimatedCost: totalCost,
        dayNumber,
        orderIndex: this.orderIndex++,
      };
      return { item, coords };
    }

    // Restaurant
    const restaurant = await this.config.findRestaurant('dinner', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = getReliableGoogleMapsPlaceUrl(restaurant, preferences.destination);

    const cost = estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'dinner') * (preferences.groupSize || 1);
    if (budgetTracker) budgetTracker.spend('food', cost);

    const item: TripItem = {
      id: dinnerItem.id,
      type: 'restaurant' as TripItemType,
      title: restaurant?.name || 'Dîner',
      description: restaurant ? `${restaurant.cuisineTypes.join(', ')} | ⭐ ${restaurant.rating?.toFixed(1)}/5` : 'Dîner local',
      startTime: dinnerItem.slot.start.toISOString(),
      endTime: dinnerItem.slot.end.toISOString(),
      duration: dinnerItem.duration,
      locationName: restaurant ? `${restaurant.name}, ${preferences.destination}` : `Centre-ville, ${preferences.destination}`,
      latitude: coords.lat,
      longitude: coords.lng,
      estimatedCost: cost,
      rating: restaurant?.rating,
      googleMapsUrl,
      googleMapsPlaceUrl: restaurantGoogleMapsUrl,
      dayNumber,
      orderIndex: this.orderIndex++,
    };
    return { item, coords };
  }

  /**
   * Met à jour les coordonnées de la dernière position
   */
  updateLastCoords(coords: Coordinates): void {
    this.config.lastCoords = coords;
  }
}
