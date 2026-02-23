/**
 * Opening hours utilities for activity scheduling.
 * Extracted from step7-assemble.ts for reuse across pipeline steps.
 *
 * Handles per-day hours, opening/closing time validation,
 * always-open public space detection, and day-of-week closures.
 */

import { parseTime } from '../../services/scheduler';
import type { ScoredActivity } from '../types';
import { INDOOR_ACTIVITY_KEYWORDS, OUTDOOR_ACTIVITY_KEYWORDS } from './constants';

// ============================================
// Constants
// ============================================

export const DAY_NAMES_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ============================================
// Core Functions
// ============================================

/**
 * Get the opening hours for an activity on a specific day.
 * Priority: per-day hours (openingHoursByDay) > default hours (openingHours).
 * Returns null if the activity is CLOSED that day.
 */
export function getActivityHoursForDay(activity: ScoredActivity, dayDate: Date): { open: string; close: string } | null {
  const dayName = DAY_NAMES_EN[dayDate.getDay()];

  // PRIORITY 1: Per-day hours from Google Places Details
  if (activity.openingHoursByDay && dayName in activity.openingHoursByDay) {
    const dayHours = activity.openingHoursByDay[dayName];
    return dayHours; // null means closed that day
  }

  // PRIORITY 2: Default hours
  if (activity.openingHours?.open && activity.openingHours?.close) {
    return activity.openingHours;
  }

  return null; // Unknown — no constraint
}

/**
 * Get maximum end time for an activity based on its type and opening hours.
 * Outdoor activities (parks, gardens) get a 19:30 cap when hours unknown.
 * Indoor activities have no special cap.
 */
export function getActivityMaxEndTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
  // PRIORITY 1: Per-day real opening hours (Google Places Details API)
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (dayHours?.close && dayHours.close !== '23:59') {
    return parseTime(dayDate, dayHours.close);
  }

  // PRIORITY 2: Simple opening hours (if set and not default)
  if (!dayHours && activity.openingHours?.close && activity.openingHours.close !== '23:59' && activity.openingHours.close !== '18:00') {
    return parseTime(dayDate, activity.openingHours.close);
  }

  const name = (activity.name || '').toLowerCase();
  const type = (activity.type || '').toLowerCase();
  const allText = `${name} ${type}`;

  // Check if indoor first (takes priority)
  const isIndoor = INDOOR_ACTIVITY_KEYWORDS.some(k => allText.includes(k));
  if (isIndoor) return undefined; // No cap for indoor (hours unknown)

  // Check if outdoor
  const isOutdoor = OUTDOOR_ACTIVITY_KEYWORDS.some(k => allText.includes(k));
  if (isOutdoor) {
    // Cap at 19:30 (generous — most parks close earlier in winter)
    return parseTime(dayDate, '19:30');
  }

  // Unknown type — no cap (err on the side of flexibility)
  return undefined;
}

/**
 * Detect public spaces that are always open (bridges, squares, parks, monuments, etc.).
 * Google Places often returns `null` opening hours for these, which would incorrectly
 * flag them as "closed". This whitelist bypasses the opening hours check entirely.
 */
export function isAlwaysOpenPublicSpace(activity: ScoredActivity): boolean {
  const name = (activity.name || '').toLowerCase();
  const ALWAYS_OPEN_KEYWORDS = [
    'piazza', 'plaza', 'place', 'square', 'platz', 'náměstí', 'namesti', 'tér',
    'bridge', 'pont', 'puente', 'brücke', 'most', 'ponte',
    'park', 'jardin', 'garden', 'garten', 'parc',
    'fountain', 'fontaine', 'fontana', 'fuente',
    'promenade', 'boulevard', 'esplanade', 'paseo',
    'viewpoint', 'belvedere', 'mirador', 'belvédère',
    'quai', 'waterfront', 'lungomare', 'boardwalk',
    'wall', 'mur ', 'muralla', 'mauer',
    'gate', 'porte', 'porta', 'tor ', 'puerta',
    'column', 'colonne', 'obelisk', 'obélisque',
    'statue', 'monument',
  ];
  return ALWAYS_OPEN_KEYWORDS.some(kw => name.includes(kw));
}

