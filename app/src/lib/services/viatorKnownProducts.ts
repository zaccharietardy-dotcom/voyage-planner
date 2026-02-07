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
    price: 24, // Ferry + accès île (officiel NPS)
    duration: 240,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'statue de la liberté': {
    city: 'New York',
    price: 24,
    duration: 240,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'ellis island': {
    city: 'New York',
    price: 24,
    duration: 240,
    searchTerms: 'Statue of Liberty Ellis Island Tour',
  },
  'empire state building': {
    city: 'New York',
    price: 44, // Main Deck (86th floor) officiel
    duration: 60,
    searchTerms: 'Empire State Building Tickets',
  },
  'top of the rock': {
    city: 'New York',
    price: 40, // Prix officiel adulte
    duration: 45,
    searchTerms: 'Top of the Rock Observation Deck',
  },
  '9/11 memorial': {
    city: 'New York',
    price: 28, // Musée officiel (mémorial extérieur gratuit)
    duration: 120,
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'mémorial du 11 septembre': {
    city: 'New York',
    price: 28,
    duration: 120,
    searchTerms: '9/11 Memorial Museum Admission',
  },
  'one world observatory': {
    city: 'New York',
    price: 38, // Prix officiel standard
    duration: 60,
    searchTerms: 'One World Observatory Ticket',
  },
  'metropolitan museum': {
    city: 'New York',
    price: 30, // Prix officiel adulte
    duration: 180,
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
    price: 0, // Parc public gratuit
    duration: 90,
    searchTerms: 'Central Park Walking Tour',
  },
  'high line': {
    city: 'New York',
    price: 0, // Parc public gratuit
    duration: 75,
    searchTerms: 'High Line Chelsea Walking Tour',
  },
  'brooklyn bridge': {
    city: 'New York',
    price: 0, // Pont public gratuit
    duration: 60,
    searchTerms: 'Brooklyn Bridge DUMBO Walking Tour',
  },
  'guggenheim': {
    city: 'New York',
    price: 25, // Prix officiel adulte
    duration: 120,
    searchTerms: 'Guggenheim Museum New York Admission',
  },
  'moma': {
    city: 'New York',
    price: 25, // Prix officiel adulte
    duration: 120,
    searchTerms: 'Museum of Modern Art MoMA New York Admission',
  },
  'museum of modern art': {
    city: 'New York',
    price: 25,
    duration: 120,
    searchTerms: 'Museum of Modern Art MoMA New York Admission',
  },

  // ===== PARIS =====
  'tour eiffel': {
    city: 'Paris',
    price: 29, // Sommet par ascenseur (officiel)
    duration: 90,
    searchTerms: 'Eiffel Tower Summit Access Paris',
  },
  'eiffel tower': {
    city: 'Paris',
    price: 29,
    duration: 90,
    searchTerms: 'Eiffel Tower Summit Access Paris',
  },
  'louvre': {
    city: 'Paris',
    price: 22, // Prix officiel adulte
    duration: 150,
    searchTerms: 'Louvre Museum Paris Skip the Line Guided Tour',
  },
  'musée du louvre': {
    city: 'Paris',
    price: 22,
    duration: 150,
    searchTerms: 'Louvre Museum Paris Skip the Line Guided Tour',
  },
  'versailles': {
    city: 'Paris',
    price: 21, // Château seul (officiel)
    duration: 240,
    searchTerms: 'Versailles Palace Paris Guided Tour',
  },
  'château de versailles': {
    city: 'Paris',
    price: 21,
    duration: 240,
    searchTerms: 'Versailles Palace Paris Guided Tour',
  },
  "arc de triomphe": {
    city: 'Paris',
    price: 16, // Prix officiel adulte
    duration: 45,
    searchTerms: 'Arc de Triomphe Paris Skip the Line Ticket',
  },
  'notre dame': {
    city: 'Paris',
    price: 0, // Entrée cathédrale gratuite
    duration: 60,
    searchTerms: 'Notre Dame Paris Island Walking Tour',
  },
  'notre-dame': {
    city: 'Paris',
    price: 0,
    duration: 60,
    searchTerms: 'Notre Dame Paris Island Walking Tour',
  },
  'sacré-coeur': {
    city: 'Paris',
    price: 0, // Basilique gratuite (dôme 7€ optionnel)
    duration: 45,
    searchTerms: 'Montmartre Paris Walking Tour Sacre Coeur',
  },
  'montmartre': {
    city: 'Paris',
    price: 0, // Quartier gratuit
    duration: 90,
    searchTerms: 'Montmartre Paris Walking Tour Sacre Coeur',
  },
  "musée d'orsay": {
    city: 'Paris',
    price: 16, // Prix officiel adulte
    duration: 120,
    searchTerms: 'Musee d Orsay Paris Skip the Line Ticket',
  },
  'orsay museum': {
    city: 'Paris',
    price: 16,
    duration: 120,
    searchTerms: 'Musee d Orsay Paris Skip the Line Ticket',
  },

  // ===== ROME =====
  'colosseum': {
    city: 'Rome',
    price: 18, // Billet combiné Colisée+Forum+Palatin (officiel)
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colisée': {
    city: 'Rome',
    price: 18,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'colosseo': {
    city: 'Rome',
    price: 18,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'vatican': {
    city: 'Rome',
    price: 17, // Musées du Vatican (officiel, inclut Sixtine)
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'vatican museums': {
    city: 'Rome',
    price: 17,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'musées du vatican': {
    city: 'Rome',
    price: 17,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'sistine chapel': {
    city: 'Rome',
    price: 17, // Inclus dans billet musées du Vatican
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'chapelle sixtine': {
    city: 'Rome',
    price: 17,
    duration: 180,
    searchTerms: 'Vatican Museums Sistine Chapel Skip the Line',
  },
  'roman forum': {
    city: 'Rome',
    price: 18, // Inclus dans billet Colisée
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'forum romain': {
    city: 'Rome',
    price: 18,
    duration: 90,
    searchTerms: 'Colosseum Roman Forum Palatine Hill Skip the Line',
  },
  'pantheon': {
    city: 'Rome',
    price: 5, // Prix officiel depuis 2023
    duration: 45,
    searchTerms: 'Pantheon Guided Tour Rome',
  },
  'trevi fountain': {
    city: 'Rome',
    price: 0, // Gratuit (fontaine publique)
    duration: 20,
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },
  'fontaine de trevi': {
    city: 'Rome',
    price: 0,
    duration: 20,
    searchTerms: 'Trevi Fountain Underground Rome Tour',
  },

  // ===== BARCELONA =====
  'sagrada familia': {
    city: 'Barcelona',
    price: 26, // Prix officiel adulte
    duration: 90,
    searchTerms: 'Sagrada Familia Skip the Line Tour',
  },
  'park güell': {
    city: 'Barcelona',
    price: 10, // Prix officiel zone monumentale
    duration: 75,
    searchTerms: 'Park Guell Barcelona Skip the Line Guided Tour',
  },
  'parc güell': {
    city: 'Barcelona',
    price: 10,
    duration: 75,
    searchTerms: 'Park Guell Barcelona Skip the Line Guided Tour',
  },
  'casa batlló': {
    city: 'Barcelona',
    price: 35, // Prix officiel adulte
    duration: 60,
    searchTerms: 'Casa Batllo Barcelona Skip the Line Ticket',
  },
  'casa milà': {
    city: 'Barcelona',
    price: 25, // Prix officiel adulte
    duration: 60,
    searchTerms: 'La Pedrera Casa Mila Barcelona Tour',
  },
  'la pedrera': {
    city: 'Barcelona',
    price: 25,
    duration: 60,
    searchTerms: 'La Pedrera Casa Mila Barcelona Tour',
  },
  'camp nou': {
    city: 'Barcelona',
    price: 28, // Tour + musée officiel
    duration: 90,
    searchTerms: 'FC Barcelona Camp Nou Experience Tour',
  },
  'la rambla': {
    city: 'Barcelona',
    price: 0, // Rue publique gratuite
    duration: 60,
    searchTerms: 'Gothic Quarter La Rambla Barcelona Walking Tour',
  },
  'gothic quarter': {
    city: 'Barcelona',
    price: 0, // Quartier public gratuit
    duration: 75,
    searchTerms: 'Gothic Quarter La Rambla Barcelona Walking Tour',
  },
  'barri gòtic': {
    city: 'Barcelona',
    price: 0,
    duration: 75,
    searchTerms: 'Gothic Quarter La Rambla Barcelona Walking Tour',
  },

  // ===== LONDON =====
  'tower of london': {
    city: 'London',
    price: 33, // Prix officiel adulte (~£29.90)
    duration: 120,
    searchTerms: 'Tower of London Ticket',
  },
  'tour de londres': {
    city: 'London',
    price: 33,
    duration: 120,
    searchTerms: 'Tower of London Ticket',
  },
  'buckingham palace': {
    city: 'London',
    price: 30, // State rooms (été, officiel ~£30)
    duration: 90,
    searchTerms: 'Buckingham Palace Tour',
  },
  'westminster abbey': {
    city: 'London',
    price: 27, // Prix officiel adulte (~£25)
    duration: 75,
    searchTerms: 'Westminster Abbey Tour',
  },
  'british museum': {
    city: 'London',
    price: 0, // Gratuit (donations bienvenues)
    duration: 150,
    searchTerms: 'British Museum Guided Tour',
  },
  'london eye': {
    city: 'London',
    price: 34, // Prix officiel standard (~£32)
    duration: 45,
    searchTerms: 'London Eye Standard Ticket',
  },
  'big ben': {
    city: 'London',
    price: 0, // Extérieur gratuit (tour intérieur UK residents only)
    duration: 30,
    searchTerms: 'Houses of Parliament Big Ben Tour',
  },
  "st paul's cathedral": {
    city: 'London',
    price: 23, // Prix officiel adulte (~£21)
    duration: 75,
    searchTerms: 'St Pauls Cathedral Admission Ticket',
  },
  'tower bridge': {
    city: 'London',
    price: 13, // Exhibition officiel (~£12)
    duration: 45,
    searchTerms: 'Tower Bridge Exhibition Ticket',
  },

  // ===== AMSTERDAM =====
  'anne frank house': {
    city: 'Amsterdam',
    price: 16, // Prix officiel adulte
    duration: 75,
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'maison anne frank': {
    city: 'Amsterdam',
    price: 16,
    duration: 75,
    searchTerms: 'Anne Frank Walking Tour Amsterdam',
  },
  'rijksmuseum': {
    city: 'Amsterdam',
    price: 22, // Prix officiel adulte (correct)
    duration: 150,
    searchTerms: 'Rijksmuseum Amsterdam Guided Tour',
  },
  'van gogh museum': {
    city: 'Amsterdam',
    price: 20, // Prix officiel adulte
    duration: 90,
    searchTerms: 'Amsterdam Van Gogh Museum Tour',
  },
  'musée van gogh': {
    city: 'Amsterdam',
    price: 20,
    duration: 90,
    searchTerms: 'Amsterdam Van Gogh Museum Tour',
  },
  'canal cruise amsterdam': {
    city: 'Amsterdam',
    price: 16, // Prix standard croisière (correct)
    duration: 60,
    searchTerms: 'Amsterdam Canal Cruise',
  },
  'keukenhof': {
    city: 'Amsterdam',
    price: 20, // Prix officiel entrée (sans transport)
    duration: 240,
    searchTerms: 'Keukenhof Gardens Tulip Fields Tour',
  },

  // ===== VENICE =====
  "st mark's basilica": {
    city: 'Venice',
    price: 3, // Entrée basilique (officiel, gratuit base + 3€ réservation)
    duration: 45,
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  'basilique saint-marc': {
    city: 'Venice',
    price: 3,
    duration: 45,
    searchTerms: 'St Marks Basilica Skip the Line Tour Venice',
  },
  "doge's palace": {
    city: 'Venice',
    price: 30, // Prix officiel adulte
    duration: 90,
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'palais des doges': {
    city: 'Venice',
    price: 30,
    duration: 90,
    searchTerms: 'Doges Palace Skip the Line Tour Venice',
  },
  'murano': {
    city: 'Venice',
    price: 20, // Vaporetto aller-retour (ACTV)
    duration: 240,
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'burano': {
    city: 'Venice',
    price: 20,
    duration: 240,
    searchTerms: 'Murano Burano Torcello Islands Tour',
  },
  'gondola ride': {
    city: 'Venice',
    price: 80, // Tarif officiel gondole (80€ de jour, 100€ de nuit, pour le bateau)
    duration: 30,
    searchTerms: 'Venice Gondola Ride',
  },
  'rialto bridge': {
    city: 'Venice',
    price: 0, // Pont public gratuit
    duration: 30,
    searchTerms: 'Venice Walking Tour Gondola Ride Rialto',
  },

  // ===== FLORENCE =====
  'uffizi gallery': {
    city: 'Florence',
    price: 20, // Prix officiel adulte (hors période haute)
    duration: 150,
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'galerie des offices': {
    city: 'Florence',
    price: 20,
    duration: 150,
    searchTerms: 'Uffizi Gallery Skip the Line Tour',
  },
  'accademia gallery': {
    city: 'Florence',
    price: 12, // Prix officiel adulte
    duration: 60,
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'david michelangelo': {
    city: 'Florence',
    price: 12,
    duration: 60,
    searchTerms: 'Accademia Gallery Skip the Line Tour Florence',
  },
  'duomo florence': {
    city: 'Florence',
    price: 30, // Pass coupole (officiel Brunelleschi)
    duration: 75,
    searchTerms: 'Florence Duomo Dome Climb Skip the Line',
  },
  'ponte vecchio': {
    city: 'Florence',
    price: 0, // Pont public gratuit
    duration: 30,
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
