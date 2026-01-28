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
  Restaurant,
} from '../types';
import { DayScheduler, parseTime } from '../services/scheduler';
import { estimateMealPrice } from '../services/restaurants';
import { generateGoogleMapsUrl } from '../services/directions';
import { PlannerContext, Coordinates } from './types';

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
   * Petit-déjeuner: avant 10h, pas le jour 1
   */
  async scheduleBreakfast(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isFirstDay } = this.config;
    let { lastCoords } = this.config;

    const currentHour = scheduler.getCurrentTime().getHours();
    if (currentHour >= 10 || isFirstDay) return null;

    const hotelHasBreakfast = context.accommodation?.breakfastIncluded === true;

    const breakfastItem = scheduler.addItem({
      id: generateId(),
      title: hotelHasBreakfast ? `Petit-déjeuner à l'hôtel` : 'Petit-déjeuner',
      type: hotelHasBreakfast ? 'hotel' : 'restaurant',
      duration: hotelHasBreakfast ? 30 : 45,
      travelTime: hotelHasBreakfast ? 0 : 10,
    });

    if (!breakfastItem) return null;

    const { preferences } = context;

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

    // Restaurant externe
    const restaurant = await this.config.findRestaurant('breakfast', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
      (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

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
      estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'breakfast') * (preferences.groupSize || 1),
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
   */
  async scheduleLunch(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isFirstDay, endHour } = this.config;
    let { lastCoords } = this.config;

    const shouldHaveLunch = !isFirstDay && endHour >= 14;
    if (!shouldHaveLunch) return null;

    const lunchTargetTime = parseTime(date, '12:30');
    const lunchEndTime = new Date(lunchTargetTime.getTime() + 75 * 60 * 1000);

    const lunchItem = scheduler.insertFixedItem({
      id: generateId(),
      title: 'Déjeuner',
      type: 'restaurant',
      startTime: lunchTargetTime,
      endTime: lunchEndTime,
    });

    if (!lunchItem) return null;

    const { preferences } = context;
    const restaurant = await this.config.findRestaurant('lunch', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
      (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

    // Avancer le curseur après le déjeuner
    scheduler.advanceTo(lunchEndTime);

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
      estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'lunch') * (preferences.groupSize || 1),
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
   */
  async scheduleDinner(): Promise<MealResult | null> {
    const { scheduler, context, date, dayNumber, isLastDay, endHour } = this.config;
    let { lastCoords } = this.config;

    const daySupportsDinner = endHour >= 20;
    const canHaveDinner = scheduler.canFit(90, 15);
    if (isLastDay || !daySupportsDinner || !canHaveDinner) return null;

    const dinnerMinTime = parseTime(date, '19:00');
    const dinnerItem = scheduler.addItem({
      id: generateId(),
      title: 'Dîner',
      type: 'restaurant',
      duration: 90,
      travelTime: 15,
      minStartTime: dinnerMinTime,
    });

    if (!dinnerItem) return null;

    const { preferences } = context;
    const restaurant = await this.config.findRestaurant('dinner', context.cityCenter, preferences, dayNumber, lastCoords);
    const coords = {
      lat: restaurant?.latitude || context.cityCenter.lat,
      lng: restaurant?.longitude || context.cityCenter.lng,
    };
    const googleMapsUrl = generateGoogleMapsUrl(lastCoords, coords, 'walking');
    const restaurantGoogleMapsUrl = restaurant?.googleMapsUrl ||
      (restaurant ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name}, ${restaurant.address}`)}` : undefined);

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
      estimatedCost: estimateMealPrice(restaurant?.priceLevel || getBudgetPriceLevel(preferences.budgetLevel), 'dinner') * (preferences.groupSize || 1),
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
