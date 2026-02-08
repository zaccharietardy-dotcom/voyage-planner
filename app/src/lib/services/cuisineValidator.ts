/**
 * Validation de la cohérence des cuisines par pays
 *
 * IMPORTANT: Voir /IMPORTANT_RULES.md - Règle 4
 * Privilégier la cuisine locale et éviter les cuisines incohérentes
 */

/**
 * Cuisines locales par pays/région
 * Ces cuisines sont PRIVILÉGIÉES lors de la sélection de restaurants
 */
export const LOCAL_CUISINES: Record<string, string[]> = {
  // Espagne
  Spain: [
    'spanish',
    'tapas',
    'catalan',
    'basque',
    'andalusian',
    'galician',
    'valencian',
    'paella',
    'mediterranean',
    'seafood',
    'mariscos',
    'pintxos',
    'espagnol',
    'espagnole',
  ],
  Barcelona: ['spanish', 'tapas', 'catalan', 'mediterranean', 'seafood', 'mariscos', 'espagnol'],
  Madrid: ['spanish', 'tapas', 'castilian', 'mediterranean', 'espagnol'],
  Sevilla: ['spanish', 'tapas', 'andalusian', 'mediterranean', 'espagnol'],
  Valencia: ['spanish', 'valencian', 'paella', 'mediterranean', 'seafood', 'mariscos', 'espagnol'],
  'San Sebastian': ['spanish', 'basque', 'pintxos', 'seafood', 'mariscos', 'espagnol'],

  // Italie
  Italy: [
    'italian',
    'pizza',
    'pasta',
    'risotto',
    'trattoria',
    'osteria',
    'roman',
    'tuscan',
    'neapolitan',
    'sicilian',
    'venetian',
    'mediterranean',
    'italien',
    'italienne',
  ],
  Rome: ['italian', 'roman', 'pizza', 'pasta', 'trattoria', 'mediterranean', 'italien'],
  Florence: ['italian', 'tuscan', 'pasta', 'bistecca', 'trattoria', 'italien'],
  Venice: ['italian', 'venetian', 'seafood', 'risotto', 'cicchetti', 'italien'],
  Naples: ['italian', 'neapolitan', 'pizza', 'pasta', 'seafood', 'italien'],
  Milan: ['italian', 'milanese', 'risotto', 'ossobuco', 'trattoria', 'italien'],

  // France
  France: [
    'french',
    'bistrot',
    'brasserie',
    'gastronomique',
    'provençal',
    'provencal',
    'alsacien',
    'breton',
    'lyonnais',
    'normand',
    'bourguignon',
    'mediterranean',
    'français',
    'française',
  ],
  Paris: ['french', 'bistrot', 'brasserie', 'gastronomique', 'français', 'française'],
  Lyon: ['french', 'lyonnais', 'bouchon', 'gastronomique', 'français'],
  Marseille: ['french', 'provençal', 'provencal', 'mediterranean', 'seafood', 'bouillabaisse', 'français'],
  Nice: ['french', 'niçois', 'provençal', 'mediterranean', 'français'],
  Bordeaux: ['french', 'bordelais', 'gastronomique', 'français'],

  // Portugal
  Portugal: [
    'portuguese',
    'bacalhau',
    'seafood',
    'petiscos',
    'francesinha',
    'pasteis',
    'mediterranean',
    'portugais',
    'portugaise',
  ],
  Lisbon: ['portuguese', 'bacalhau', 'seafood', 'petiscos', 'pasteis', 'portugais'],
  Porto: ['portuguese', 'francesinha', 'seafood', 'tripas', 'portugais'],

  // Allemagne
  Germany: [
    'german',
    'bavarian',
    'biergarten',
    'brauhaus',
    'schnitzel',
    'wurst',
    'currywurst',
    'allemand',
    'allemande',
  ],
  Berlin: ['german', 'currywurst', 'döner', 'biergarten', 'allemand'],
  Munich: ['german', 'bavarian', 'biergarten', 'brauhaus', 'weisswurst', 'allemand'],

  // Royaume-Uni
  'United Kingdom': ['british', 'pub', 'fish and chips', 'english', 'scottish', 'welsh', 'anglais', 'britannique'],
  London: ['british', 'pub', 'english', 'modern british', 'anglais', 'britannique'],

  // Grèce
  Greece: ['greek', 'mediterranean', 'taverna', 'mezze', 'souvlaki', 'moussaka', 'seafood', 'grec', 'grecque'],
  Athens: ['greek', 'taverna', 'mezze', 'souvlaki', 'mediterranean', 'grec'],
  Santorini: ['greek', 'seafood', 'mediterranean', 'taverna', 'grec'],
  Heraklion: ['greek', 'cretan', 'mediterranean', 'seafood', 'taverna', 'grec', 'crétois'],

  // Croatie
  Croatia: ['croatian', 'mediterranean', 'seafood', 'dalmatian', 'croate', 'adriatic'],
  Dubrovnik: ['croatian', 'mediterranean', 'seafood', 'dalmatian', 'croate'],
  Split: ['croatian', 'mediterranean', 'seafood', 'dalmatian', 'croate'],

  // Maroc
  Morocco: ['moroccan', 'marocain', 'tagine', 'couscous', 'pastilla', 'harira', 'mediterranean', 'north african'],
  Marrakech: ['moroccan', 'marocain', 'tagine', 'couscous', 'riad', 'north african'],

  // Malte
  Malta: ['maltese', 'mediterranean', 'seafood', 'rabbit', 'pastizzi', 'maltais'],

  // Turquie
  Turkey: ['turkish', 'turc', 'kebab', 'meze', 'pide', 'lahmacun', 'baklava', 'mediterranean'],
  Istanbul: ['turkish', 'turc', 'kebab', 'meze', 'pide', 'seafood', 'ottoman'],

  // Chypre
  Cyprus: ['cypriot', 'greek', 'mediterranean', 'meze', 'halloumi', 'seafood', 'chypriote'],

  // Pays-Bas
  Netherlands: ['dutch', 'indonesian', 'surinamese', 'hollandais', 'néerlandais'],
  Amsterdam: ['dutch', 'indonesian', 'surinamese', 'hollandais'],

  // Belgique
  Belgium: ['belgian', 'moules-frites', 'flemish', 'walloon', 'belge'],
  Brussels: ['belgian', 'moules-frites', 'flemish', 'belge'],

  // Japon
  Japan: ['japanese', 'sushi', 'ramen', 'izakaya', 'tempura', 'yakitori', 'kaiseki', 'japonais', 'japonaise'],
  Tokyo: ['japanese', 'sushi', 'ramen', 'izakaya', 'tempura', 'japonais'],
  Kyoto: ['japanese', 'kaiseki', 'traditional', 'matcha', 'japonais'],
};

