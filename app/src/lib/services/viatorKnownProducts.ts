/**
 * Données Viator connues pour les attractions majeures
 *
 * Ces entrées fournissent:
 * - Des prix indicatifs (pour l'estimation budgétaire)
 * - Des durées de visite réalistes (source: Viator, TripAdvisor, données terrain)
 * - Des liens de recherche Viator fiables (pas des URLs de produits inventés)
 *
 * Les URLs utilisent le format /searchResults/all?text=... qui montre
 * toujours des résultats pertinents, contrairement aux URLs de produits
 * qui peuvent 404 si le code produit change.
 *
 * Format: { 'keyword': { city, price, duration, searchTerms } }
 * Les keywords sont en minuscules pour faciliter le matching.
 */

interface KnownViatorEntry {
  city: string;
  price?: number;
  duration?: number; // Durée de visite en minutes (source: Viator / données terrain)
  searchTerms: string; // What to search on Viator
}

export const KNOWN_VIATOR_PRODUCTS: Record<string, KnownViatorEntry> = {
  // ===== NEW YORK =====
  'statue of liberty': {
    city: 'New York',
    price: 65,
    duration: 240, // Ferry + île + musée
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'statue de la liberté': {
    city: 'New York',
    price: 65,
    duration: 240,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'ellis island': {
    city: 'New York',
    price: 65,
    duration: 240,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'empire state building': {
    city: 'New York',
    price: 47,
    duration: 60, // Observation deck
    searchTerms: 'Empire State Building Tickets',
  },
  'top of the rock': {
    city: 'New York',
    price: 43,
    duration: 45,
    searchTerms: 'Top of the Rock Observation Deck',
  },
  '9/11 memorial': {
    city: 'New York',
    price: 33,
    duration: 120, // Musée + mémorial
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'mémorial du 11 septembre': {
    city: 'New York',
    price: 33,
    duration: 120,
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'one world observatory': {
    city: 'New York',
    price: 43,
    duration: 60,
    searchTerms: 'One World Observatory Ticket',
  },
  'metropolitan museum': {
    city: 'New York',
    price: 30,
    duration: 180, // Grand musée
    searchTerms: 'Metropolitan Museum of Art Admission',
  },
  'met museum': {
    city: 'New York',
    price: 30,
    duration: 180,
    searchTerms: 'Metropolitan Museum of Art Admission',
  },
  'central park': {
    city: 'New York',
    price: 35,
    duration: 90, // Walking tour
    searchTerms: 'Central Park Walking Tour',
  },
  'high line': {
    city: 'New York',
    price: 39,
    duration: 75, // Walking tour
    searchTerms: 'High Line Chelsea Walking Tour',
  },
  'brooklyn bridge': {
    city: 'New York',
    price: 35,
    duration: 90, // Walking tour
    searchTerms: 'Brooklyn Bridge DUMBO Walking Tour',
  },
  'guggenheim': {
    city: 'New York',
    price: 25,
    duration: 120,
    searchTerms: 'Guggenheim Museum Admission',
  },
  'moma': {
    city: 'New York',
    price: 25,
    duration: 120,
    searchTerms: 'Museum of Modern Art MoMA Admission',
  },
  'museum of modern art': {
    city: 'New York',
    price: 25,
    duration: 120,
    searchTerms: 'Museum of Modern Art MoMA Admission',
  },

  // ===== PARIS =====
  'tour eiffel': {
    city: 'Paris',
    price: 65,
    duration: 90, // Montée + vue
    searchTerms: 'Eiffel Tower Skip the Line Tour',
  },
  'eiffel tower': {
    city: 'Paris',
    price: 65,
    duration: 90,
    searchTerms: 'Eiffel Tower Skip the Line Tour',
  },
  'louvre': {
    city: 'Paris',
    price: 59,
    duration: 150, // Grand musée
    searchTerms: 'Louvre Museum Skip the Line Guided Tour',
  },
  'musée du louvre': {
    city: 'Paris',
    price: 59,
    duration: 150,
    searchTerms: 'Louvre Museum Skip the Line Guided Tour',
  },
  'versailles': {
    city: 'Paris',
    price: 89,
    duration: 240, // Château + jardins (day trip)
    searchTerms: 'Versailles Palace Skip the Line',
  },
  'château de versailles': {
    city: 'Paris',
    price: 89,
    duration: 240,
    searchTerms: 'Versailles Palace Skip the Line',
  },
  "arc de triomphe": {
    city: 'Paris',
    price: 16,
    duration: 45, // Montée + vue panoramique
    searchTerms: 'Arc de Triomphe Skip the Line Ticket',
  },
  'notre dame': {
    city: 'Paris',
    price: 29,
    duration: 60, // Walking tour île
    searchTerms: 'Notre Dame Island Walking Tour',
  },
  'notre-dame': {
    city: 'Paris',
    price: 29,
    duration: 60,
    searchTerms: 'Notre Dame Island Walking Tour',
  },
  'sacré-coeur': {
    city: 'Paris',
    price: 35,
    duration: 90, // Walking tour Montmartre
    searchTerms: 'Montmartre Walking Tour Sacre Coeur',
  },
  'montmartre': {
    city: 'Paris',
    price: 35,
    duration: 90,
    searchTerms: 'Montmartre Walking Tour Sacre Coeur',
  },
  "musée d'orsay": {
    city: 'Paris',
    price: 16,
    duration: 120, // Musée moyen-grand
    searchTerms: 'Musee d Orsay Skip the Line Ticket',
  },
  'orsay museum': {
    city: 'Paris',
    price: 16,
    duration: 120,
    searchTerms: 'Musee d Orsay Skip the Line Ticket',
  },

  // ===== ROME =====
  'colosseum': {
    city: 'Rome',
    price: 59,
    duration: 90, // Visite intérieure
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colisée': {
    city: 'Rome',
    price: 59,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colosseo': {
    city: 'Rome',
    price: 59,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'vatican': {
    city: 'Rome',
    price: 69,
    duration: 180, // Musées + Sixtine + Basilique
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'vatican museums': {
    city: 'Rome',
    price: 69,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'musées du vatican': {
    city: 'Rome',
    price: 69,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'sistine chapel': {
    city: 'Rome',
    price: 69,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'chapelle sixtine': {
    city: 'Rome',
    price: 69,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'roman forum': {
    city: 'Rome',
    price: 59,
    duration: 90, // Inclus avec Colisée
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'forum romain': {
    city: 'Rome',
    price: 59,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'pantheon': {
    city: 'Rome',
    price: 25,
    duration: 45, // Visite intérieure rapide
    searchTerms: 'Pantheon Guided Tour Rome',
  },
  'trevi fountain': {
    city: 'Rome',
    price: 39,
    duration: 30, // Photo + visite rapide
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },
  'fontaine de trevi': {
    city: 'Rome',
    price: 39,
    duration: 30,
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },

  // ===== BARCELONA =====
  'sagrada familia': {
    city: 'Barcelona',
    price: 47,
    duration: 90, // Intérieur + tours
    searchTerms: 'Sagrada Familia Skip the Line Tour',
  },
  'park güell': {
    city: 'Barcelona',
    price: 35,
    duration: 75, // Zone monumentale
    searchTerms: 'Park Guell Skip the Line Guided Tour',
  },
  'parc güell': {
    city: 'Barcelona',
    price: 35,
    duration: 75,
    searchTerms: 'Park Guell Skip the Line Guided Tour',
  },
  'casa batlló': {
    city: 'Barcelona',
    price: 35,
    duration: 60, // Audio tour
    searchTerms: 'Casa Batllo Skip the Line Ticket',
  },
  'casa milà': {
    city: 'Barcelona',
    price: 29,
    duration: 60, // Audio tour
    searchTerms: 'La Pedrera Casa Mila Audio Tour',
  },
  'la pedrera': {
    city: 'Barcelona',
    price: 29,
    duration: 60,
    searchTerms: 'La Pedrera Casa Mila Audio Tour',
  },
  'camp nou': {
    city: 'Barcelona',
    price: 28,
    duration: 90, // Stade + musée
    searchTerms: 'FC Barcelona Camp Nou Experience Tour',
  },
  'la rambla': {
    city: 'Barcelona',
    price: 25,
    duration: 75, // Walking tour
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },
  'gothic quarter': {
    city: 'Barcelona',
    price: 25,
    duration: 75,
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },
  'barri gòtic': {
    city: 'Barcelona',
    price: 25,
    duration: 75,
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },

  // ===== LONDON =====
  'tower of london': {
    city: 'London',
    price: 35,
    duration: 120, // Joyaux + tours + histoire
    searchTerms: 'Tower of London Ticket',
  },
  'tour de londres': {
    city: 'London',
    price: 35,
    duration: 120,
    searchTerms: 'Tower of London Ticket',
  },
  'buckingham palace': {
    city: 'London',
    price: 30,
    duration: 90, // State rooms
    searchTerms: 'Buckingham Palace Tour',
  },
  'westminster abbey': {
    city: 'London',
    price: 27,
    duration: 75,
    searchTerms: 'Westminster Abbey Tour',
  },
  'british museum': {
    city: 'London',
    price: 29,
    duration: 150, // Grand musée
    searchTerms: 'British Museum Guided Tour',
  },
  'london eye': {
    city: 'London',
    price: 34,
    duration: 45, // Rotation ~30min + queue
    searchTerms: 'London Eye Standard Ticket',
  },
  'big ben': {
    city: 'London',
    price: 35,
    duration: 60, // Walking tour extérieur
    searchTerms: 'Houses of Parliament Big Ben Tour',
  },
  "st paul's cathedral": {
    city: 'London',
    price: 23,
    duration: 75, // Intérieur + dôme
    searchTerms: 'St Pauls Cathedral Admission Ticket',
  },
  'tower bridge': {
    city: 'London',
    price: 13,
    duration: 45, // Exhibition + passerelle
    searchTerms: 'Tower Bridge Exhibition Ticket',
  },

  // ===== AMSTERDAM =====
  'anne frank house': {
    city: 'Amsterdam',
    price: 29,
    duration: 75, // Walking tour
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'maison anne frank': {
    city: 'Amsterdam',
    price: 29,
    duration: 75,
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'rijksmuseum': {
    city: 'Amsterdam',
    price: 22,
    duration: 150, // Grand musée
    searchTerms: 'Rijksmuseum Skip the Line Admission',
  },
  'van gogh museum': {
    city: 'Amsterdam',
    price: 22,
    duration: 90, // Musée moyen
    searchTerms: 'Van Gogh Museum Skip the Line Admission',
  },
  'musée van gogh': {
    city: 'Amsterdam',
    price: 22,
    duration: 90,
    searchTerms: 'Van Gogh Museum Skip the Line Admission',
  },
  'canal cruise amsterdam': {
    city: 'Amsterdam',
    price: 16,
    duration: 60, // Croisière standard
    searchTerms: 'Amsterdam Canal Cruise',
  },
  'keukenhof': {
    city: 'Amsterdam',
    price: 59,
    duration: 240, // Day trip jardins
    searchTerms: 'Keukenhof Gardens Tulip Fields Tour',
  },

  // ===== VENICE =====
  "st mark's basilica": {
    city: 'Venice',
    price: 39,
    duration: 45, // Visite intérieure
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  'basilique saint-marc': {
    city: 'Venice',
    price: 39,
    duration: 45,
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  "doge's palace": {
    city: 'Venice',
    price: 45,
    duration: 90, // Palais + prison
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'palais des doges': {
    city: 'Venice',
    price: 45,
    duration: 90,
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'murano': {
    city: 'Venice',
    price: 25,
    duration: 240, // Tour 3 îles
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'burano': {
    city: 'Venice',
    price: 25,
    duration: 240,
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'gondola ride': {
    city: 'Venice',
    price: 33,
    duration: 30, // Balade gondole standard
    searchTerms: 'Venice Gondola Ride',
  },
  'rialto bridge': {
    city: 'Venice',
    price: 45,
    duration: 90, // Walking tour
    searchTerms: 'Venice Walking Tour Gondola Ride Rialto',
  },

  // ===== FLORENCE =====
  'uffizi gallery': {
    city: 'Florence',
    price: 55,
    duration: 150, // Grand musée
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'galerie des offices': {
    city: 'Florence',
    price: 55,
    duration: 150,
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'accademia gallery': {
    city: 'Florence',
    price: 49,
    duration: 60, // David + quelques salles
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'david michelangelo': {
    city: 'Florence',
    price: 49,
    duration: 60,
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'duomo florence': {
    city: 'Florence',
    price: 35,
    duration: 75, // Montée coupole
    searchTerms: 'Florence Duomo Dome Climb Skip the Line',
  },
  'ponte vecchio': {
    city: 'Florence',
    price: 39,
    duration: 75, // Walking tour
    searchTerms: 'Florence Walking Tour Ponte Vecchio',
  },
};

/**
 * Cherche des données Viator connues pour une activité
 * Retourne une URL de recherche Viator (toujours fonctionnelle) + prix/durée indicatifs
 */
export function findKnownViatorProduct(
  activityName: string
): { url: string; price: number; title: string; duration?: number } | null {
  const searchName = activityName.toLowerCase().trim();

  for (const [keyword, data] of Object.entries(KNOWN_VIATOR_PRODUCTS)) {
    if (searchName.includes(keyword) || keyword.includes(searchName)) {
      const url = `https://www.viator.com/searchResults/all?text=${encodeURIComponent(data.searchTerms)}`;
      console.log(`[Viator Known] ✅ Match trouvé: "${activityName}" → recherche "${data.searchTerms}"`);
      return {
        url,
        price: data.price || 0,
        title: activityName,
        duration: data.duration,
      };
    }
  }

  return null;
}
