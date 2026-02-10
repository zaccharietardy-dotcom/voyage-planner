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
