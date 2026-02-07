/**
 * Données Viator connues pour les attractions majeures
 *
 * Ces entrées fournissent:
 * - Des prix indicatifs (pour l'estimation budgétaire)
 * - Des liens de recherche Viator fiables (pas des URLs de produits inventés)
 *
 * Les URLs utilisent le format /searchResults/all?text=... qui montre
 * toujours des résultats pertinents, contrairement aux URLs de produits
 * qui peuvent 404 si le code produit change.
 *
 * Format: { 'keyword': { city, price, searchTerms } }
 * Les keywords sont en minuscules pour faciliter le matching.
 */

interface KnownViatorEntry {
  city: string;
  price?: number;
  searchTerms: string; // What to search on Viator
}

export const KNOWN_VIATOR_PRODUCTS: Record<string, KnownViatorEntry> = {
  // ===== NEW YORK =====
  'statue of liberty': {
    city: 'New York',
    price: 65,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'statue de la liberté': {
    city: 'New York',
    price: 65,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'ellis island': {
    city: 'New York',
    price: 65,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'empire state building': {
    city: 'New York',
    price: 47,
    searchTerms: 'Empire State Building Tickets',
  },
  'top of the rock': {
    city: 'New York',
    price: 43,
    searchTerms: 'Top of the Rock Observation Deck',
  },
  '9/11 memorial': {
    city: 'New York',
    price: 33,
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'mémorial du 11 septembre': {
    city: 'New York',
    price: 33,
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'one world observatory': {
    city: 'New York',
    price: 43,
    searchTerms: 'One World Observatory Ticket',
  },
  'metropolitan museum': {
    city: 'New York',
    price: 30,
    searchTerms: 'Metropolitan Museum of Art Admission',
  },
  'met museum': {
    city: 'New York',
    price: 30,
    searchTerms: 'Metropolitan Museum of Art Admission',
  },
  'central park': {
    city: 'New York',
    price: 35,
    searchTerms: 'Central Park Walking Tour',
  },
  'high line': {
    city: 'New York',
    price: 39,
    searchTerms: 'High Line Chelsea Walking Tour',
  },
  'brooklyn bridge': {
    city: 'New York',
    price: 35,
    searchTerms: 'Brooklyn Bridge DUMBO Walking Tour',
  },
  'guggenheim': {
    city: 'New York',
    price: 25,
    searchTerms: 'Guggenheim Museum Admission',
  },
  'moma': {
    city: 'New York',
    price: 25,
    searchTerms: 'Museum of Modern Art MoMA Admission',
  },
  'museum of modern art': {
    city: 'New York',
    price: 25,
    searchTerms: 'Museum of Modern Art MoMA Admission',
  },

  // ===== PARIS =====
  'tour eiffel': {
    city: 'Paris',
    price: 65,
    searchTerms: 'Eiffel Tower Skip the Line Tour',
  },
  'eiffel tower': {
    city: 'Paris',
    price: 65,
    searchTerms: 'Eiffel Tower Skip the Line Tour',
  },
  'louvre': {
    city: 'Paris',
    price: 59,
    searchTerms: 'Louvre Museum Skip the Line Guided Tour',
  },
  'musée du louvre': {
    city: 'Paris',
    price: 59,
    searchTerms: 'Louvre Museum Skip the Line Guided Tour',
  },
  'versailles': {
    city: 'Paris',
    price: 89,
    searchTerms: 'Versailles Palace Skip the Line',
  },
  'château de versailles': {
    city: 'Paris',
    price: 89,
    searchTerms: 'Versailles Palace Skip the Line',
  },
  "arc de triomphe": {
    city: 'Paris',
    price: 16,
    searchTerms: 'Arc de Triomphe Skip the Line Ticket',
  },
  'notre dame': {
    city: 'Paris',
    price: 29,
    searchTerms: 'Notre Dame Island Walking Tour',
  },
  'notre-dame': {
    city: 'Paris',
    price: 29,
    searchTerms: 'Notre Dame Island Walking Tour',
  },
  'sacré-coeur': {
    city: 'Paris',
    price: 35,
    searchTerms: 'Montmartre Walking Tour Sacre Coeur',
  },
  'montmartre': {
    city: 'Paris',
    price: 35,
    searchTerms: 'Montmartre Walking Tour Sacre Coeur',
  },
  "musée d'orsay": {
    city: 'Paris',
    price: 16,
    searchTerms: 'Musee d Orsay Skip the Line Ticket',
  },
  'orsay museum': {
    city: 'Paris',
    price: 16,
    searchTerms: 'Musee d Orsay Skip the Line Ticket',
  },

  // ===== ROME =====
  'colosseum': {
    city: 'Rome',
    price: 59,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colisée': {
    city: 'Rome',
    price: 59,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colosseo': {
    city: 'Rome',
    price: 59,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'vatican': {
    city: 'Rome',
    price: 69,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'vatican museums': {
    city: 'Rome',
    price: 69,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'musées du vatican': {
    city: 'Rome',
    price: 69,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'sistine chapel': {
    city: 'Rome',
    price: 69,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'chapelle sixtine': {
    city: 'Rome',
    price: 69,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'roman forum': {
    city: 'Rome',
    price: 59,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'forum romain': {
    city: 'Rome',
    price: 59,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'pantheon': {
    city: 'Rome',
    price: 25,
    searchTerms: 'Pantheon Guided Tour Rome',
  },
  'trevi fountain': {
    city: 'Rome',
    price: 39,
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },
  'fontaine de trevi': {
    city: 'Rome',
    price: 39,
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },

  // ===== BARCELONA =====
  'sagrada familia': {
    city: 'Barcelona',
    price: 47,
    searchTerms: 'Sagrada Familia Skip the Line Tour',
  },
  'park güell': {
    city: 'Barcelona',
    price: 35,
    searchTerms: 'Park Guell Skip the Line Guided Tour',
  },
  'parc güell': {
    city: 'Barcelona',
    price: 35,
    searchTerms: 'Park Guell Skip the Line Guided Tour',
  },
  'casa batlló': {
    city: 'Barcelona',
    price: 35,
    searchTerms: 'Casa Batllo Skip the Line Ticket',
  },
  'casa milà': {
    city: 'Barcelona',
    price: 29,
    searchTerms: 'La Pedrera Casa Mila Audio Tour',
  },
  'la pedrera': {
    city: 'Barcelona',
    price: 29,
    searchTerms: 'La Pedrera Casa Mila Audio Tour',
  },
  'camp nou': {
    city: 'Barcelona',
    price: 28,
    searchTerms: 'FC Barcelona Camp Nou Experience Tour',
  },
  'la rambla': {
    city: 'Barcelona',
    price: 25,
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },
  'gothic quarter': {
    city: 'Barcelona',
    price: 25,
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },
  'barri gòtic': {
    city: 'Barcelona',
    price: 25,
    searchTerms: 'Gothic Quarter La Rambla Walking Tour',
  },

  // ===== LONDON =====
  'tower of london': {
    city: 'London',
    price: 35,
    searchTerms: 'Tower of London Ticket',
  },
  'tour de londres': {
    city: 'London',
    price: 35,
    searchTerms: 'Tower of London Ticket',
  },
  'buckingham palace': {
    city: 'London',
    price: 30,
    searchTerms: 'Buckingham Palace Tour',
  },
  'westminster abbey': {
    city: 'London',
    price: 27,
    searchTerms: 'Westminster Abbey Tour',
  },
  'british museum': {
    city: 'London',
    price: 29,
    searchTerms: 'British Museum Guided Tour',
  },
  'london eye': {
    city: 'London',
    price: 34,
    searchTerms: 'London Eye Standard Ticket',
  },
  'big ben': {
    city: 'London',
    price: 35,
    searchTerms: 'Houses of Parliament Big Ben Tour',
  },
  "st paul's cathedral": {
    city: 'London',
    price: 23,
    searchTerms: 'St Pauls Cathedral Admission Ticket',
  },
  'tower bridge': {
    city: 'London',
    price: 13,
    searchTerms: 'Tower Bridge Exhibition Ticket',
  },

  // ===== AMSTERDAM =====
  'anne frank house': {
    city: 'Amsterdam',
    price: 29,
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'maison anne frank': {
    city: 'Amsterdam',
    price: 29,
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'rijksmuseum': {
    city: 'Amsterdam',
    price: 22,
    searchTerms: 'Rijksmuseum Skip the Line Admission',
  },
  'van gogh museum': {
    city: 'Amsterdam',
    price: 22,
    searchTerms: 'Van Gogh Museum Skip the Line Admission',
  },
  'musée van gogh': {
    city: 'Amsterdam',
    price: 22,
    searchTerms: 'Van Gogh Museum Skip the Line Admission',
  },
  'canal cruise amsterdam': {
    city: 'Amsterdam',
    price: 16,
    searchTerms: 'Amsterdam Canal Cruise',
  },
  'keukenhof': {
    city: 'Amsterdam',
    price: 59,
    searchTerms: 'Keukenhof Gardens Tulip Fields Tour',
  },

  // ===== VENICE =====
  "st mark's basilica": {
    city: 'Venice',
    price: 39,
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  'basilique saint-marc': {
    city: 'Venice',
    price: 39,
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  "doge's palace": {
    city: 'Venice',
    price: 45,
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'palais des doges': {
    city: 'Venice',
    price: 45,
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'murano': {
    city: 'Venice',
    price: 25,
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'burano': {
    city: 'Venice',
    price: 25,
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'gondola ride': {
    city: 'Venice',
    price: 33,
    searchTerms: 'Venice Gondola Ride',
  },
  'rialto bridge': {
    city: 'Venice',
    price: 45,
    searchTerms: 'Venice Walking Tour Gondola Ride Rialto',
  },

  // ===== FLORENCE =====
  'uffizi gallery': {
    city: 'Florence',
    price: 55,
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'galerie des offices': {
    city: 'Florence',
    price: 55,
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'accademia gallery': {
    city: 'Florence',
    price: 49,
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'david michelangelo': {
    city: 'Florence',
    price: 49,
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'duomo florence': {
    city: 'Florence',
    price: 35,
    searchTerms: 'Florence Duomo Dome Climb Skip the Line',
  },
  'ponte vecchio': {
    city: 'Florence',
    price: 39,
    searchTerms: 'Florence Walking Tour Ponte Vecchio',
  },
};

/**
 * Cherche des données Viator connues pour une activité
 * Retourne une URL de recherche Viator (toujours fonctionnelle) + prix indicatif
 */
export function findKnownViatorProduct(
  activityName: string
): { url: string; price: number; title: string } | null {
  const searchName = activityName.toLowerCase().trim();

  for (const [keyword, data] of Object.entries(KNOWN_VIATOR_PRODUCTS)) {
    if (searchName.includes(keyword) || keyword.includes(searchName)) {
      const url = `https://www.viator.com/searchResults/all?text=${encodeURIComponent(data.searchTerms)}`;
      console.log(`[Viator Known] ✅ Match trouvé: "${activityName}" → recherche "${data.searchTerms}"`);
      return {
        url,
        price: data.price || 0,
        title: activityName,
      };
    }
  }

  return null;
}