/**
 * Cuisines à ÉVITER par pays/région
 * Ces cuisines sont considérées comme incohérentes avec la destination
 */
export const FORBIDDEN_CUISINES: Record<string, string[]> = {
  // En Espagne, éviter les cuisines non-locales
  Spain: ['chinese', 'chinois', 'china', 'asian', 'asiatique', 'wok', 'japanese', 'japonais', 'sushi', 'ramen', 'indian', 'indien', 'curry', 'american', 'americain', 'fast-food', 'fastfood', 'burger', 'thai', 'thaï', 'thailandais', 'vietnamese', 'vietnamien', 'korean', 'coreen'],
  Barcelona: ['chinese', 'chinois', 'china', 'asian', 'asiatique', 'wok', 'japanese', 'japonais', 'sushi', 'ramen', 'indian', 'indien', 'curry', 'american', 'americain', 'fast-food', 'fastfood', 'burger', 'thai', 'thaï', 'vietnamese', 'korean'],
  Madrid: ['chinese', 'chinois', 'china', 'asian', 'asiatique', 'wok', 'japanese', 'japonais', 'sushi', 'ramen', 'indian', 'indien', 'curry', 'american', 'americain', 'fast-food', 'fastfood', 'burger', 'thai', 'thaï', 'vietnamese', 'korean'],

  // En Italie, éviter les cuisines non-locales
  Italy: ['chinese', 'japanese', 'sushi', 'mexican', 'american', 'fast-food', 'indian', 'thai'],
  Rome: ['chinese', 'japanese', 'sushi', 'mexican', 'american', 'fast-food'],
  Florence: ['chinese', 'japanese', 'sushi', 'mexican', 'american', 'fast-food'],

  // En France, éviter sauf quartiers spécialisés
  France: ['american', 'fast-food', 'mexican'],
  Paris: ['american', 'fast-food'], // Paris a des quartiers asiatiques authentiques
  Lyon: ['american', 'fast-food', 'chinese', 'japanese'],

  // Au Portugal
  Portugal: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican'],

  // En Allemagne
  Germany: ['american', 'fast-food', 'mexican'],
  Munich: ['american', 'fast-food', 'mexican'],

  // Au Royaume-Uni (plus cosmopolite)
  'United Kingdom': ['fast-food'],
  London: [], // Londres est très cosmopolite

  // En Grèce
  Greece: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican'],

  // En Croatie
  Croatia: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican'],

  // Au Maroc
  Morocco: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican', 'korean'],

  // À Malte
  Malta: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican'],

  // En Turquie
  Turkey: ['chinese', 'japanese', 'sushi', 'american', 'fast-food', 'mexican'],

  // À Chypre
  Cyprus: ['chinese', 'japanese', 'sushi', 'indian', 'american', 'fast-food', 'mexican'],

  // Au Japon
  Japan: ['fast-food', 'american'],
};

