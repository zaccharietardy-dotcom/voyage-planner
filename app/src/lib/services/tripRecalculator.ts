/**
 * Service de recalcul en cascade des voyages (Bug #8)
 *
 * Quand un vol change, TOUT doit être recalculé:
 * - Nombre de nuits
 * - Disponibilité hôtel
 * - Restaurants disponibles
 * - Activités atteignables
 * - Prix total
 * - Score
 * - Itinéraires
 */

import { calculateFlightScore } from './flightScoring';

/**
 * Type de changement détecté
 */
export type ChangeType = {
  type: 'nights' | 'restaurants' | 'activities' | 'price' | 'score' | 'itineraries';
  old: number | string;
  new: number | string;
};

/**
 * Informations sur un vol
 */
export interface FlightInfo {
  departureTime?: string;
  arrivalTime?: string;
  date: string;
  price?: number;
}

/**
 * Informations sur un hôtel
 */
export interface HotelInfo {
  id?: string;
  name?: string;
  pricePerNight: number;
}

/**
 * Activité simplifiée
 */
export interface ActivityInfo {
  id: string;
  name: string;
  duration: number; // minutes
}

/**
 * Restaurant simplifié
 */
export interface RestaurantInfo {
  id: string;
  name: string;
  rating?: number;
}

/**
 * Données d'un voyage pour le recalcul
 */
export interface TripData {
  outboundFlight: FlightInfo;
  returnFlight: FlightInfo;
  hotel: HotelInfo;
  restaurants: RestaurantInfo[];
  activities: ActivityInfo[];
  price: number;
  score: number;
}

/**
 * Résultat du recalcul
 */
export interface RecalculationResult {
  updatedTrip: TripData;
  changes: ChangeType[];
  changesSummary: string;
}

/**
 * Calcule le nombre de nuits entre deux dates
 */
export function calculateNightsBetween(departureDate: string, returnDate: string): number {
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);

  const diffTime = ret.getTime() - dep.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Recalcule le prix total à partir des composants
 */
export function recalculatePrice(costs: {
  flights?: number;
  accommodation?: number;
  food?: number;
  activities?: number;
  transport?: number;
  parking?: number;
}): number {
  return (
    (costs.flights || 0) +
    (costs.accommodation || 0) +
    (costs.food || 0) +
    (costs.activities || 0) +
    (costs.transport || 0) +
    (costs.parking || 0)
  );
}

/**
 * Filtre les activités selon le temps disponible
 */
export function recalculateActivities(
  activities: ActivityInfo[],
  availableMinutes: number
): ActivityInfo[] {
  if (availableMinutes <= 0) {
    return [];
  }

  // Trier par durée croissante pour maximiser le nombre d'activités
  const sorted = [...activities].sort((a, b) => a.duration - b.duration);

  const selected: ActivityInfo[] = [];
  let remainingTime = availableMinutes;

  for (const activity of sorted) {
    if (activity.duration <= remainingTime) {
      selected.push(activity);
      remainingTime -= activity.duration;
    }
  }

  return selected;
}

/**
 * Crée un résumé des changements
 */
