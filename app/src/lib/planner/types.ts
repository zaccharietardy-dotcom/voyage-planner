/**
 * Types pour le nouveau système de planification
 *
 * Architecture: State Machine + Claude Advisor
 * Le TravelerState représente l'état du voyageur à chaque instant.
 * Le PlannerContext contient les données immuables du voyage.
 */

import {
  TripPreferences,
  TripItem,
  TripItemType,
  Flight,
  ParkingOption,
  Accommodation,
  BudgetLevel,
  BudgetStrategy,
  TransportOptionSummary,
} from '../types';
import { Attraction } from '../services/attractions';
import { AirportInfo } from '../services/geocoding';
import { TransportOption } from '../services/transport';
import { BudgetTracker } from '../services/budgetTracker';

// ============================================
// Day Classification
// ============================================

/** Type de journée (détermine quels modules s'activent) */
export type DayType =
  | 'arrival'       // Jour 1 avec vol/transport aller
  | 'full_day'      // Journée complète à destination
  | 'departure'     // Dernier jour avec vol/transport retour
  | 'transit_only'  // Vol overnight: uniquement logistique départ
  | 'single_day';   // Voyage d'un seul jour (aller + retour)

// ============================================
// Traveler State (mutable, évolue dans la journée)
// ============================================

export interface MealStatus {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface TravelerState {
  // Position
  currentCity: string | null; // null si en transit
  currentCoords: Coordinates;
  isAtDestination: boolean;

  // Temps
  currentTime: Date;
  availableUntil: Date; // Heure limite (vol, checkout, fin de journée)

  // Logistique
  hotelCheckedIn: boolean;
  luggageStatus: 'with_bags' | 'at_hotel' | 'in_storage';

  // Repas
  meals: MealStatus;

  // Énergie (influence les décisions)
  energyLevel: 'fresh' | 'moderate' | 'tired' | 'exhausted';

  // Suivi
  activitiesCompleted: string[]; // IDs
  dayNumber: number;
  dayType: DayType;
}

// ============================================
// Planner Context (immuable pour tout le voyage)
// ============================================

export interface PlannerContext {
  // Préférences utilisateur
  preferences: TripPreferences;

  // Transport
  outboundFlight: Flight | null;
  returnFlight: Flight | null;
  groundTransport: TransportOption | null;

  // Aéroports
  originAirport: AirportInfo;
  destAirport: AirportInfo;

  // Hébergement
  accommodation: Accommodation | null;
  parking: ParkingOption | null;

  // Géographie
  cityCenter: Coordinates;
  originCoords: Coordinates;

  // Activités disponibles (toutes)
  allAttractions: Attraction[];

  // Budget
  budgetTracker?: BudgetTracker;
  budgetStrategy?: BudgetStrategy;

  // Préférences dérivées
  hasNightlife: boolean;
  dayEndHour: string; // "23:00" ou "23:59" si nightlife
}

// ============================================
// Late Flight Data (vol overnight reporté au jour suivant)
// ============================================

export interface LateFlightData {
  flight: Flight;
  destAirport: AirportInfo;
  accommodation: Accommodation | null;
}

// ============================================
// Day Generation Result
// ============================================

export interface DayResult {
  items: TripItem[];
  lateFlightForNextDay?: LateFlightData;
}

// ============================================
// Day Generation Parameters
// ============================================

export interface DayParams {
  dayNumber: number;
  date: Date;
  dayType: DayType;
  attractions: Attraction[];
  tripUsedAttractionIds: Set<string>;
  lateFlightFromPreviousDay?: LateFlightData;
}

// ============================================
// Logistics Result
// ============================================

export interface LogisticsResult {
  items: TripItem[];
  /** Heure à partir de laquelle les activités sont possibles */
  activitiesStartTime: Date;
  /** Heure limite pour les activités */
  activitiesEndTime: Date;
  /** Données du vol tardif à reporter au jour suivant */
  lateFlightForNextDay?: LateFlightData;
  /** Le voyageur est-il arrivé à destination ? */
  arrivedAtDestination: boolean;
}

// ============================================
// Claude Advisor Types
// ============================================

export type AdvisorQuestion =
  | 'late_arrival'     // Arrivée tardive: que faire ?
  | 'gap_fill'         // Temps libre: quoi faire ?
  | 'activity_order'   // Ordre optimal des activités
  | 'energy_check'     // Trop fatigué pour continuer ?
  | 'meal_decision';   // Manger maintenant ou attendre ?

export interface AdvisorRequest {
  question: AdvisorQuestion;
  state: TravelerStateSummary;
  options: AdvisorOption[];
  constraints: string[];
}

export interface AdvisorOption {
  id: string;
  label: string;
  duration: number; // minutes
  description?: string;
}

export interface AdvisorResponse {
  chosenId: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Résumé compact du state pour les prompts Claude (économise les tokens) */
export interface TravelerStateSummary {
  time: string;           // "14:30"
  location: string;       // "Barcelona centre-ville"
  availableHours: number; // 4.5
  energy: string;         // "modéré"
  meals: string;          // "petit-déj ✓, déjeuner ✗"
  dayType: string;        // "journée complète"
  pendingCount: number;   // nombre d'attractions restantes
}

// ============================================
// Activity Decision
// ============================================

/** Résultat d'une décision "que faire ensuite ?" */
export type NextAction =
  | { type: 'meal'; mealType: 'breakfast' | 'lunch' | 'dinner' }
  | { type: 'activity'; attraction: Attraction }
  | { type: 'hotel_checkin' }
  | { type: 'free_time'; reason: string }
  | { type: 'end_day'; reason: string };
