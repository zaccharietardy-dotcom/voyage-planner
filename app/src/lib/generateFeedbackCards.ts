/**
 * Pure function: generate A/B preference cards from a completed Trip.
 * No side effects, no API calls.
 */

import type { Trip, TripItem } from './types';
import type { FeedbackCard } from './types/pipelineQuestions';

const MAX_CARDS = 3;

export function generateFeedbackCards(trip: Trip): FeedbackCard[] {
  const cards: FeedbackCard[] = [];

  // 1. Restaurant swaps — items with alternatives that have higher ratings
  const restaurantSwaps = findRestaurantSwaps(trip);
  cards.push(...restaurantSwaps);

  // 2. Activity swaps — afternoon activities with pool alternatives
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

  // Available alternatives from the pool
  const available = trip.attractionPool.filter(a => !scheduledIds.has(a.id || a.name));
  if (available.length === 0) return [];

  // Find afternoon activities that could be swapped
  const candidates: FeedbackCard[] = [];
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      if (item.startTime < '13:00') continue; // afternoon only
      if (item.mustSee) continue; // never swap must-sees

      // Find an alternative of different type with good rating
      const itemType = item.type as string;
      const alt = available.find(a =>
        ((a.type as string) !== itemType || !itemType) &&
        (a.rating || 0) >= (item.rating || 0) * 0.9
      );
      if (!alt) continue;

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

      if (candidates.length >= 1) break; // max 1 activity card
    }
    if (candidates.length >= 1) break;
  }

  return candidates;
}