/**
 * Check if an activity is open on a specific day.
 * Returns false only if we have per-day data and the day is explicitly null (closed).
 * Returns true for unknown hours (default — err on side of scheduling).
 */
export function isActivityOpenOnDay(activity: ScoredActivity, dayDate: Date): boolean {
  if (isAlwaysOpenPublicSpace(activity)) return true; // Public spaces never close
  if (!activity.openingHoursByDay) return true; // No per-day data — assume open
  const dayName = DAY_NAMES_EN[dayDate.getDay()];
  if (!(dayName in activity.openingHoursByDay)) return true; // Day not in data — assume open
  return activity.openingHoursByDay[dayName] !== null; // null = closed
}

/**
 * Check if an activity is open during a specific scheduled time slot.
 * Returns true if no opening hours data is available (don't block scheduling).
 * Returns false if the venue is explicitly closed that day (null) or if the
 * scheduled time slot falls outside the venue's opening hours.
 *
 * @param activity - The scored activity with potential openingHours / openingHoursByDay data
 * @param dayDate - The calendar date of the scheduled day
 * @param startTime - Scheduled start time in "HH:MM" format
 * @param endTime - Scheduled end time in "HH:MM" format
 */
export function isOpenAtTime(
  activity: ScoredActivity,
  dayDate: Date,
  startTime: string,
  endTime: string
): boolean {
  // Public spaces (bridges, squares, parks, etc.) are always accessible
  if (isAlwaysOpenPublicSpace(activity)) return true;

  // Step 1: Get the hours for this specific day
  const dayHours = getActivityHoursForDay(activity, dayDate);

  // If getActivityHoursForDay returns null, it could mean:
  // (a) venue is CLOSED that day (openingHoursByDay[day] === null), or
  // (b) no hours data at all — assume open
  if (dayHours === null) {
    // Distinguish (a) vs (b) using isActivityOpenOnDay
    return isActivityOpenOnDay(activity, dayDate);
  }

  // Step 2: We have hours — check if the scheduled slot overlaps
  // Parse venue open/close times and scheduled start/end times
  const venueOpen = parseTime(dayDate, dayHours.open);
  const venueClose = parseTime(dayDate, dayHours.close);
  const slotStart = parseTime(dayDate, startTime);
  const slotEnd = parseTime(dayDate, endTime);

  // Handle venues open 24h (00:00-23:59)
  if (dayHours.open === '00:00' && (dayHours.close === '23:59' || dayHours.close === '00:00')) {
    return true;
  }

  // The activity must start at or after venue opens, and end at or before venue closes
  // Allow 15 min tolerance: venue might let you in slightly before opening
  const TOLERANCE_MS = 15 * 60 * 1000;
  const opensEarlyEnough = slotStart.getTime() >= venueOpen.getTime() - TOLERANCE_MS;
  const closesLateEnough = slotEnd.getTime() <= venueClose.getTime() + TOLERANCE_MS;

  return opensEarlyEnough && closesLateEnough;
}

/**
 * Get minimum start time for an activity based on its opening hours.
 * Prevents scheduling a museum visit at 07:00 when it opens at 10:00.
 */
export function getActivityMinStartTime(activity: ScoredActivity, dayDate: Date): Date | undefined {
  // PRIORITY 1: Per-day hours
  const dayHours = getActivityHoursForDay(activity, dayDate);
  if (dayHours?.open && dayHours.open !== '00:00') {
    return parseTime(dayDate, dayHours.open);
  }

  // PRIORITY 2: Simple opening hours
  if (activity.openingHours?.open && activity.openingHours.open !== '00:00') {
    return parseTime(dayDate, activity.openingHours.open);
  }
  return undefined;
}
