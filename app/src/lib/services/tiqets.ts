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
  // Amsterdam (vérifié fév 2025)
  'van gogh museum': 'https://www.tiqets.com/en/van-gogh-museum-tickets-l144593/',
  'musée van gogh': 'https://www.tiqets.com/en/van-gogh-museum-tickets-l144593/',

  // Paris (vérifié fév 2025)
  'louvre': 'https://www.tiqets.com/en/louvre-museum-tickets-l124297/',
  'musée du louvre': 'https://www.tiqets.com/en/louvre-museum-tickets-l124297/',
  'tour eiffel': 'https://www.tiqets.com/en/eiffel-tower-tickets-l144586/',
  'eiffel tower': 'https://www.tiqets.com/en/eiffel-tower-tickets-l144586/',
  'musée d\'orsay': 'https://www.tiqets.com/en/musee-d-orsay-tickets-l141867/',
  'orsay': 'https://www.tiqets.com/en/musee-d-orsay-tickets-l141867/',
  'versailles': 'https://www.tiqets.com/en/palace-of-versailles-tickets-l141873/',
  'château de versailles': 'https://www.tiqets.com/en/palace-of-versailles-tickets-l141873/',

  // Barcelona (vérifié fév 2025)
  'sagrada familia': 'https://www.tiqets.com/en/sagrada-familia-tickets-l133161/',
  'park güell': 'https://www.tiqets.com/en/park-guell-tickets-l141902/',
  'parc güell': 'https://www.tiqets.com/en/park-guell-tickets-l141902/',
  'park guell': 'https://www.tiqets.com/en/park-guell-tickets-l141902/',
  'casa batlló': 'https://www.tiqets.com/en/casa-batllo-tickets-l141895/',
  'casa batllo': 'https://www.tiqets.com/en/casa-batllo-tickets-l141895/',

  // Rome (vérifié fév 2025)
  'colosseum': 'https://www.tiqets.com/en/colosseum-l145769/',
  'colisée': 'https://www.tiqets.com/en/colosseum-l145769/',
  'colosseo': 'https://www.tiqets.com/en/colosseum-l145769/',
  'vatican': 'https://www.tiqets.com/en/vatican-museums-tickets-l145158/',
  'chapelle sixtine': 'https://www.tiqets.com/en/vatican-museums-tickets-l145158/',
  'sistine': 'https://www.tiqets.com/en/vatican-museums-tickets-l145158/',
  'pantheon': 'https://www.tiqets.com/en/rome-pantheon-tickets-l142007/',
  'panthéon': 'https://www.tiqets.com/en/rome-pantheon-tickets-l142007/',

  // London (vérifié fév 2025)
  'tower of london': 'https://www.tiqets.com/en/tower-of-london-tickets-l124320/',
  'tour de londres': 'https://www.tiqets.com/en/tower-of-london-tickets-l124320/',
  'london eye': 'https://www.tiqets.com/en/london-eye-tickets-l133176/',
  'buckingham palace': 'https://www.tiqets.com/en/the-state-rooms-buckingham-palace-p975855/',
  'westminster abbey': 'https://www.tiqets.com/en/westminster-abbey-p976342/',
  "st paul's cathedral": 'https://www.tiqets.com/en/st-pauls-cathedral-p975047/',
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
