/**
 * Service Tiqets - Alternative aux billets Viator
 *
 * Tiqets est une plateforme de billetterie pour musées et attractions.
 * Utilisé comme alternative/complément à Viator pour les musées.
 *
 * Note: Pas d'API publique, on génère des liens de recherche avec le lien affilié.
 */

// Affiliate link provided by user
const TIQETS_AFFILIATE_URL = 'https://tiqets.tpo.lu/EUpHIuJt';

/**
 * Builds a Tiqets search URL for an attraction
 * This is a fallback when Viator doesn't find a match
 */
export function buildTiqetsSearchUrl(attractionName: string, destination: string): string {
  const searchQuery = `${attractionName} ${destination}`.trim();
  return `https://www.tiqets.com/en/search?query=${encodeURIComponent(searchQuery)}`;
}

/**
 * Returns the affiliate URL for Tiqets
 * Use this to track conversions
 */
export function getTiqetsAffiliateUrl(): string {
  return TIQETS_AFFILIATE_URL;
}

/**
 * Check if an attraction is likely to be on Tiqets
 * (museums, attractions with tickets)
 */
export function isTiqetsRelevant(attractionName: string, attractionType: string): boolean {
  // Tiqets is best for museums and ticketed attractions
  const tiqetsKeywords = [
    'musée', 'museum', 'galerie', 'gallery', 'palais', 'palace',
    'château', 'castle', 'tower', 'tour', 'monument', 'zoo',
    'aquarium', 'parc', 'park', 'jardin', 'garden', 'basilica',
    'cathédrale', 'cathedral', 'église', 'church', 'opéra', 'opera',
    'théâtre', 'theater', 'arena', 'stade', 'stadium', 'observation',
  ];

  const nameLower = attractionName.toLowerCase();
  const typeMatches = attractionType === 'culture' || attractionType === 'nature';
  const keywordMatches = tiqetsKeywords.some(kw => nameLower.includes(kw));

  return typeMatches || keywordMatches;
}

/**
 * Try to find a Tiqets product for an attraction
 * Returns a search URL as we don't have API access
 */
export async function findTiqetsProduct(
  attractionName: string,
  destination: string,
): Promise<{ url: string; price: number; title: string } | null> {
  // Check if this attraction is relevant for Tiqets
  if (!isTiqetsRelevant(attractionName, 'culture')) {
    return null;
  }

  // Build search URL
  const searchUrl = buildTiqetsSearchUrl(attractionName, destination);

  console.log(`[Tiqets] Lien recherche: "${attractionName}" → ${searchUrl}`);

  return {
    url: searchUrl,
    price: 0, // Unknown without API
    title: attractionName,
  };
}

/**
 * Known Tiqets direct links for popular attractions
 * These are hand-curated for better UX
 */
const KNOWN_TIQETS_LINKS: Record<string, string> = {
  // Amsterdam
  'rijksmuseum': 'https://www.tiqets.com/en/amsterdam-attractions-c75227/tickets-for-rijksmuseum-p974100',
  'van gogh museum': 'https://www.tiqets.com/en/amsterdam-attractions-c75227/tickets-for-van-gogh-museum-p974097',
  'anne frank': 'https://www.tiqets.com/en/amsterdam-attractions-c75227/tickets-for-anne-frank-house-p974096',

  // Paris
  'louvre': 'https://www.tiqets.com/en/paris-attractions-c75270/tickets-for-louvre-museum-p974113',
  'tour eiffel': 'https://www.tiqets.com/en/paris-attractions-c75270/tickets-for-eiffel-tower-p974110',
  'musée d\'orsay': 'https://www.tiqets.com/en/paris-attractions-c75270/tickets-for-musee-d-orsay-p974116',
  'versailles': 'https://www.tiqets.com/en/paris-attractions-c75270/tickets-for-palace-of-versailles-p974118',

  // Barcelona
  'sagrada familia': 'https://www.tiqets.com/en/barcelona-attractions-c75229/tickets-for-sagrada-familia-p974080',
  'park guell': 'https://www.tiqets.com/en/barcelona-attractions-c75229/tickets-for-park-guell-p974082',
  'casa batllo': 'https://www.tiqets.com/en/barcelona-attractions-c75229/tickets-for-casa-batllo-p974078',

  // Rome
  'colosseum': 'https://www.tiqets.com/en/rome-attractions-c75280/tickets-for-colosseum-p974126',
  'colisée': 'https://www.tiqets.com/en/rome-attractions-c75280/tickets-for-colosseum-p974126',
  'vatican': 'https://www.tiqets.com/en/rome-attractions-c75280/tickets-for-vatican-museums-sistine-chapel-p974128',
  'chapelle sixtine': 'https://www.tiqets.com/en/rome-attractions-c75280/tickets-for-vatican-museums-sistine-chapel-p974128',

  // London
  'tower of london': 'https://www.tiqets.com/en/london-attractions-c75260/tickets-for-tower-of-london-p974105',
  'london eye': 'https://www.tiqets.com/en/london-attractions-c75260/tickets-for-london-eye-p974103',
  'buckingham palace': 'https://www.tiqets.com/en/london-attractions-c75260/tickets-for-buckingham-palace-p974101',
};

/**
 * Get a direct Tiqets link if we have one for this attraction
 */
export function getKnownTiqetsLink(attractionName: string): string | null {
  const nameLower = attractionName.toLowerCase();

  for (const [key, url] of Object.entries(KNOWN_TIQETS_LINKS)) {
    if (nameLower.includes(key)) {
      return url;
    }
  }

  return null;
}
