/**
 * Service d'enrichissement des activités avec les options de transport
 * Ajoute les infos de transit, marche, et VTC entre les activités
 */

import { TripItem, TripDay } from '@/lib/types';
import {
  getMultiModalDirections,
  MultiModalDirections,
  Coordinates,
} from './directions';

export interface EnrichedTransportInfo {
  fromActivity: TripItem;
  toActivity: TripItem;
  transportOptions: MultiModalDirections;
}

export interface EnrichedDayTransport {
  dayNumber: number;
  date: Date;
  transports: EnrichedTransportInfo[];
}

/**
 * Enrichit un itinéraire avec les options de transport détaillées
 * @param days - Les jours du voyage
 * @param city - La ville de destination (pour les multiplicateurs VTC)
 * @returns Les informations de transport enrichies par jour
 */
export async function enrichWithTransitOptions(
  days: TripDay[],
  city: string
): Promise<EnrichedDayTransport[]> {
  const enrichedDays: EnrichedDayTransport[] = [];

  for (const day of days) {
    const transports: EnrichedTransportInfo[] = [];

    // Pour chaque paire d'activités consécutives
    for (let i = 0; i < day.items.length - 1; i++) {
      const fromActivity = day.items[i];
      const toActivity = day.items[i + 1];

      // Ignorer les items sans coordonnées ou les vols/parking
      if (
        !fromActivity.latitude ||
        !fromActivity.longitude ||
        !toActivity.latitude ||
        !toActivity.longitude ||
        fromActivity.type === 'flight' ||
        fromActivity.type === 'parking' ||
        toActivity.type === 'flight' ||
        toActivity.type === 'parking'
      ) {
        continue;
      }

      const origin: Coordinates = {
        lat: fromActivity.latitude,
        lng: fromActivity.longitude,
      };

      const destination: Coordinates = {
        lat: toActivity.latitude,
        lng: toActivity.longitude,
      };

      try {
        // Obtenir les options multi-modales
        const transportOptions = await getMultiModalDirections(
          origin,
          destination,
          city,
          new Date(`${day.date}T${toActivity.startTime}`) // Heure de départ souhaitée
        );

        transports.push({
          fromActivity,
          toActivity,
          transportOptions,
        });
      } catch (error) {
        console.error(
          `Failed to get transport options from ${fromActivity.title} to ${toActivity.title}:`,
          error
        );
      }
    }

    enrichedDays.push({
      dayNumber: day.dayNumber,
      date: day.date,
      transports,
    });
  }

  return enrichedDays;
}

/**
 * Enrichit un seul trajet entre deux activités
 * Utile pour l'ajout/modification dynamique d'activités
 */
export async function enrichSingleTransport(
  fromActivity: TripItem,
  toActivity: TripItem,
  city: string,
  departureTime?: Date
): Promise<EnrichedTransportInfo | null> {
  if (
    !fromActivity.latitude ||
    !fromActivity.longitude ||
    !toActivity.latitude ||
    !toActivity.longitude
  ) {
    return null;
  }

  const origin: Coordinates = {
    lat: fromActivity.latitude,
    lng: fromActivity.longitude,
  };

  const destination: Coordinates = {
    lat: toActivity.latitude,
    lng: toActivity.longitude,
  };

  try {
    const transportOptions = await getMultiModalDirections(
      origin,
      destination,
      city,
      departureTime
    );

    return {
      fromActivity,
      toActivity,
      transportOptions,
    };
  } catch (error) {
    console.error(
      `Failed to get transport options from ${fromActivity.title} to ${toActivity.title}:`,
      error
    );
    return null;
  }
}

/**
 * Détermine le meilleur mode de transport basé sur la distance et la durée
 */
export function recommendTransportMode(
  transportOptions: MultiModalDirections
): 'walking' | 'transit' | 'ride' {
  // Si marche < 15 min, recommander la marche
  if (transportOptions.recommendWalking && transportOptions.walking) {
    return 'walking';
  }

  // Si transit disponible et raisonnable (< 45 min)
  if (transportOptions.transit && transportOptions.transit.duration < 45) {
    return 'transit';
  }

  // Si marche < 25 min, la recommander même si pas < 15 min
  if (transportOptions.walking && transportOptions.walking.duration < 25) {
    return 'walking';
  }

  // Sinon, recommander le VTC
  return 'ride';
}

/**
 * Formate le prix du VTC pour l'affichage
 */
export function formatRidePrice(
  priceMin: number,
  priceMax: number,
  currency: string = 'EUR'
): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;

  if (priceMin === priceMax) {
    return `${priceMin}${symbol}`;
  }

  return `${priceMin}-${priceMax}${symbol}`;
}

/**
 * Calcule le temps total de transport pour une journée
 */
export function calculateDailyTransportTime(
  transports: EnrichedTransportInfo[],
  preferredMode: 'walking' | 'transit' | 'ride' = 'transit'
): number {
  let totalMinutes = 0;

  for (const transport of transports) {
    const { transportOptions } = transport;

    let duration = 0;
    if (preferredMode === 'walking' && transportOptions.walking) {
      duration = transportOptions.walking.duration;
    } else if (preferredMode === 'transit' && transportOptions.transit) {
      duration = transportOptions.transit.duration;
    } else if (preferredMode === 'ride' && transportOptions.rideHailing) {
      duration = transportOptions.rideHailing.duration;
    } else {
      // Fallback: prendre le mode disponible
      duration =
        transportOptions.transit?.duration ||
        transportOptions.walking?.duration ||
        transportOptions.rideHailing?.duration ||
        0;
    }

    totalMinutes += duration;
  }

  return totalMinutes;
}
