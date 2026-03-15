/**
 * quality-rules.ts — Source unique des codes qualité et seuils
 *
 * Partagé entre :
 *   - step11-contracts.ts (validation inline pipeline)
 *   - analyzers/ (analyse post-run)
 *   - run-campaign.ts (gates de campagne)
 *
 * Convention de nommage : SECTION_DESCRIPTION
 *   Sections: GEO, SCHED, LINK, DATA, RHYTHM, RELEV, REAL, BUDGET
 */

// ============================================
// Geo codes — geography analyzer + contracts
// ============================================

export const GEO_CODES = {
  /** Transition impossible : grande distance, pas assez de temps entre items */
  IMPOSSIBLE_TRANSITION: 'GEO_IMPOSSIBLE_TRANSITION',
  /** Segment urbain > hardKm sans temps suffisant */
  URBAN_HARD_LONG_LEG: 'GEO_URBAN_HARD_LONG_LEG',
  /** Trop de segments > targetKm en ville (max 1) */
  URBAN_TOO_MANY_LONG_LEGS: 'GEO_URBAN_TOO_MANY_LONG_LEGS',
  /** Segment > 20km (warning) */
  VERY_LONG_DAY_LEG: 'GEO_VERY_LONG_DAY_LEG',
  /** Segment long mais faisable (info) */
  LONG_LEG_OK: 'GEO_LONG_LEG_OK',
  /** Zigzag intra-journée */
  INTRA_DAY_ZIGZAG: 'GEO_INTRA_DAY_ZIGZAG',
  /** Efficacité de route faible (vs MST) */
  DAY_ROUTE_EFFICIENCY_LOW: 'GEO_DAY_ROUTE_EFFICIENCY_LOW',
  /** Outlier géo intra-journée */
  DAY_OUTLIER: 'GEO_DAY_OUTLIER',
  /** Majorité coords générées (vs verified) */
  DATA_RELIABILITY_LOW: 'GEO_DATA_RELIABILITY_LOW',
} as const;

export type GeoCode = typeof GEO_CODES[keyof typeof GEO_CODES];

// ============================================
// Geo thresholds — partagés analyzers + planner
// ============================================

export const GEO_THRESHOLDS = {
  /** Distance cible max pour un segment urbain (km) */
  urbanLongLegTargetKm: 2.5,
  /** Distance hard max pour un segment urbain sans temps suffisant (km) */
  urbanLongLegHardKm: 4,
  /** Distance min pour considérer un outlier intra-journée (km) */
  outlierMinThresholdKm: 3,
  /** Ratio route/MST au-dessus duquel on signale inefficacité */
  routeInefficiencyWarningRatio: 1.75,
  /** Nombre de demi-tours pour déclencher un warning zigzag */
  zigzagWarningThreshold: 2,
  /** Distance max entre items consécutifs pour avertir (km) */
  veryLongDayLegKm: 20,
  /** Distance min pour vérifier faisabilité temporelle (km) */
  impossibleTransitionMinKm: 5,
} as const;

// ============================================
// Contract thresholds — step11 inline validation
// ============================================

export const CONTRACT_THRESHOLDS = {
  /** Distance max restaurant → activité la plus proche (km) — P0.2 */
  restaurantMaxDistanceKm: 1.5,
  /** Distance max POI depuis destination (km) — P0.6 */
  crossCountryMaxKm: 100,
  /** Tolérance durée min/max (%) — P0.7 */
  durationTolerancePercent: 0.2,
} as const;

// ============================================
// Link codes
// ============================================

export const LINK_CODES = {
  API_KEY_LEAK: 'LINK_API_KEY_LEAK',
  HOTEL_MISSING: 'LINK_HOTEL_MISSING',
  OUTBOUND_MISSING: 'LINK_OUTBOUND_MISSING',
  OUTBOUND_INVALID: 'LINK_OUTBOUND_INVALID',
  RETURN_MISSING: 'LINK_RETURN_MISSING',
  RETURN_INVALID: 'LINK_RETURN_INVALID',
  ACTIVITY_NONE: 'LINK_ACTIVITY_NONE',
  RESTAURANT_MAPS_MISSING: 'LINK_RESTAURANT_MAPS_MISSING',
  ITEM_INVALID: 'LINK_ITEM_INVALID',
  TRANSPORT_DATE_MISMATCH: 'LINK_TRANSPORT_DATE_MISMATCH',
} as const;

// ============================================
// Data quality codes
// ============================================

export const DATA_CODES = {
  HOTEL_BOUNDARY_INCOHERENT: 'DATA_HOTEL_BOUNDARY_INCOHERENT',
  GENERIC_ACTIVITY: 'DATA_GENERIC_ACTIVITY',
  ACTIVITY_DESCRIPTION_MISSING: 'DATA_ACTIVITY_DESCRIPTION_MISSING',
  DAY_THEME_MISSING: 'DATA_DAY_THEME_MISSING',
  ACTIVITY_DUPLICATE: 'DATA_ACTIVITY_DUPLICATE',
  DAY_COUNT_MISMATCH: 'DATA_DAY_COUNT_MISMATCH',
  TRANSPORT_MODE_MISSING: 'DATA_TRANSPORT_MODE_MISSING',
  TRANSPORT_MODE_TITLE_MISMATCH: 'DATA_TRANSPORT_MODE_TITLE_MISMATCH',
  TRANSPORT_MODE_LEGS_MISMATCH: 'DATA_TRANSPORT_MODE_LEGS_MISMATCH',
} as const;

// ============================================
// Campaign gates — Phase 0 base gates
// ============================================

export interface CampaignGateResult {
  name: string;
  pass: boolean;
  value: number;
  target: number;
  detail?: string;
}

/**
 * Codes considérés comme "hard gates" — zéro tolérance.
 * Si un seul de ces codes apparaît, la campagne échoue.
 */
export const HARD_GATE_CODES = [
  GEO_CODES.IMPOSSIBLE_TRANSITION,
  GEO_CODES.URBAN_HARD_LONG_LEG,
] as const;

/**
 * Scénarios prioritaires pour la détection de régression.
 * Régression = baisse de analysisScore > 2 sur un de ces scénarios.
 */
export const PRIORITY_GOLDEN_SCENARIOS = [
  'naples-pompei-3d',
  'paris-rome-4d',
  'tokyo-fuji-7d',
  'must-see-heavy',
] as const;

/**
 * Scénarios utilisés pour le smoke test live (réseau requis).
 */
export const SMOKE_SCENARIOS = [
  'naples-pompei-3d',
  'paris-rome-4d',
  'tokyo-fuji-7d',
  'must-see-heavy',
] as const;