/**
 * Normalise un nom de cuisine pour la comparaison
 */
function normalizeCuisine(cuisine: string): string {
  return cuisine
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]/g, ''); // Remove special chars
}

/**
 * Détermine le pays à partir de la destination
 */
export function getCountryFromDestination(destination: string): string | null {
  const dest = destination.toLowerCase();

  // Villes espagnoles
  if (['barcelona', 'madrid', 'sevilla', 'seville', 'valencia', 'malaga', 'bilbao', 'san sebastian'].some(city => dest.includes(city))) {
    return 'Spain';
  }

  // Villes italiennes
  if (['rome', 'roma', 'florence', 'firenze', 'venice', 'venezia', 'milan', 'milano', 'naples', 'napoli'].some(city => dest.includes(city))) {
    return 'Italy';
  }

  // Villes françaises
  if (['paris', 'lyon', 'marseille', 'nice', 'bordeaux', 'toulouse', 'lille', 'strasbourg'].some(city => dest.includes(city))) {
    return 'France';
  }

  // Villes portugaises
  if (['lisbon', 'lisboa', 'porto', 'faro', 'algarve'].some(city => dest.includes(city))) {
    return 'Portugal';
  }

  // Villes allemandes
  if (['berlin', 'munich', 'münchen', 'frankfurt', 'hamburg', 'cologne', 'köln'].some(city => dest.includes(city))) {
    return 'Germany';
  }

  // Villes britanniques
  if (['london', 'manchester', 'edinburgh', 'glasgow', 'liverpool', 'birmingham'].some(city => dest.includes(city))) {
    return 'United Kingdom';
  }

  // Villes grecques
  if (['athens', 'athenes', 'santorini', 'santorin', 'mykonos', 'crete', 'crète', 'heraklion', 'iraklion', 'chania', 'rethymno', 'thessaloniki', 'rhodes', 'corfu', 'corfou', 'zakynthos', 'kos', 'naxos', 'paros'].some(city => dest.includes(city))) {
    return 'Greece';
  }

  // Villes croates
  if (['dubrovnik', 'split', 'zagreb', 'hvar', 'pula', 'zadar'].some(city => dest.includes(city))) {
    return 'Croatia';
  }

  // Villes marocaines
  if (['marrakech', 'fes', 'fès', 'casablanca', 'rabat', 'tangier', 'tanger', 'chefchaouen', 'essaouira'].some(city => dest.includes(city))) {
    return 'Morocco';
  }

  // Malte
  if (['malta', 'malte', 'valletta', 'la valette'].some(city => dest.includes(city))) {
    return 'Malta';
  }

  // Villes turques
  if (['istanbul', 'antalya', 'cappadocia', 'bodrum', 'izmir'].some(city => dest.includes(city))) {
    return 'Turkey';
  }

  // Chypre
  if (['cyprus', 'chypre', 'larnaca', 'paphos', 'limassol', 'nicosia'].some(city => dest.includes(city))) {
    return 'Cyprus';
  }

  // Villes néerlandaises
  if (['amsterdam', 'rotterdam', 'hague', 'utrecht'].some(city => dest.includes(city))) {
    return 'Netherlands';
  }

  // Villes belges
  if (['brussels', 'bruxelles', 'bruges', 'brugge', 'antwerp', 'anvers', 'ghent', 'gand'].some(city => dest.includes(city))) {
    return 'Belgium';
  }

  // Villes japonaises
  if (['tokyo', 'kyoto', 'osaka', 'hiroshima', 'nara', 'yokohama'].some(city => dest.includes(city))) {
    return 'Japan';
  }

  return null;
}

