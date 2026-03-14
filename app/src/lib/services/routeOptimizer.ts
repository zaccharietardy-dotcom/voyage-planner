import type { TripDay } from '@/lib/types';
import { geoReorderDayItems } from '@/lib/pipeline/utils/geo-reorder';
import { cascadeRecalculate } from './itineraryCalculator';

/**
 * Optimise l'ordre des activités d'une journée pour minimiser les trajets,
 * puis recalcule les horaires en cascade.
 */
export function optimizeDay(
  days: TripDay[],
  dayNumber: number,
  hotelLat: number,
  hotelLng: number
): TripDay[] {
  const dayIndex = days.findIndex(d => d.dayNumber === dayNumber);
  if (dayIndex === -1) return days;

  const day = days[dayIndex];
  const dayDate = day.date ? new Date(day.date) : undefined;

  // Reorder activities geographically
  const reorderedItems = geoReorderDayItems([...day.items], hotelLat, hotelLng, dayDate);

  // Sort by orderIndex after geo-reorder (it updates orderIndex)
  reorderedItems.sort((a, b) => {
    // Keep anchors (transport, checkin, checkout, flight) in their original time slots
    if (a.type !== 'activity' && b.type !== 'activity') {
      return (a.startTime || '').localeCompare(b.startTime || '');
    }
    return (a.orderIndex || 0) - (b.orderIndex || 0);
  });

  // Update the day with reordered items
  const updatedDays = days.map((d, idx) => {
    if (idx !== dayIndex) return d;
    return { ...d, items: reorderedItems };
  });

  // Find the first activity to use as cascade start point
  const firstActivity = reorderedItems.find(item => item.type === 'activity');
  if (!firstActivity) return updatedDays;

  // Cascade recalculate from the first activity
  return cascadeRecalculate(updatedDays, firstActivity.id, 'move');
}
