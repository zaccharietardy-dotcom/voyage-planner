/**
 * Pure function: generate A/B preference cards from a completed Trip.
 * No side effects, no API calls.
 *
 * Improvements over v1:
 * - Activity swaps check geographic proximity (< 3km from day center)
 * - More alternatives: up to 5 cards instead of 3
 * - Propose alternatives for ALL eligible items, not just afternoon activities
 * - Restaurant alternatives already filtered by pipeline (< 800m)
 */

import type { Trip, TripItem, TripDay } from './types';
import type { FeedbackCard } from './types/pipelineQuestions';

const MAX_CARDS = 5;

/** Haversine distance in km between two GPS points */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute the geographic center of a day's activities */
function dayCenter(day: TripDay): { lat: number; lng: number } | null {
  const items = day.items.filter(i => i.latitude && i.longitude && i.type === 'activity');
  if (items.length === 0) return null;
  const lat = items.reduce((s, i) => s + i.latitude, 0) / items.length;
  const lng = items.reduce((s, i) => s + i.longitude, 0) / items.length;
  return { lat, lng };
}

export function generateFeedbackCards(trip: Trip): FeedbackCard[] {
  const cards: FeedbackCard[] = [];

  // 1. Restaurant swaps — items with alternatives that have higher ratings
  const restaurantSwaps = findRestaurantSwaps(trip);
  cards.push(...restaurantSwaps);

  // 2. Activity swaps — activities with pool alternatives nearby
  if (cards.length < MAX_CARDS) {
    const activitySwaps = findActivitySwaps(trip);
    cards.push(...activitySwaps.slice(0, MAX_CARDS - cards.length));
  }

  return cards.slice(0, MAX_CARDS);
}

function findRestaurantSwaps(trip: Trip): FeedbackCard[] {
  const candidates: Array<{
    item: TripItem;
    dayNumber: number;
    alternative: NonNullable<TripItem['restaurant']>;
    ratingGap: number;
  }> = [];

  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'restaurant' || !item.restaurant) continue;
      if (!item.restaurantAlternatives || item.restaurantAlternatives.length === 0) continue;

      // Find the highest-rated alternative
      const bestAlt = item.restaurantAlternatives.reduce((best, alt) =>
        (alt.rating || 0) > (best.rating || 0) ? alt : best
      , item.restaurantAlternatives[0]);

      const gap = (bestAlt.rating || 0) - (item.restaurant.rating || 0);
      if (gap > 0) {
        candidates.push({
          item,
          dayNumber: day.dayNumber,
          alternative: bestAlt,
          ratingGap: gap,
        });
      }
    }
  }

  // Sort by rating gap descending, take top 2
  candidates.sort((a, b) => b.ratingGap - a.ratingGap);

  return candidates.slice(0, 2).map((c): FeedbackCard => {
    const mealLabel = c.item.startTime < '12:00' ? 'Petit-déjeuner'
      : c.item.startTime < '15:00' ? 'Déjeuner' : 'Dîner';

    return {
      id: `resto-${c.item.id}`,
      type: 'restaurant_swap',
      dayNumber: c.dayNumber,
      slotLabel: `${mealLabel} — Jour ${c.dayNumber}`,
      optionA: {
        id: c.item.restaurant!.id || c.item.id,
        name: c.item.restaurant!.name,
        rating: c.item.restaurant!.rating,
        imageUrl: c.item.restaurant!.photos?.[0] || c.item.imageUrl,
        cuisineOrType: c.item.restaurant!.cuisineTypes?.join(', ') || undefined,
      },
      optionB: {
        id: c.alternative.id || `alt-${c.item.id}`,
        name: c.alternative.name,
        rating: c.alternative.rating,
        imageUrl: c.alternative.photos?.[0],
        cuisineOrType: c.alternative.cuisineTypes?.join(', ') || undefined,
      },
      targetItemId: c.item.id,
    };
  });
}

function findActivitySwaps(trip: Trip): FeedbackCard[] {
  if (!trip.attractionPool || trip.attractionPool.length === 0) return [];

  // Collect scheduled activity IDs
  const scheduledIds = new Set<string>();
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'activity') scheduledIds.add(item.id);
    }
  }

  // Available alternatives from the pool (not already scheduled)
  const available = trip.attractionPool.filter(a =>
    !scheduledIds.has(a.id || a.name) && a.latitude && a.longitude
  );
  if (available.length === 0) return [];

  // Pre-compute day centers for proximity check
  const dayCenters = new Map<number, { lat: number; lng: number }>();
  for (const day of trip.days) {
    const center = dayCenter(day);
    if (center) dayCenters.set(day.dayNumber, center);
  }

  const candidates: FeedbackCard[] = [];
  const usedAlternatives = new Set<string>();

  for (const day of trip.days) {
    const center = dayCenters.get(day.dayNumber);

    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      if (item.mustSee) continue; // never swap must-sees

      // Find a nearby alternative with decent rating
      const alt = available.find(a => {
        const altId = a.id || a.name;
        if (usedAlternatives.has(altId)) return false;

        // Check proximity: alternative must be < 3km from day center
        if (center && a.latitude && a.longitude) {
          const dist = distanceKm(center.lat, center.lng, a.latitude, a.longitude);
          if (dist > 3) return false;
        }

        // Must have a reasonable rating
        return (a.rating || 0) >= (item.rating || 0) * 0.8;
      });

      if (!alt) continue;
      usedAlternatives.add(alt.id || alt.name);

      candidates.push({
        id: `activity-${item.id}`,
        type: 'activity_swap',
        dayNumber: day.dayNumber,
        slotLabel: `Activité — Jour ${day.dayNumber}`,
        optionA: {
          id: item.id,
          name: item.title,
          rating: item.rating,
          imageUrl: item.imageUrl,
          cuisineOrType: item.type,
        },
        optionB: {
          id: alt.id || alt.name,
          name: alt.name,
          rating: alt.rating,
          imageUrl: alt.imageUrl,
          cuisineOrType: alt.type,
        },
        targetItemId: item.id,
      });

      if (candidates.length >= 3) break;
    }
    if (candidates.length >= 3) break;
  }

  return candidates;
}
