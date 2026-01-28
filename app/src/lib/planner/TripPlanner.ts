/**
 * TripPlanner - Orchestrateur principal de la planification
 *
 * Remplace la logique de `generateDayWithScheduler` dans ai.ts
 * en déléguant aux modules spécialisés:
 * - LogisticsHandler: transport, vol, hôtel
 * - MealScheduler: petit-déj, déjeuner, dîner
 * - ActivityPlanner: attractions, gap filling
 * - ClaudeAdvisor: décisions ambiguës
 */

import {
  TripItem,
  TripPreferences,
  Flight,
  ParkingOption,
  Accommodation,
} from '../types';
import { Attraction } from '../services/attractions';
import { AirportInfo } from '../services/geocoding';
import { TransportOption } from '../services/transport';
import { DayScheduler, parseTime } from '../services/scheduler';
import { createLocationTracker } from '../services/locationTracker';
import {
  PlannerContext,
  DayType,
  Coordinates,
  LateFlightData,
  DayResult,
  DayParams,
} from './types';
import { LogisticsHandler } from './LogisticsHandler';
import { MealScheduler, RestaurantFinder } from './MealScheduler';
import { ActivityPlanner } from './ActivityPlanner';
import { ClaudeAdvisor } from './ClaudeAdvisor';

// ============================================
// Types
// ============================================

export interface TripPlannerConfig {
  preferences: TripPreferences;
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  groundTransport: TransportOption | null;
  originAirport: AirportInfo;
  destAirport: AirportInfo;
  accommodation: Accommodation | null;
  parking: ParkingOption | null;
  cityCenter: Coordinates;
  originCoords: Coordinates;
  allAttractions: Attraction[];
  findRestaurant: RestaurantFinder;
  locationTracker: ReturnType<typeof createLocationTracker>;
}

// ============================================
// TripPlanner
// ============================================

export class TripPlanner {
  private config: TripPlannerConfig;
  private context: PlannerContext;
  private advisor: ClaudeAdvisor;
  private logistics: LogisticsHandler;

  constructor(config: TripPlannerConfig) {
    this.config = config;
    this.context = this.buildContext();
    this.advisor = new ClaudeAdvisor(5);
    this.logistics = new LogisticsHandler(this.context);
  }

  private buildContext(): PlannerContext {
    const { preferences } = this.config;
    const hasNightlife = preferences.activities?.includes('nightlife') ?? false;

    return {
      preferences,
      outboundFlight: this.config.outboundFlight,
      returnFlight: this.config.returnFlight,
      groundTransport: this.config.groundTransport,
      originAirport: this.config.originAirport,
      destAirport: this.config.destAirport,
      accommodation: this.config.accommodation,
      parking: this.config.parking,
      cityCenter: this.config.cityCenter,
      originCoords: this.config.originCoords,
      allAttractions: this.config.allAttractions,
      hasNightlife,
      dayEndHour: hasNightlife ? '23:59' : '23:00',
    };
  }

  /**
   * Classifie le type de journée
   */
  classifyDay(dayNumber: number, totalDays: number, lateFlightFromPreviousDay?: LateFlightData): DayType {
    if (totalDays === 1) return 'single_day';

    // Jour avec vol overnight du jour précédent à traiter
    if (lateFlightFromPreviousDay && dayNumber > 1) {
      // Ce jour commence par l'arrivée du vol overnight
      return 'arrival';
    }

    if (dayNumber === 1) return 'arrival';
    if (dayNumber === totalDays) return 'departure';
    return 'full_day';
  }

  /**
   * Génère un jour complet en orchestrant les modules
   */
  async generateDay(params: DayParams): Promise<DayResult> {
    const { dayNumber, date, dayType, attractions, tripUsedAttractionIds, lateFlightFromPreviousDay } = params;

    const isFirstDay = dayType === 'arrival' || dayType === 'single_day';
    const isLastDay = dayType === 'departure' || dayType === 'single_day';
    const hasNightlife = this.context.hasNightlife;
    const endHourStr = hasNightlife ? '23:59' : '23:00';
    const endHour = parseInt(endHourStr.split(':')[0]);

    // Créer le scheduler pour la journée
    const dayStart = parseTime(date, '08:00');
    const dayEnd = parseTime(date, endHourStr);
    const scheduler = new DayScheduler(date, dayStart, dayEnd);

    const items: TripItem[] = [];
    let lastCoords: Coordinates = this.context.cityCenter;
    let orderIndex = 0;
    let lateFlightForNextDay: LateFlightData | undefined;

    // ============================================
    // 1. LOGISTIQUE (vol, transfert, hôtel)
    // ============================================

    if (isFirstDay) {
      const logisticsResult = await this.logistics.handleDeparture(scheduler, date, dayNumber);
      items.push(...logisticsResult.items);
      orderIndex = items.length;

      if (logisticsResult.lateFlightForNextDay) {
        lateFlightForNextDay = logisticsResult.lateFlightForNextDay;
      }

      // Ajuster le scheduler après la logistique
      if (logisticsResult.activitiesStartTime > scheduler.getCurrentTime()) {
        scheduler.advanceTo(logisticsResult.activitiesStartTime);
      }

      // Si pas arrivé à destination, pas d'activités
      if (!logisticsResult.arrivedAtDestination) {
        return { items, lateFlightForNextDay };
      }
    }

    // Vol overnight du jour précédent
    if (lateFlightFromPreviousDay) {
      const overnightResult = await this.logistics.handleOvernightArrival(
        scheduler, date, dayNumber, lateFlightFromPreviousDay
      );
      items.push(...overnightResult.items);
      orderIndex = items.length;

      if (overnightResult.activitiesStartTime > scheduler.getCurrentTime()) {
        scheduler.advanceTo(overnightResult.activitiesStartTime);
      }
    }

    // ============================================
    // 2. ACTIVITÉS + REPAS
    // ============================================

    const mealScheduler = new MealScheduler(
      {
        scheduler,
        context: this.context,
        date,
        dayNumber,
        lastCoords,
        isFirstDay,
        isLastDay,
        endHour,
        findRestaurant: this.config.findRestaurant,
      },
      orderIndex,
    );

    const activityPlanner = new ActivityPlanner(
      {
        scheduler,
        context: this.context,
        date,
        dayNumber,
        dayType,
        attractions,
        allAttractions: this.context.allAttractions,
        tripUsedAttractionIds,
        endHour,
      },
      lastCoords,
      orderIndex,
      mealScheduler,
    );

    const activityResult = await activityPlanner.planDay();
    items.push(...activityResult.items);
    lastCoords = activityResult.lastCoords;
    orderIndex = activityResult.orderIndex;

    // ============================================
    // 3. LOGISTIQUE RETOUR (dernier jour)
    // ============================================

    if (isLastDay) {
      const returnResult = await this.logistics.handleReturn(scheduler, date, dayNumber);
      items.push(...returnResult.items);
    }

    // Trier les items par startTime
    items.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : 0;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : 0;
      return timeA - timeB;
    });

    // Réindexer les orderIndex
    items.forEach((item, i) => {
      item.orderIndex = i;
    });

    return { items, lateFlightForNextDay };
  }

  /** Nombre d'appels Claude effectués */
  getAdvisorCallCount(): number {
    return this.advisor.getCallCount();
  }
}
