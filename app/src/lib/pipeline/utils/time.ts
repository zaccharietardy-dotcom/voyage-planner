/**
 * Pipeline V3 — Canonical time helpers.
 * Single source of truth for "HH:MM" ↔ minutes conversions used across pipeline steps.
 */

/** Convert "HH:MM" to total minutes since midnight */
export function timeToMin(time: string): number {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Convert total minutes since midnight to "HH:MM" */
export function minToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Add minutes to a "HH:MM" time string, returns "HH:MM" */
export function addMinutes(time: string, minutes: number): string {
  return minToTime(timeToMin(time) + minutes);
}

/** Returns true if time >= endTime (both "HH:MM") */
export function isPastEnd(time: string, endTime: string): boolean {
  return timeToMin(time) >= timeToMin(endTime);
}

/** Returns the later of time and minTime (both "HH:MM") */
export function ensureAfter(time: string, minTime: string): string {
  return timeToMin(time) >= timeToMin(minTime) ? time : minTime;
}
