/**
 * Pipeline V4 — Step 3: Find hotels per hub
 *
 * For each hub where the traveler sleeps, search Booking + Airbnb
 * for real available accommodations.
 */

import type { TripPreferences, Accommodation } from '../types';
import type { LLMTripHub, HubHotelResult } from './types';
import { searchHotels } from '../services/hotels';
import { searchAirbnbListings } from '../services/airbnb';
import { geocodeAddress } from '../services/geocoding';
import { runValidationTasks, type ValidationTask } from '../pipeline/utils/validation-orchestrator';
import { resolveBudget } from '../services/budgetResolver';

export async function findHotelsForHubs(
  hubs: LLMTripHub[],
  preferences: TripPreferences,
  hubCoords: Map<string, { lat: number; lng: number }>,
  onProgress?: (label: string) => void,
): Promise<{ hotels: HubHotelResult[]; latencyMs: number }> {
  const t0 = Date.now();

  const sleepHubs = hubs.filter(h => h.sleepHere);
  if (sleepHubs.length === 0) {
    return { hotels: [], latencyMs: 0 };
  }

  const startDate = preferences.startDate ? new Date(preferences.startDate) : new Date();
  const resolved = resolveBudget(preferences);
  const budgetPerNight = typeof resolved === 'number'
    ? Math.round(resolved / (preferences.durationDays || 3) * 0.35)
    : undefined;

  const tasks: ValidationTask<HubHotelResult>[] = sleepHubs.map((hub) => ({
    key: `hotel:${hub.city}:d${hub.day}`,
    provider: 'booking',
    run: async (): Promise<HubHotelResult> => {
      // Resolve hub coords if not already known
      let coords = hubCoords.get(hub.city);
      if (!coords) {
        const geo = await geocodeAddress(hub.city);
        if (geo) {
          coords = { lat: geo.lat, lng: geo.lng };
          hubCoords.set(hub.city, coords);
        }
      }
      if (!coords) {
        return { hub, hotel: null, alternatives: [], source: 'fallback' };
      }

      const checkIn = new Date(startDate);
      checkIn.setDate(checkIn.getDate() + hub.day - 1);
      const checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 1);

      // Try Booking.com first
      try {
        const hotels = await searchHotels(hub.city, {
          budgetLevel: preferences.budgetLevel,
          cityCenter: coords,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          guests: preferences.groupSize || 2,
        });

        // Filter: must be within 5km of hub center
        const nearby = hotels.filter((h: Accommodation) => {
          if (!h.latitude || !h.longitude) return false;
          const { calculateDistance } = require('../services/geocoding');
          const dist = calculateDistance(h.latitude, h.longitude, coords!.lat, coords!.lng);
          return dist < 5;
        });

        if (nearby.length > 0) {
          return {
            hub,
            hotel: nearby[0],
            alternatives: nearby.slice(1, 3),
            source: 'booking',
          };
        }
      } catch (e) {
        console.warn(`[V4 Hotels] Booking failed for ${hub.city}:`, (e as Error).message);
      }

      // Fallback: Airbnb
      try {
        const checkInStr = checkIn.toISOString().slice(0, 10);
        const checkOutStr = checkOut.toISOString().slice(0, 10);
        const airbnbs = await searchAirbnbListings(hub.city, checkInStr, checkOutStr, {
          guests: preferences.groupSize || 2,
          maxPricePerNight: budgetPerNight,
          limit: 3,
          cityCenter: coords,
        });

        if (airbnbs.length > 0) {
          return {
            hub,
            hotel: airbnbs[0],
            alternatives: airbnbs.slice(1, 3),
            source: 'airbnb',
          };
        }
      } catch (e) {
        console.warn(`[V4 Hotels] Airbnb failed for ${hub.city}:`, (e as Error).message);
      }

      return { hub, hotel: null, alternatives: [], source: 'fallback' };
    },
  }));

  onProgress?.(`Finding hotels for ${sleepHubs.length} hubs...`);
  const results = await runValidationTasks(tasks, {
    defaultConcurrency: 3,
    maxRetries: 1,
    hardCapMs: 30000,
  });

  const hotels: HubHotelResult[] = [];
  for (const [, settled] of results.settledByKey) {
    if (settled.status === 'fulfilled') {
      hotels.push(settled.value);
    }
  }

  return { hotels, latencyMs: Date.now() - t0 };
}