/**
 * Vérifie si une cuisine est locale pour une destination
 */
export function isLocalCuisine(cuisineType: string, destination: string): boolean {
  const normalizedCuisine = normalizeCuisine(cuisineType);

  // Chercher d'abord par ville exacte, puis par pays
  const destKey = Object.keys(LOCAL_CUISINES).find(key =>
    destination.toLowerCase().includes(key.toLowerCase())
  );

  if (destKey && LOCAL_CUISINES[destKey]) {
    return LOCAL_CUISINES[destKey].some(local =>
      normalizeCuisine(local).includes(normalizedCuisine) ||
      normalizedCuisine.includes(normalizeCuisine(local))
    );
  }

  // Fallback sur le pays
  const country = getCountryFromDestination(destination);
  if (country && LOCAL_CUISINES[country]) {
    return LOCAL_CUISINES[country].some(local =>
      normalizeCuisine(local).includes(normalizedCuisine) ||
      normalizedCuisine.includes(normalizeCuisine(local))
    );
  }

  return false;
}

/**
 * Vérifie si une cuisine est interdite pour une destination
 */
export function isForbiddenCuisine(cuisineType: string, destination: string): boolean {
  const normalizedCuisine = normalizeCuisine(cuisineType);

  // Chercher d'abord par ville exacte, puis par pays
  const destKey = Object.keys(FORBIDDEN_CUISINES).find(key =>
    destination.toLowerCase().includes(key.toLowerCase())
  );

  if (destKey && FORBIDDEN_CUISINES[destKey]) {
    return FORBIDDEN_CUISINES[destKey].some(forbidden =>
      normalizeCuisine(forbidden).includes(normalizedCuisine) ||
      normalizedCuisine.includes(normalizeCuisine(forbidden))
    );
  }

  // Fallback sur le pays
  const country = getCountryFromDestination(destination);
  if (country && FORBIDDEN_CUISINES[country]) {
    return FORBIDDEN_CUISINES[country].some(forbidden =>
      normalizeCuisine(forbidden).includes(normalizedCuisine) ||
      normalizedCuisine.includes(normalizeCuisine(forbidden))
    );
  }

  return false;
}

/**
 * Valide un restaurant pour une destination
 * Retourne un score de validation:
 * - +20 si cuisine locale
 * - -50 si cuisine interdite
 * - 0 sinon
 */
export function validateRestaurantCuisine(
  cuisineTypes: string[],
  destination: string
): { isValid: boolean; score: number; reason?: string } {
  let totalScore = 0;
  let isLocal = false;
  let isForbidden = false;
  let localCuisine = '';
  let forbiddenCuisine = '';

  for (const cuisine of cuisineTypes) {
    if (isLocalCuisine(cuisine, destination)) {
      totalScore += 20;
      isLocal = true;
      localCuisine = cuisine;
    }

    if (isForbiddenCuisine(cuisine, destination)) {
      totalScore -= 50;
      isForbidden = true;
      forbiddenCuisine = cuisine;
    }
  }

  if (isForbidden) {
    return {
      isValid: false,
      score: totalScore,
      reason: `Cuisine "${forbiddenCuisine}" non recommandée à ${destination}`,
    };
  }

  if (isLocal) {
    return {
      isValid: true,
      score: totalScore,
      reason: `Cuisine locale "${localCuisine}" recommandée`,
    };
  }

  return {
    isValid: true,
    score: 0,
  };
}

/**
 * Filtre une liste de restaurants pour ne garder que les cuisines appropriées
 */
export function filterRestaurantsByCuisine<T extends { cuisineTypes: string[] }>(
  restaurants: T[],
  destination: string,
  options: {
    allowNonLocal?: boolean; // Autoriser les cuisines non-locales (défaut: true)
    strictMode?: boolean; // Mode strict: exclure les cuisines interdites (défaut: true)
  } = {}
): T[] {
  const { allowNonLocal = true, strictMode = true } = options;

  return restaurants.filter(restaurant => {
    const validation = validateRestaurantCuisine(restaurant.cuisineTypes, destination);

    // En mode strict, exclure les restaurants avec cuisine interdite
    if (strictMode && !validation.isValid) {
      return false;
    }

    // Si on n'autorise pas les non-locales, exclure
    if (!allowNonLocal && validation.score <= 0) {
      return false;
    }

    return true;
  });
}
