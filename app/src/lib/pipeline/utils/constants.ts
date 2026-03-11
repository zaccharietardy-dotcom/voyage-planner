/**
 * Shared constants for Pipeline V2/V3.
 * Single source of truth for keyword lists used across multiple pipeline steps.
 */

// ============================================
// Meal & Schedule Timing
// ============================================

export const BREAKFAST_DURATION_MIN = 45;
export const LUNCH_DURATION_MIN = 75;
export const DINNER_DURATION_MIN = 90;
export const ACTIVITY_BUFFER_MIN = 10;
export const FULL_DAY_THRESHOLD_MIN = 240;

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
  // Theme parks: full-day experiences
  [/\b(disneyland|disney\s?sea|disney\s?world|universal\s?studios|universal\s?resort|legoland|europa[- ]?park|port\s?aventura|six\s?flags|fuji[- ]?q|everland|lotte\s?world)\b/i, 300],
  // Immersive/digital art experiences
  [/\b(teamlab|team\s?lab|atelier\s+des\s+lumi[eè]res|bassins?\s+de\s+lumi[eè]res|art[eé]chouse|mori\s+building\s+digital)\b/i, 90],
  // Major observation decks / towers with observation
  [/\b(skytree|sky\s?tree|shibuya\s?sky|tokyo\s?tower|burj\s?khalifa|cn\s?tower|empire\s?state|one\s?world\s?observatory|top\s?of\s?the\s?rock|shard|eiffel|montparnasse|edge\s?observation)\b/i, 60],
  // Major museums and landmark complexes: realistic minimum visit windows
  [/\b(vatican|vaticano|mus[eé]es? du vatican|vatican museum|chapelle sixtine|sistine)\b/i, 180],
  [/\b(louvre|mus[eé]e du louvre)\b/i, 150],
  [/\b(british museum|uffizi|offices|galerie des offices|prado|museo del prado|rijksmuseum|hermitage|ermitage|met museum|metropolitan)\b/i, 120],
  [/\b(mus[eé]e d'orsay|orsay|colosseum|colosseo|colis[eé]e|coliseum)\b/i, 90],
  // Major museums, cathedrals, basilicas: at least 60 min
  [/\b(museum|mus[eé][eo]|gallery|galerie|galleria|cathedral|cath[eé]drale|basilica|basilique)\b/i, 60],
  // Palaces, castles, forts: at least 45 min
  [/\b(palace|palais|palazzo|castle|ch[aâ]teau|fort|fortress|forteresse)\b/i, 45],
  // Generic amusement/attraction parks: minimum 180min
  [/\b(amusement[_ ]park|parc\s+d.attraction|theme\s*park)\b/i, 180],
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
 * Maximum reasonable durations for quick activities (minutes).
 * Prevents LLM from assigning 60min to a statue or fountain.
 * Applied AFTER min-duration; only caps activities matching these patterns.
 */
const MAX_DURATION_RULES: [RegExp, number][] = [
  // Famous arches and gates: larger landmarks deserve more time
  [/\b(arc\s+de\s+triomphe|arco\s+d[ie]\s+triun?fo|brandenburg|brandenburger|india\s?gate|gateway\s+of\s+india|puerta\s+del?\s+sol)\b/i, 60],
  // Observation towers and decks: 60-90min max (includes ascent + view + descent)
  [/\b(eiffel|skytree|sky\s?tree|tokyo\s?tower|cn\s?tower|empire\s?state|burj\s?khalifa|montparnasse|shard|one\s?world\s?observatory|top\s?of\s?the\s?rock|edge\s?observation|shibuya\s?sky)\b/i, 90],
  // Generic towers (non-observation): 45min
  [/\b(tower|tour|torre)\b/i, 45],
  // Cathedrals: slightly longer than churches (75min)
  [/\b(cathedral|cath[eé]drale|duomo|dom)\b/i, 75],
  // Basilicas, churches: 60min max
  [/\b(basilica|basilique|sacr[eé][\s-]?c(?:oeur|œur)|church|[eé]glise|chiesa|chapel|chapelle)\b/i, 60],
  // Generic museums/galleries: 150min cap (major ones have higher min, but never 3h for small ones)
  [/\b(museum|mus[eé][eo]|gallery|galerie|galleria)\b/i, 150],
  // Palaces, castles: 120min cap
  [/\b(palace|palais|palazzo|castle|ch[aâ]teau)\b/i, 120],
  // Amusement/attraction parks: no aggressive cap
  [/\b(amusement[_ ]park|parc\s+d.attraction|theme\s*park)\b/i, 300],
  // Parks, gardens: 90min cap
  [/\b(park|parc|garden|jardin|botanical|botanique)\b/i, 90],
  // Generic monuments/statues: quick visits
  [/\b(statue|sculpture|fountain|fontaine|fontana|monument|memorial|m[eé]morial)\b/i, 30],
  [/\b(viewpoint|belvedere|belv[eé]d[eè]re|mirador|panorama)\b/i, 45],
];

/** Cap duration for quick activities. Returns null if no cap applies. */
export function getMaxDuration(name: string, type: string): number | null {
  const text = `${name} ${type}`.toLowerCase();
  for (const [pattern, maxDur] of MAX_DURATION_RULES) {
    if (pattern.test(text)) return maxDur;
  }
  return null;
}

/**
 * Estimate a reasonable entrance cost (EUR) for activities where APIs return 0.
 * These are FALLBACK values — only used when the real cost is unknown (0 or undefined).
 * Not meant to be exact, but to give a rough order of magnitude so the
 * budget summary isn't wildly off (e.g. Disneyland showing as "free").
 *
 * Returns 0 for genuinely free activities (parks, statues, churches).
 * Patterns tested against `${name} ${type}` (lowercase). First match wins.
 */
const COST_ESTIMATION_RULES: [RegExp, number][] = [
  // Theme parks: ~80 EUR entry
  [/\b(disneyland|disney\s?sea|disney\s?world|universal\s?studios|universal\s?resort|legoland|europa[- ]?park|port\s?aventura|six\s?flags|fuji[- ]?q|everland|lotte\s?world)\b/i, 80],
  // Immersive / digital art
  [/\b(teamlab|team\s?lab|atelier\s+des\s+lumi[eè]res|bassins?\s+de\s+lumi[eè]res|art[eé]chouse|mori\s+building\s+digital)\b/i, 25],
  // Named major museums
  [/\b(louvre|vatican|vaticano|uffizi|offices|prado|rijksmuseum|hermitage|ermitage|british museum|met museum|metropolitan|mus[eé]e d'orsay|orsay)\b/i, 20],
  // Observation decks
  [/\b(skytree|sky\s?tree|shibuya\s?sky|tokyo\s?tower|burj\s?khalifa|cn\s?tower|empire\s?state|one\s?world\s?observatory|top\s?of\s?the\s?rock|shard|eiffel|montparnasse|edge\s?observation)\b/i, 18],
  // Generic museums, galleries
  [/\b(museum|mus[eé][eo]|gallery|galerie|galleria)\b/i, 12],
  // Palaces, castles, historical sites
  [/\b(palace|palais|palazzo|castle|ch[aâ]teau|fort|fortress|forteresse|colosseum|colosseo|colis[eé]e)\b/i, 10],
  // Aquariums, zoos, planetariums
  [/\b(aquarium|zoo|planetarium)\b/i, 15],
  // Cathedrals (often have paid entry in some countries)
  [/\b(cathedral|cath[eé]drale|basilica|basilique)\b/i, 5],
  // Free activities: parks, churches, statues, viewpoints, squares
  [/\b(park|parc|garden|jardin|church|[eé]glise|chiesa|mosque|mosqu[eé]e|temple|synagogue|chapel|chapelle|statue|monument|memorial|viewpoint|belvedere|square|place|plaza|piazza|promenade|beach|plage|cemetery|cimeti[eè]re|trail|sentier)\b/i, 0],
];

/**
 * Estimate entrance cost for an activity based on its name/type.
 * ONLY used as fallback when the real cost is 0 or undefined.
 */
export function estimateActivityCost(name: string, type?: string): number {
  const text = `${name} ${type || ''}`.toLowerCase();
  for (const [pattern, cost] of COST_ESTIMATION_RULES) {
    if (pattern.test(text)) return cost;
  }
  return 0; // Default: assume free
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
