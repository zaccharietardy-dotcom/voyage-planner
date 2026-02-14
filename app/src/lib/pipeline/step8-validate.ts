/**
 * Pipeline V2 — Step 8: Post-Generation Quality Gate
 *
 * Validates and auto-fixes the generated trip before returning it.
 * Non-blocking: logs warnings but never prevents trip delivery.
 */

import type { Trip, TripDay, TripItem } from '../types';
import { calculateDistance } from '../services/geocoding';

export interface ValidationResult {
  score: number; // 0-100 quality score
  warnings: string[];
  autoFixes: string[];
}

export function validateAndFixTrip(trip: Trip): ValidationResult {
  const warnings: string[] = [];
  const autoFixes: string[] = [];
  let penalties = 0;

  for (const day of trip.days) {
    // 1. Check for placeholder restaurants (no real data)
    for (const item of day.items) {
      if (item.type === 'restaurant' && !item.restaurant) {
        warnings.push(`Day ${day.dayNumber}: Restaurant "${item.title}" has no restaurant data`);
        penalties += 5;
      }
    }

    // 2. Check restaurant distances (should be < 2km from nearest activity)
    const activities = day.items.filter(i => i.type === 'activity');
    const restaurants = day.items.filter(i => i.type === 'restaurant');
    for (const resto of restaurants) {
      if (!resto.latitude || !resto.longitude || resto.latitude === 0) continue;
      const nearestDist = activities.length > 0
        ? Math.min(...activities
            .filter(a => a.latitude && a.longitude && a.latitude !== 0)
            .map(a => calculateDistance(resto.latitude, resto.longitude, a.latitude, a.longitude)))
        : Infinity;
      if (nearestDist > 3 && nearestDist !== Infinity) {
        warnings.push(`Day ${day.dayNumber}: Restaurant "${resto.title}" is ${nearestDist.toFixed(1)}km from nearest activity`);
        penalties += 3;
      }
    }

    // 3. Check for duplicate restaurants within the same day
    const restoNames = restaurants.map(r => r.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, ''));
    const dupes = restoNames.filter((name, idx) => restoNames.indexOf(name) !== idx);
    if (dupes.length > 0) {
      warnings.push(`Day ${day.dayNumber}: Duplicate restaurant(s): ${[...new Set(dupes)].join(', ')}`);
      penalties += 5;
    }

    // 4. Check for days without any activity (except travel days)
    if (activities.length === 0 && !day.items.some(i => i.type === 'flight' || i.type === 'transport')) {
      warnings.push(`Day ${day.dayNumber}: No activities scheduled`);
      penalties += 8;
    }

    // 5. Check for items at coordinates (0, 0)
    for (const item of day.items) {
      if (item.latitude === 0 && item.longitude === 0 && ['activity', 'restaurant'].includes(item.type)) {
        warnings.push(`Day ${day.dayNumber}: "${item.title}" has (0,0) coordinates`);
        penalties += 2;
      }
    }

    // 6. Check for unrealistic gaps between consecutive items (>3 hours with nothing)
    const sortedItems = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sortedItems.length; i++) {
      const prev = sortedItems[i - 1];
      const curr = sortedItems[i];
      const prevEnd = timeToMinutes(prev.endTime);
      const currStart = timeToMinutes(curr.startTime);
      const gap = currStart - prevEnd;
      if (gap > 180) { // 3 hours
        warnings.push(`Day ${day.dayNumber}: ${gap}min gap between "${prev.title}" and "${curr.title}"`);
        penalties += 2;
      }
    }

    // 7. Auto-fix: Remove duplicate restaurants (keep the first occurrence)
    const seenRestoNames = new Set<string>();
    const itemsToRemove: number[] = [];
    day.items.forEach((item, idx) => {
      if (item.type === 'restaurant') {
        const cleanName = item.title.replace(/^(Petit-déjeuner|Déjeuner|Dîner) — /, '');
        // Allow same restaurant for different meals (breakfast vs lunch is OK)
        const mealType = item.title.match(/^(Petit-déjeuner|Déjeuner|Dîner)/)?.[0] || '';
        const key = `${cleanName}-${mealType}`;
        if (seenRestoNames.has(key)) {
          itemsToRemove.push(idx);
          autoFixes.push(`Day ${day.dayNumber}: Removed duplicate "${item.title}"`);
        } else {
          seenRestoNames.add(key);
        }
      }
    });
    // Remove duplicates (in reverse to preserve indices)
    for (const idx of itemsToRemove.reverse()) {
      day.items.splice(idx, 1);
    }

    // 8. Auto-fix: Re-index orderIndex after any removals
    day.items.forEach((item, idx) => {
      item.orderIndex = idx;
    });
  }

  // 9. Check hotel distance from activities centroid
  const allActivityCoords = trip.days.flatMap(d =>
    d.items.filter(i => i.type === 'activity' && i.latitude && i.longitude && i.latitude !== 0)
  );
  if (allActivityCoords.length > 0) {
    const centroid = {
      lat: allActivityCoords.reduce((s, a) => s + a.latitude, 0) / allActivityCoords.length,
      lng: allActivityCoords.reduce((s, a) => s + a.longitude, 0) / allActivityCoords.length,
    };

    const hotelItem = trip.days[0]?.items.find(i => i.type === 'checkin');
    if (hotelItem && hotelItem.latitude && hotelItem.latitude !== 0) {
      const hotelDist = calculateDistance(centroid.lat, centroid.lng, hotelItem.latitude, hotelItem.longitude);
      if (hotelDist > 5) {
        warnings.push(`Hotel "${hotelItem.title}" is ${hotelDist.toFixed(1)}km from activities centroid`);
        penalties += 5;
      }
    }
  }

  // 10. Check must-sees (from trip preferences)
  // This is informational only — must-see tracking is done in the pipeline

  const score = Math.max(0, 100 - penalties);

  // Log results
  if (warnings.length > 0) {
    console.log(`[Pipeline V2] Step 8 Quality Gate: Score ${score}/100`);
    warnings.forEach(w => console.log(`  ⚠️ ${w}`));
  }
  if (autoFixes.length > 0) {
    autoFixes.forEach(f => console.log(`  🔧 ${f}`));
  }

  return { score, warnings, autoFixes };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
