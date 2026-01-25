/**
 * Système de scoring des vols (Bug #7)
 *
 * Pénalise les vols retour très tôt le matin qui gaspillent la dernière nuit d'hôtel.
 *
 * Règles de scoring:
 * - Score de base: 100
 * - Vol retour < 08:00: -30 points (gaspille la nuit d'hôtel)
 * - Vol retour 08:00-10:00: -10 points (un peu tôt)
 * - Vol retour 14:00-19:00: +10 points (temps optimal)
 * - Vol aller tôt le matin: pas de pénalité (plus de temps à destination)
 */

/**
 * Pénalité pour vol retour très tôt (< 08:00)
 * Ces vols gaspillent la dernière nuit d'hôtel
 */
export const EARLY_MORNING_PENALTY = 30;

/**
 * Pénalité pour vol retour tôt (08:00-10:00)
 * Ces vols sont inconfortables mais ne gaspillent pas complètement la nuit
 */
export const EARLY_PENALTY = 10;

/**
 * Bonus pour vol à heure optimale (14:00-19:00)
 * Permet de profiter de la journée avant de partir
 */
export const OPTIMAL_TIME_BONUS = 10;

/**
 * Interface minimale pour un vol
 */
export interface FlightForScoring {
  id: string;
  departureTime: string; // Format "HH:MM"
  type: 'outbound' | 'return';
  price: number;
}

/**
 * Résultat du scoring avec vol et score
 */
export interface ScoredFlight {
  flight: FlightForScoring;
  score: number;
  warning?: string;
}

/**
 * Parse l'heure d'un string "HH:MM" en nombre
 */
function parseHour(timeStr: string): number {
  const [hoursStr] = timeStr.split(':');
  return parseInt(hoursStr, 10);
}

/**
 * Calcule le score d'un vol basé sur son horaire
 *
 * Score de base: 100
 * - Vol retour < 08:00: -30 (EARLY_MORNING_PENALTY)
 * - Vol retour 08:00-10:00: -10 (EARLY_PENALTY)
 * - Vol retour 14:00-19:00: +10 (OPTIMAL_TIME_BONUS)
 * - Vol aller: pas de pénalité pour les heures matinales
 *
 * @param flight Vol à évaluer
 * @returns Score (0-110+)
 */
export function calculateFlightScore(flight: FlightForScoring): number {
  let score = 100;
  const hour = parseHour(flight.departureTime);

  if (flight.type === 'return') {
    // Vol retour: pénaliser les heures très tôt
    if (hour < 8) {
      // 00:00-07:59: grosse pénalité (gaspille la nuit d'hôtel)
      score -= EARLY_MORNING_PENALTY;
    } else if (hour < 10) {
      // 08:00-09:59: petite pénalité (un peu tôt)
      score -= EARLY_PENALTY;
    } else if (hour >= 14 && hour <= 19) {
      // 14:00-19:59: bonus (heure optimale, profite de la journée)
      score += OPTIMAL_TIME_BONUS;
    }
  } else {
    // Vol aller: pas de pénalité pour les heures matinales
    // Au contraire, un vol tôt le matin permet d'avoir plus de temps à destination
    if (hour >= 6 && hour <= 10) {
      // Léger bonus pour vol aller matinal
      score += 5;
    }
  }

  return score;
}

/**
 * Score une liste de vols et les trie par score décroissant
 *
 * @param flights Liste de vols à évaluer
 * @returns Liste triée par score (meilleur en premier)
 */
export function scoreFlights(flights: FlightForScoring[]): ScoredFlight[] {
  const scored = flights.map(flight => {
    const score = calculateFlightScore(flight);
    const hour = parseHour(flight.departureTime);

    let warning: string | undefined;
    if (flight.type === 'return' && hour < 8) {
      warning = `Early return flight (${flight.departureTime}) wastes hotel night`;
    }

    return { flight, score, warning };
  });

  // Trier par score décroissant
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Sélectionne le meilleur vol en tenant compte du score et du prix
 *
 * Utilise une formule combinée:
 * - 70% score horaire
 * - 30% prix (inversé: moins cher = mieux)
 *
 * @param flights Liste de vols
 * @returns Meilleur vol ou null si liste vide
 */
export function selectBestFlight(flights: FlightForScoring[]): FlightForScoring | null {
  if (flights.length === 0) {
    return null;
  }

  // Trouver les bornes de prix pour normalisation
  const prices = flights.map(f => f.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1; // Éviter division par 0

  // Calculer score combiné pour chaque vol
  const withCombinedScore = flights.map(flight => {
    const timeScore = calculateFlightScore(flight);

    // Normaliser le prix (0-100, où 100 = moins cher)
    const priceScore = 100 - ((flight.price - minPrice) / priceRange) * 100;

    // Score combiné: 70% temps + 30% prix
    const combinedScore = timeScore * 0.7 + priceScore * 0.3;

    return { flight, combinedScore, timeScore };
  });

  // Trier par score combiné décroissant
  withCombinedScore.sort((a, b) => b.combinedScore - a.combinedScore);

  return withCombinedScore[0].flight;
}

/**
 * Vérifie si un vol est à éviter (heure très mauvaise)
 */
export function isFlightToAvoid(flight: FlightForScoring): boolean {
  if (flight.type !== 'return') {
    return false;
  }

  const hour = parseHour(flight.departureTime);
  return hour < 8;
}

/**
 * Génère un avertissement pour un vol problématique
 */
export function getFlightWarning(flight: FlightForScoring): string | null {
  if (flight.type !== 'return') {
    return null;
  }

  const hour = parseHour(flight.departureTime);

  if (hour < 6) {
    return `Vol retour très tôt (${flight.departureTime}) - Vous perdez la dernière nuit d'hôtel. Envisagez un vol plus tard.`;
  }

  if (hour < 8) {
    return `Vol retour tôt (${flight.departureTime}) - Vous devrez quitter l'hôtel très tôt. Un vol après 10h serait préférable.`;
  }

  return null;
}
