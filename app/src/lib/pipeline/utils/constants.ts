/**
 * Shared constants for Pipeline V2.
 * Single source of truth for keyword lists used across multiple pipeline steps.
 */

/** Keywords indicating outdoor activities (parks, gardens, beaches, viewpoints...) */
export const OUTDOOR_ACTIVITY_KEYWORDS = [
  'park', 'parc', 'tuin',
  'garden', 'jardin', 'botanical', 'botanique',
  'viewpoint', 'belvedere', 'belvédère', 'mirador',
  'cemetery', 'cimetière',
  'zoo',
  'beach', 'plage', 'playa', 'spiaggia',
  'trail', 'randonnée', 'sentier',
  'promenade',
  'square', 'place', 'plaza', 'piazza',
];

/** Keywords indicating indoor activities (museums, galleries, theaters...) */
export const INDOOR_ACTIVITY_KEYWORDS = [
  'museum', 'musée', 'museo',
  'gallery', 'galerie', 'galleria',
  'church', 'église', 'chiesa', 'cathedral', 'cathédrale', 'basilica', 'basilique',
  'mosque', 'mosquée', 'synagogue', 'temple',
  'theater', 'théâtre', 'teatro', 'opera', 'opéra',
  'cinema', 'cinéma',
  'aquarium', 'planetarium',
  'palace', 'palais', 'palazzo', 'castle', 'château',
  'library', 'bibliothèque',
  'mall', 'shopping center', 'centre commercial', 'shopping',
  'spa', 'hammam', 'wellness',
  'station', 'gare',
  'restaurant', 'bar', 'club', 'pub',
  'show', 'spectacle', 'concert',
  'casino', 'bowling',
];

/**
 * Minimum meaningful visit durations by activity type (minutes).
 * Used by the scheduler to reject activities that would be clamped
 * below a useful visit time (e.g., don't schedule 20min at Sagrada Familia).
 * Patterns are tested against `${name} ${type}` (lowercase).
 * First match wins — order from most specific to least specific.
 */
const MIN_DURATION_RULES: [RegExp, number][] = [
  // Major museums, cathedrals, basilicas: at least 60 min
  [/\b(museum|mus[eé][eo]|gallery|galerie|galleria|cathedral|cath[eé]drale|basilica|basilique)\b/i, 60],
  // Palaces, castles, forts: at least 45 min
  [/\b(palace|palais|palazzo|castle|ch[aâ]teau|fort|fortress|forteresse)\b/i, 45],
  // Parks, gardens, zoos, aquariums: at least 30 min
  [/\b(park|parc|garden|jardin|botanical|botanique|zoo|aquarium)\b/i, 30],
  // Churches (non-cathedral), mosques, temples: at least 20 min
  [/\b(church|[eé]glise|chiesa|mosque|mosqu[eé]e|temple|synagogue|chapel|chapelle)\b/i, 20],
  // Monuments, viewpoints, towers: at least 15 min
  [/\b(monument|statue|viewpoint|belvedere|belv[eé]d[eè]re|mirador|tower|tour|torre)\b/i, 15],
];

/** Get the minimum meaningful duration for an activity based on its name/type */
export function getMinDuration(name: string, type: string): number {
  const text = `${name} ${type}`.toLowerCase();
  for (const [pattern, minDur] of MIN_DURATION_RULES) {
    if (pattern.test(text)) return minDur;
  }
  return 30; // Default minimum
}

/**
 * Classify an activity as outdoor, indoor, or unknown based on name/description keywords.
 * Also uses ActivityType as a secondary signal (nature/beach → outdoor, culture → indoor).
 */
export function classifyOutdoorIndoor(name: string, description?: string, activityType?: string): boolean | undefined {
  const text = `${name} ${description || ''} ${activityType || ''}`.toLowerCase();

  const isOutdoor = OUTDOOR_ACTIVITY_KEYWORDS.some(kw => text.includes(kw));
  const isIndoor = INDOOR_ACTIVITY_KEYWORDS.some(kw => text.includes(kw));

  // Both or neither → use activity type as tiebreaker
  if (isOutdoor && !isIndoor) return true;
  if (isIndoor && !isOutdoor) return false;
  if (isOutdoor && isIndoor) {
    // Conflict: "Jardin du musée" → prefer outdoor (it's partly outside)
    return true;
  }

  // Neither keyword matched → use broad ActivityType
  if (activityType) {
    const outdoorTypes = ['nature', 'beach', 'adventure'];
    const indoorTypes = ['culture', 'shopping', 'wellness', 'nightlife'];
    if (outdoorTypes.includes(activityType)) return true;
    if (indoorTypes.includes(activityType)) return false;
  }

  return undefined; // truly unknown
}
