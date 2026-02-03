/**
 * URLs Viator connues pour les attractions majeures
 *
 * Cette liste permet de court-circuiter la recherche API
 * et garantir des liens de qualité vers les bonnes expériences.
 *
 * Format: { 'keyword': 'full_viator_url' }
 * Les keywords sont en minuscules pour faciliter le matching.
 */

export const KNOWN_VIATOR_PRODUCTS: Record<string, { url: string; price?: number }> = {
  // ===== NEW YORK =====
  'statue of liberty': {
    url: 'https://www.viator.com/tours/New-York-City/Statue-of-Liberty-and-Ellis-Island-Guided-Tour/d687-5250LIBERTYELLIS',
    price: 65,
  },
  'statue de la liberté': {
    url: 'https://www.viator.com/tours/New-York-City/Statue-of-Liberty-and-Ellis-Island-Guided-Tour/d687-5250LIBERTYELLIS',
    price: 65,
  },
  'ellis island': {
    url: 'https://www.viator.com/tours/New-York-City/Statue-of-Liberty-and-Ellis-Island-Guided-Tour/d687-5250LIBERTYELLIS',
    price: 65,
  },
  'empire state building': {
    url: 'https://www.viator.com/tours/New-York-City/Empire-State-Building-Tickets/d687-5077ESB',
    price: 47,
  },
  'top of the rock': {
    url: 'https://www.viator.com/tours/New-York-City/Top-of-the-Rock-Observation-Deck-New-York-City/d687-3604TOP',
    price: 43,
  },
  '9/11 memorial': {
    url: 'https://www.viator.com/tours/New-York-City/9-11-Memorial-Museum-Admission/d687-5765P8',
    price: 33,
  },
  'mémorial du 11 septembre': {
    url: 'https://www.viator.com/tours/New-York-City/9-11-Memorial-Museum-Admission/d687-5765P8',
    price: 33,
  },
  'one world observatory': {
    url: 'https://www.viator.com/tours/New-York-City/One-World-Observatory-Ticket/d687-7437P3',
    price: 43,
  },
  'metropolitan museum': {
    url: 'https://www.viator.com/tours/New-York-City/Metropolitan-Museum-of-Art-Admission/d687-7151MET',
    price: 30,
  },
  'met museum': {
    url: 'https://www.viator.com/tours/New-York-City/Metropolitan-Museum-of-Art-Admission/d687-7151MET',
    price: 30,
  },
  'central park': {
    url: 'https://www.viator.com/tours/New-York-City/Central-Park-Walking-Tour/d687-3848CENTRAL',
    price: 35,
  },
  'high line': {
    url: 'https://www.viator.com/tours/New-York-City/High-Line-Chelsea-and-Meatpacking-District-Walking-Tour/d687-6435HIGHLINE',
    price: 39,
  },
  'brooklyn bridge': {
    url: 'https://www.viator.com/tours/New-York-City/Brooklyn-Bridge-and-DUMBO-Walking-Tour/d687-5095BROOKLYN',
    price: 35,
  },
  'guggenheim': {
    url: 'https://www.viator.com/tours/New-York-City/Guggenheim-Museum-Admission/d687-7151GUGG',
    price: 25,
  },
  'moma': {
    url: 'https://www.viator.com/tours/New-York-City/Museum-of-Modern-Art-MoMA-Admission/d687-3551MOMA',
    price: 25,
  },
  'museum of modern art': {
    url: 'https://www.viator.com/tours/New-York-City/Museum-of-Modern-Art-MoMA-Admission/d687-3551MOMA',
    price: 25,
  },

  // ===== PARIS =====
  'tour eiffel': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Eiffel-Tower-Tour/d479-5765EIFFEL',
    price: 65,
  },
  'eiffel tower': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Eiffel-Tower-Tour/d479-5765EIFFEL',
    price: 65,
  },
  'louvre': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Louvre-Museum-Guided-Tour/d479-5765LOUVRE',
    price: 59,
  },
  'musée du louvre': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Louvre-Museum-Guided-Tour/d479-5765LOUVRE',
    price: 59,
  },
  'versailles': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Versailles-Palace/d479-5765VERSAILLES',
    price: 89,
  },
  'château de versailles': {
    url: 'https://www.viator.com/tours/Paris/Skip-the-Line-Versailles-Palace/d479-5765VERSAILLES',
    price: 89,
  },
  "arc de triomphe": {
    url: 'https://www.viator.com/tours/Paris/Arc-de-Triomphe-Skip-the-Line-Ticket/d479-6741ARCDETRIOMPHE',
    price: 16,
  },
  'notre dame': {
    url: 'https://www.viator.com/tours/Paris/Notre-Dame-Island-Walking-Tour/d479-5765NOTREDAME',
    price: 29,
  },
  'notre-dame': {
    url: 'https://www.viator.com/tours/Paris/Notre-Dame-Island-Walking-Tour/d479-5765NOTREDAME',
    price: 29,
  },
  'sacré-coeur': {
    url: 'https://www.viator.com/tours/Paris/Montmartre-Walking-Tour-with-Sacre-Coeur/d479-5765MONTMARTRE',
    price: 35,
  },
  'montmartre': {
    url: 'https://www.viator.com/tours/Paris/Montmartre-Walking-Tour-with-Sacre-Coeur/d479-5765MONTMARTRE',
    price: 35,
  },
  "musée d'orsay": {
    url: 'https://www.viator.com/tours/Paris/Musee-dOrsay-Skip-the-Line-Ticket/d479-5765ORSAY',
    price: 16,
  },
  'orsay museum': {
    url: 'https://www.viator.com/tours/Paris/Musee-dOrsay-Skip-the-Line-Ticket/d479-5765ORSAY',
    price: 16,
  },

  // ===== ROME =====
  'colosseum': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Colosseum-Roman-Forum-Palatine-Hill/d511-3691COLOS',
    price: 59,
  },
  'colisée': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Colosseum-Roman-Forum-Palatine-Hill/d511-3691COLOS',
    price: 59,
  },
  'colosseo': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Colosseum-Roman-Forum-Palatine-Hill/d511-3691COLOS',
    price: 59,
  },
  'vatican': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Vatican-Museums-and-Sistine-Chapel/d511-2660VATICAN',
    price: 69,
  },
  'vatican museums': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Vatican-Museums-and-Sistine-Chapel/d511-2660VATICAN',
    price: 69,
  },
  'musées du vatican': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Vatican-Museums-and-Sistine-Chapel/d511-2660VATICAN',
    price: 69,
  },
  'sistine chapel': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Vatican-Museums-and-Sistine-Chapel/d511-2660VATICAN',
    price: 69,
  },
  'chapelle sixtine': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Vatican-Museums-and-Sistine-Chapel/d511-2660VATICAN',
    price: 69,
  },
  'roman forum': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Colosseum-Roman-Forum-Palatine-Hill/d511-3691COLOS',
    price: 59,
  },
  'forum romain': {
    url: 'https://www.viator.com/tours/Rome/Skip-the-Line-Colosseum-Roman-Forum-Palatine-Hill/d511-3691COLOS',
    price: 59,
  },
  'pantheon': {
    url: 'https://www.viator.com/tours/Rome/Pantheon-Guided-Tour/d511-35972P1',
    price: 25,
  },
  'trevi fountain': {
    url: 'https://www.viator.com/tours/Rome/Trevi-Fountain-and-Underground-Rome-Tour/d511-15873TREVI',
    price: 39,
  },
  'fontaine de trevi': {
    url: 'https://www.viator.com/tours/Rome/Trevi-Fountain-and-Underground-Rome-Tour/d511-15873TREVI',
    price: 39,
  },

  // ===== BARCELONA =====
  'sagrada familia': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-La-Sagrada-Familia-Tour/d562-5765SAGRADA',
    price: 47,
  },
  'park güell': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-Park-Guell-Guided-Tour/d562-5765PARKGUELL',
    price: 35,
  },
  'parc güell': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-Park-Guell-Guided-Tour/d562-5765PARKGUELL',
    price: 35,
  },
  'casa batlló': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-Casa-Batllo-Ticket/d562-5765CASABATLLO',
    price: 35,
  },
  'casa milà': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-La-Pedrera-Audio-Tour/d562-5765PEDRERA',
    price: 29,
  },
  'la pedrera': {
    url: 'https://www.viator.com/tours/Barcelona/Skip-the-Line-La-Pedrera-Audio-Tour/d562-5765PEDRERA',
    price: 29,
  },
  'camp nou': {
    url: 'https://www.viator.com/tours/Barcelona/FC-Barcelona-Camp-Nou-Experience-Tour/d562-5765CAMPNOU',
    price: 28,
  },
  'la rambla': {
    url: 'https://www.viator.com/tours/Barcelona/Gothic-Quarter-and-La-Rambla-Walking-Tour/d562-5765GOTHIC',
    price: 25,
  },
  'gothic quarter': {
    url: 'https://www.viator.com/tours/Barcelona/Gothic-Quarter-and-La-Rambla-Walking-Tour/d562-5765GOTHIC',
    price: 25,
  },
  'barri gòtic': {
    url: 'https://www.viator.com/tours/Barcelona/Gothic-Quarter-and-La-Rambla-Walking-Tour/d562-5765GOTHIC',
    price: 25,
  },

  // ===== LONDON =====
  'tower of london': {
    url: 'https://www.viator.com/tours/London/Tower-of-London-Ticket/d737-5765TOWER',
    price: 35,
  },
  'tour de londres': {
    url: 'https://www.viator.com/tours/London/Tower-of-London-Ticket/d737-5765TOWER',
    price: 35,
  },
  'buckingham palace': {
    url: 'https://www.viator.com/tours/London/Buckingham-Palace-Tour/d737-5765BUCKINGHAM',
    price: 30,
  },
  'westminster abbey': {
    url: 'https://www.viator.com/tours/London/Westminster-Abbey-Tour/d737-5765WESTMINSTER',
    price: 27,
  },
  'british museum': {
    url: 'https://www.viator.com/tours/London/British-Museum-Guided-Tour/d737-5765BRITISHMUSEUM',
    price: 29,
  },
  'london eye': {
    url: 'https://www.viator.com/tours/London/London-Eye-Standard-Ticket/d737-5765LONDONEYE',
    price: 34,
  },
  'big ben': {
    url: 'https://www.viator.com/tours/London/Houses-of-Parliament-and-Big-Ben-Tour/d737-5765BIGBEN',
    price: 35,
  },
  "st paul's cathedral": {
    url: 'https://www.viator.com/tours/London/St-Pauls-Cathedral-Admission-Ticket/d737-5765STPAULS',
    price: 23,
  },
  'tower bridge': {
    url: 'https://www.viator.com/tours/London/Tower-Bridge-Exhibition-Ticket/d737-5765TOWERBRIDGE',
    price: 13,
  },

  // ===== AMSTERDAM =====
  'anne frank house': {
    url: 'https://www.viator.com/tours/Amsterdam/Anne-Frank-Walking-Tour/d525-5765ANNEFRANK',
    price: 29,
  },
  'maison anne frank': {
    url: 'https://www.viator.com/tours/Amsterdam/Anne-Frank-Walking-Tour/d525-5765ANNEFRANK',
    price: 29,
  },
  'rijksmuseum': {
    url: 'https://www.viator.com/tours/Amsterdam/Skip-the-Line-Rijksmuseum-Admission/d525-5765RIJKS',
    price: 22,
  },
  'van gogh museum': {
    url: 'https://www.viator.com/tours/Amsterdam/Skip-the-Line-Van-Gogh-Museum-Admission/d525-5765VANGOGH',
    price: 22,
  },
  'musée van gogh': {
    url: 'https://www.viator.com/tours/Amsterdam/Skip-the-Line-Van-Gogh-Museum-Admission/d525-5765VANGOGH',
    price: 22,
  },
  'canal cruise amsterdam': {
    url: 'https://www.viator.com/tours/Amsterdam/Amsterdam-Canal-Cruise/d525-5765CANAL',
    price: 16,
  },
  'keukenhof': {
    url: 'https://www.viator.com/tours/Amsterdam/Keukenhof-Gardens-and-Tulip-Fields-Tour/d525-5765KEUKENHOF',
    price: 59,
  },

  // ===== VENICE =====
  "st mark's basilica": {
    url: 'https://www.viator.com/tours/Venice/Skip-the-Line-St-Marks-Basilica-Tour/d773-5765STMARKS',
    price: 39,
  },
  'basilique saint-marc': {
    url: 'https://www.viator.com/tours/Venice/Skip-the-Line-St-Marks-Basilica-Tour/d773-5765STMARKS',
    price: 39,
  },
  "doge's palace": {
    url: 'https://www.viator.com/tours/Venice/Skip-the-Line-Doges-Palace-Tour/d773-5765DOGES',
    price: 45,
  },
  'palais des doges': {
    url: 'https://www.viator.com/tours/Venice/Skip-the-Line-Doges-Palace-Tour/d773-5765DOGES',
    price: 45,
  },
  'murano': {
    url: 'https://www.viator.com/tours/Venice/Murano-Burano-and-Torcello-Islands-Tour/d773-5765MURANO',
    price: 25,
  },
  'burano': {
    url: 'https://www.viator.com/tours/Venice/Murano-Burano-and-Torcello-Islands-Tour/d773-5765MURANO',
    price: 25,
  },
  'gondola ride': {
    url: 'https://www.viator.com/tours/Venice/Venice-Gondola-Ride/d773-5765GONDOLA',
    price: 33,
  },
  'rialto bridge': {
    url: 'https://www.viator.com/tours/Venice/Venice-Walking-Tour-and-Gondola-Ride/d773-5765RIALTO',
    price: 45,
  },

  // ===== FLORENCE =====
  'uffizi gallery': {
    url: 'https://www.viator.com/tours/Florence/Skip-the-Line-Uffizi-Gallery-Tour/d519-5765UFFIZI',
    price: 55,
  },
  'galerie des offices': {
    url: 'https://www.viator.com/tours/Florence/Skip-the-Line-Uffizi-Gallery-Tour/d519-5765UFFIZI',
    price: 55,
  },
  'accademia gallery': {
    url: 'https://www.viator.com/tours/Florence/Skip-the-Line-Accademia-Gallery-Tour/d519-5765ACCADEMIA',
    price: 49,
  },
  'david michelangelo': {
    url: 'https://www.viator.com/tours/Florence/Skip-the-Line-Accademia-Gallery-Tour/d519-5765ACCADEMIA',
    price: 49,
  },
  'duomo florence': {
    url: 'https://www.viator.com/tours/Florence/Skip-the-Line-Florence-Duomo-Dome-Climb/d519-5765DUOMO',
    price: 35,
  },
  'ponte vecchio': {
    url: 'https://www.viator.com/tours/Florence/Florence-Walking-Tour-with-Accademia/d519-5765WALKING',
    price: 39,
  },
};

/**
 * Cherche une URL Viator connue pour une activité
 * @param activityName Nom de l'activité à chercher
 * @returns URL Viator et prix si trouvé, null sinon
 */
export function findKnownViatorProduct(
  activityName: string
): { url: string; price: number; title: string } | null {
  const searchName = activityName.toLowerCase().trim();

  // Chercher une correspondance exacte ou partielle
  for (const [keyword, data] of Object.entries(KNOWN_VIATOR_PRODUCTS)) {
    // Match exact ou si le nom de l'activité contient le keyword
    if (searchName.includes(keyword) || keyword.includes(searchName)) {
      console.log(`[Viator Known] ✅ Match trouvé: "${activityName}" → "${keyword}"`);
      return {
        url: data.url,
        price: data.price || 0,
        title: activityName,
      };
    }
  }

  return null;
}
