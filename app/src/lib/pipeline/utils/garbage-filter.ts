/**
 * Centralized garbage activity filter.
 *
 * Rejects non-POI entries that come from Overpass/OSM data (e.g. "mètre",
 * "kilogram", "euro") and activities whose descriptions clearly indicate
 * they are measurement units rather than real places.
 *
 * Used in step2 (scoring), step3 (enrichment pool), step4 (assembly),
 * and step7 (gap-fill eligibility).
 */

/** Matches names that are SI units, currencies, or other non-POI terms */
export const NON_POI_NAME_PATTERN =
  /^(m[eè]tre|kilogram|grammes?|secondes?|litre|watt|volt|amp[eè]re|newton|pascal|joule|hertz|kelvin|mole|candela|euro|dollar|franc|pound|yen|bitcoin)$/i;

/** Matches descriptions that indicate a measurement-unit or non-place entity */
export const GARBAGE_DESC_PATTERN =
  /unit[eé]\s+de\s+mesure|syst[eè]me\s+international|\bmeasurement\b/i;

/**
 * Returns true if the activity is garbage (not a real place).
 *
 * Activities with `mustSee: true` are never filtered — they come from
 * curated must-see lists and should always be kept.
 */
export function isGarbageActivity(activity: {
  name?: string;
  description?: string;
  mustSee?: boolean;
}): boolean {
  const name = (activity.name || '').trim();

  // Name matches a known non-POI pattern
  if (NON_POI_NAME_PATTERN.test(name) && !activity.mustSee) {
    return true;
  }

  // Description indicates a measurement unit / non-place
  if (activity.description && GARBAGE_DESC_PATTERN.test(activity.description)) {
    return true;
  }

  return false;
}
