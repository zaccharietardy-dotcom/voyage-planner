/**
 * Pipeline V3 — Canonical time helpers.
 * Single source of truth for "HH:MM" ↔ minutes conversions used across pipeline steps.
 */

/** Convert "HH:MM" to total minutes since midnight */
export function timeToMin(time: string): number {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return (Math.min(h || 0, 23)) * 60 + (Math.min(m || 0, 59));
}

/** Convert total minutes since midnight to "HH:MM" */
export function minToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Add minutes to a "HH:MM" time string, returns "HH:MM" */
export function addMinutes(time: string, minutes: number): string {
  return minToTime(timeToMin(time) + minutes);
}

/** Round "HH:MM" up to the next 5-minute boundary (e.g. "14:51" → "14:55") */
export function roundUpTo5(time: string): string {
  const total = timeToMin(time);
  const rounded = Math.ceil(total / 5) * 5;
  return minToTime(rounded);
}

/** Returns true if time >= endTime (both "HH:MM") */
export function isPastEnd(time: string, endTime: string): boolean {
  return timeToMin(time) >= timeToMin(endTime);
}

/** Returns the later of time and minTime (both "HH:MM") */
export function ensureAfter(time: string, minTime: string): string {
  return timeToMin(time) >= timeToMin(minTime) ? time : minTime;
}

/** Sort items by startTime and re-assign orderIndex */
export function sortAndReindexItems(items: { startTime?: string; orderIndex: number }[]): void {
  items.sort((a, b) => timeToMin(a.startTime || '00:00') - timeToMin(b.startTime || '00:00'));
  items.forEach((item, idx) => { item.orderIndex = idx; });
}

/** Estime le temps de trajet en minutes entre deux points. */
export function estimateTravelBuffer(distanceKm: number): number {
  if (distanceKm <= 0) return 5;
  if (distanceKm <= 1.0) return Math.max(5, Math.ceil((distanceKm / 4.5) * 60));
  return Math.max(5, Math.ceil(distanceKm * 4));
}