export function createChangesSummary(changes: ChangeType[]): string {
  if (changes.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (const change of changes) {
    switch (change.type) {
      case 'nights':
        lines.push(`Nights: ${change.old} → ${change.new}`);
        break;
      case 'price': {
        const diff = Number(change.new) - Number(change.old);
        const sign = diff >= 0 ? '+' : '';
        lines.push(`Price: ${change.old}€ → ${change.new}€ (${sign}${diff}€)`);
        break;
      }
      case 'score':
        lines.push(`Score: ${change.old}/100 → ${change.new}/100`);
        break;
      case 'restaurants':
        lines.push(`Restaurants: ${change.old} → ${change.new}`);
        break;
      case 'activities':
        lines.push(`Activities: ${change.old} → ${change.new}`);
        break;
      case 'itineraries':
        lines.push(`Itineraries updated`);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * Classe principale pour le recalcul de voyage
 */
export class TripRecalculator {
  private tripData: TripData;

  constructor(tripData: TripData) {
    this.tripData = { ...tripData };
  }

  /**
   * Change le vol retour et recalcule tout
   */
  changeReturnFlight(newFlight: FlightInfo): RecalculationResult {
    const changes: ChangeType[] = [];
    const updatedTrip = { ...this.tripData };

    // Vérifier que la date de retour est après la date de départ
    const outboundDate = new Date(this.tripData.outboundFlight.date);
    const returnDate = new Date(newFlight.date);

    if (returnDate < outboundDate) {
      throw new Error('Return flight cannot be before outbound flight');
    }

    // 1. Calculer le changement de nuits
    const oldNights = calculateNightsBetween(
      this.tripData.outboundFlight.date,
      this.tripData.returnFlight.date
    );
    const newNights = calculateNightsBetween(
      this.tripData.outboundFlight.date,
      newFlight.date
    );

    if (newNights !== oldNights) {
      changes.push({ type: 'nights', old: oldNights, new: newNights });
    }

    // 2. Recalculer le prix (hôtel + éventuellement vol)
    const hotelCostDiff = (newNights - oldNights) * this.tripData.hotel.pricePerNight;
    const flightPriceDiff = (newFlight.price || 0) - (this.tripData.returnFlight.price || 0);
    const newPrice = this.tripData.price + hotelCostDiff + flightPriceDiff;

    if (newPrice !== this.tripData.price) {
      changes.push({ type: 'price', old: this.tripData.price, new: newPrice });
      updatedTrip.price = newPrice;
    }

    // 3. Filtrer les restaurants si moins de nuits
    if (newNights < oldNights) {
      // Calculer combien de repas en moins (environ 3 repas par jour)
      const mealsPerDay = 3;
      const maxRestaurants = Math.max(1, newNights * mealsPerDay);
      const oldRestaurantCount = this.tripData.restaurants.length;

      if (oldRestaurantCount > maxRestaurants) {
        // Garder les restaurants les mieux notés
        const sorted = [...this.tripData.restaurants].sort(
          (a, b) => (b.rating || 0) - (a.rating || 0)
        );
        updatedTrip.restaurants = sorted.slice(0, maxRestaurants);

        changes.push({
          type: 'restaurants',
          old: oldRestaurantCount,
          new: updatedTrip.restaurants.length,
        });
      }
    }

    // 4. Recalculer les activités selon le temps disponible
    const availableHoursPerDay = 6; // ~6h d'activités par jour
    const totalAvailableMinutes = newNights * availableHoursPerDay * 60;
    const oldActivitiesCount = this.tripData.activities.length;

    const filteredActivities = recalculateActivities(
      this.tripData.activities,
      totalAvailableMinutes
    );

    if (filteredActivities.length !== oldActivitiesCount) {
      updatedTrip.activities = filteredActivities;
      changes.push({
        type: 'activities',
        old: oldActivitiesCount,
        new: filteredActivities.length,
      });
    }

    // 5. Recalculer le score SEULEMENT si l'heure de départ change
    const oldDepartureTime = this.tripData.returnFlight.departureTime || '12:00';
    const newDepartureTime = newFlight.departureTime || '12:00';

    if (oldDepartureTime !== newDepartureTime) {
      const oldFlightScore = calculateFlightScore({
        id: 'return',
        departureTime: oldDepartureTime,
        type: 'return',
        price: this.tripData.returnFlight.price || 0,
      });

      const newFlightScore = calculateFlightScore({
        id: 'return',
        departureTime: newDepartureTime,
        type: 'return',
        price: newFlight.price || 0,
      });

      // Calculer la différence de score due au vol
      const flightScoreDiff = (newFlightScore - oldFlightScore) / 3; // Normaliser l'impact
      const newScore = Math.round(this.tripData.score + flightScoreDiff);

      if (newScore !== this.tripData.score) {
        changes.push({ type: 'score', old: this.tripData.score, new: newScore });
        updatedTrip.score = newScore;
      }
    }

    // Mettre à jour le vol retour
    updatedTrip.returnFlight = newFlight;

    return {
      updatedTrip,
      changes,
      changesSummary: createChangesSummary(changes),
    };
  }

  /**
   * Change le vol aller et recalcule
   */
  changeOutboundFlight(newFlight: FlightInfo): RecalculationResult {
    const changes: ChangeType[] = [];
    const updatedTrip = { ...this.tripData };

    // Vérifier que la date de départ est avant la date de retour
    const outboundDate = new Date(newFlight.date);
    const returnDate = new Date(this.tripData.returnFlight.date);

    if (outboundDate > returnDate) {
      throw new Error('Outbound flight cannot be after return flight');
    }

    // Calculer le changement de nuits
    const oldNights = calculateNightsBetween(
      this.tripData.outboundFlight.date,
      this.tripData.returnFlight.date
    );
    const newNights = calculateNightsBetween(
      newFlight.date,
      this.tripData.returnFlight.date
    );

    if (newNights !== oldNights) {
      changes.push({ type: 'nights', old: oldNights, new: newNights });

      // Recalculer le prix
      const hotelCostDiff = (newNights - oldNights) * this.tripData.hotel.pricePerNight;
      const newPrice = this.tripData.price + hotelCostDiff;

      changes.push({ type: 'price', old: this.tripData.price, new: newPrice });
      updatedTrip.price = newPrice;
    }

    updatedTrip.outboundFlight = newFlight;

    return {
      updatedTrip,
      changes,
      changesSummary: createChangesSummary(changes),
    };
  }

  /**
   * Obtient les données actuelles du voyage
   */
  getTripData(): TripData {
    return { ...this.tripData };
  }
}
