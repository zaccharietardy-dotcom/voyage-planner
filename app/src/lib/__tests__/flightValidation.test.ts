/**
 * Tests de validation des vols RÉELS
 *
 * RÈGLE CRITIQUE: Le système NE DOIT PAS proposer de faux vols.
 * Si aucun vol réel n'est trouvé, une liste vide doit être retournée.
 *
 * Ces tests BLOQUENT si les vols ne sont pas valides.
 */

// Tests use Jest (not Vitest)

// Patterns de numéros de vol par compagnie aérienne
// Format: XX1234 où XX = code IATA compagnie
const AIRLINE_PATTERNS: Record<string, { codeLength: number; maxFlightNum: number }> = {
  // Compagnies européennes
  'AF': { codeLength: 2, maxFlightNum: 9999 },  // Air France
  'IB': { codeLength: 2, maxFlightNum: 9999 },  // Iberia
  'VY': { codeLength: 2, maxFlightNum: 9999 },  // Vueling
  'LH': { codeLength: 2, maxFlightNum: 9999 },  // Lufthansa
  'BA': { codeLength: 2, maxFlightNum: 9999 },  // British Airways
  'KL': { codeLength: 2, maxFlightNum: 9999 },  // KLM
  'AZ': { codeLength: 2, maxFlightNum: 9999 },  // ITA Airways (ex Alitalia)
  'FR': { codeLength: 2, maxFlightNum: 9999 },  // Ryanair
  'U2': { codeLength: 2, maxFlightNum: 9999 },  // EasyJet
  'TP': { codeLength: 2, maxFlightNum: 9999 },  // TAP Portugal
  'SN': { codeLength: 2, maxFlightNum: 9999 },  // Brussels Airlines
  'OS': { codeLength: 2, maxFlightNum: 9999 },  // Austrian
  'LX': { codeLength: 2, maxFlightNum: 9999 },  // Swiss
  'SK': { codeLength: 2, maxFlightNum: 9999 },  // SAS
  'A3': { codeLength: 2, maxFlightNum: 9999 },  // Aegean
  'UX': { codeLength: 2, maxFlightNum: 9999 },  // Air Europa
  'I2': { codeLength: 2, maxFlightNum: 9999 },  // Iberia Express
  'YW': { codeLength: 2, maxFlightNum: 9999 },  // Air Nostrum
  'NT': { codeLength: 2, maxFlightNum: 9999 },  // Binter Canarias
  'PC': { codeLength: 2, maxFlightNum: 9999 },  // Pegasus
  'XK': { codeLength: 2, maxFlightNum: 9999 },  // Air Corsica
  'EN': { codeLength: 2, maxFlightNum: 9999 },  // Air Dolomiti
  'BT': { codeLength: 2, maxFlightNum: 9999 },  // Air Baltic
  'OA': { codeLength: 2, maxFlightNum: 9999 },  // Olympic Air
  'FB': { codeLength: 2, maxFlightNum: 9999 },  // Bulgaria Air
  'JU': { codeLength: 2, maxFlightNum: 9999 },  // Air Serbia
  'OU': { codeLength: 2, maxFlightNum: 9999 },  // Croatia Airlines
  'OK': { codeLength: 2, maxFlightNum: 9999 },  // Czech Airlines
  'LO': { codeLength: 2, maxFlightNum: 9999 },  // LOT Polish
  'RO': { codeLength: 2, maxFlightNum: 9999 },  // TAROM
  'EI': { codeLength: 2, maxFlightNum: 9999 },  // Aer Lingus
  'AY': { codeLength: 2, maxFlightNum: 9999 },  // Finnair
  'BV': { codeLength: 2, maxFlightNum: 9999 },  // Blue Panorama
  'NO': { codeLength: 2, maxFlightNum: 9999 },  // Neos
  'XR': { codeLength: 2, maxFlightNum: 9999 },  // Corendon Airlines Europe
  'D8': { codeLength: 2, maxFlightNum: 9999 },  // Norwegian
  'DY': { codeLength: 2, maxFlightNum: 9999 },  // Norwegian Air Shuttle
  // Low-cost
  'W6': { codeLength: 2, maxFlightNum: 9999 },  // Wizz Air
  'V7': { codeLength: 2, maxFlightNum: 9999 },  // Volotea
  'TO': { codeLength: 2, maxFlightNum: 9999 },  // Transavia France
  'HV': { codeLength: 2, maxFlightNum: 9999 },  // Transavia
  'LS': { codeLength: 2, maxFlightNum: 9999 },  // Jet2
  'BE': { codeLength: 2, maxFlightNum: 9999 },  // Flybe
  'DS': { codeLength: 2, maxFlightNum: 9999 },  // EasyJet Switzerland
  // Internationales
  'EK': { codeLength: 2, maxFlightNum: 9999 },  // Emirates
  'QR': { codeLength: 2, maxFlightNum: 9999 },  // Qatar Airways
  'TK': { codeLength: 2, maxFlightNum: 9999 },  // Turkish Airlines
  'EY': { codeLength: 2, maxFlightNum: 9999 },  // Etihad
  'AA': { codeLength: 2, maxFlightNum: 9999 },  // American Airlines
  'UA': { codeLength: 2, maxFlightNum: 9999 },  // United
  'DL': { codeLength: 2, maxFlightNum: 9999 },  // Delta
  'AC': { codeLength: 2, maxFlightNum: 9999 },  // Air Canada
  'CX': { codeLength: 2, maxFlightNum: 9999 },  // Cathay Pacific
  'SQ': { codeLength: 2, maxFlightNum: 9999 },  // Singapore Airlines
  'QF': { codeLength: 2, maxFlightNum: 9999 },  // Qantas
  'NH': { codeLength: 2, maxFlightNum: 9999 },  // ANA
  'JL': { codeLength: 2, maxFlightNum: 9999 },  // Japan Airlines
  'CA': { codeLength: 2, maxFlightNum: 9999 },  // Air China
  'CZ': { codeLength: 2, maxFlightNum: 9999 },  // China Southern
  'MU': { codeLength: 2, maxFlightNum: 9999 },  // China Eastern
  'AI': { codeLength: 2, maxFlightNum: 9999 },  // Air India
  'SV': { codeLength: 2, maxFlightNum: 9999 },  // Saudia
  'GF': { codeLength: 2, maxFlightNum: 9999 },  // Gulf Air
  'WY': { codeLength: 2, maxFlightNum: 9999 },  // Oman Air
  'MS': { codeLength: 2, maxFlightNum: 9999 },  // EgyptAir
  'AT': { codeLength: 2, maxFlightNum: 9999 },  // Royal Air Maroc
  'ET': { codeLength: 2, maxFlightNum: 9999 },  // Ethiopian
  'SA': { codeLength: 2, maxFlightNum: 9999 },  // South African
  'KE': { codeLength: 2, maxFlightNum: 9999 },  // Korean Air
  'OZ': { codeLength: 2, maxFlightNum: 9999 },  // Asiana
  'TG': { codeLength: 2, maxFlightNum: 9999 },  // Thai Airways
  'MH': { codeLength: 2, maxFlightNum: 9999 },  // Malaysia Airlines
  'GA': { codeLength: 2, maxFlightNum: 9999 },  // Garuda Indonesia
  'BR': { codeLength: 2, maxFlightNum: 9999 },  // EVA Air
  'CI': { codeLength: 2, maxFlightNum: 9999 },  // China Airlines
  'PR': { codeLength: 2, maxFlightNum: 9999 },  // Philippine Airlines
  'VN': { codeLength: 2, maxFlightNum: 9999 },  // Vietnam Airlines
};

// Codes IATA d'aéroports valides (les plus courants en Europe)
const VALID_AIRPORT_CODES = new Set([
  // France
  'CDG', 'ORY', 'LYS', 'NCE', 'MRS', 'TLS', 'BOD', 'NTE', 'STR',
  // Espagne
  'MAD', 'BCN', 'PMI', 'AGP', 'ALC', 'VLC', 'SVQ', 'BIO', 'IBZ',
  // Italie
  'FCO', 'MXP', 'LIN', 'VCE', 'NAP', 'BGY', 'BLQ', 'FLR', 'PSA',
  // Allemagne
  'FRA', 'MUC', 'BER', 'DUS', 'HAM', 'CGN', 'STR',
  // Royaume-Uni
  'LHR', 'LGW', 'STN', 'LTN', 'MAN', 'EDI', 'BHX',
  // Portugal
  'LIS', 'OPO', 'FAO',
  // Pays-Bas
  'AMS',
  // Belgique
  'BRU', 'CRL',
  // Grèce
  'ATH', 'SKG', 'HER', 'RHO', 'JTR', 'JMK',
  // Autres
  'ZRH', 'VIE', 'PRG', 'WAW', 'BUD', 'CPH', 'ARN', 'OSL', 'HEL',
]);

/**
 * Valide qu'un numéro de vol est au format correct
 */
function isValidFlightNumber(flightNumber: string): { valid: boolean; reason: string } {
  if (!flightNumber || flightNumber.length < 3) {
    return { valid: false, reason: 'Numéro de vol trop court' };
  }

  // Extraire le code compagnie (2 caractères)
  const airlineCode = flightNumber.substring(0, 2).toUpperCase();
  const flightNum = flightNumber.substring(2);

  // Vérifier que le code compagnie est connu
  if (!AIRLINE_PATTERNS[airlineCode]) {
    return { valid: false, reason: `Code compagnie inconnu: ${airlineCode}` };
  }

  // Vérifier que le numéro de vol est un nombre
  const numericPart = parseInt(flightNum, 10);
  if (isNaN(numericPart) || numericPart <= 0) {
    return { valid: false, reason: `Numéro de vol invalide: ${flightNum}` };
  }

  // Vérifier la plage du numéro
  const pattern = AIRLINE_PATTERNS[airlineCode];
  if (numericPart > pattern.maxFlightNum) {
    return { valid: false, reason: `Numéro de vol hors plage: ${numericPart}` };
  }

  return { valid: true, reason: 'OK' };
}

/**
 * Valide qu'un code aéroport est au format IATA valide
 */
function isValidAirportCode(code: string): boolean {
  if (!code || code.length !== 3) return false;
  return /^[A-Z]{3}$/.test(code.toUpperCase());
}

/**
 * Valide qu'un code aéroport existe dans notre liste connue
 */
function isKnownAirportCode(code: string): boolean {
  return VALID_AIRPORT_CODES.has(code.toUpperCase());
}

/**
 * Valide qu'une URL de réservation est spécifique au vol
 */
function isSpecificBookingUrl(url: string, flightNumber: string): { valid: boolean; reason: string } {
  if (!url) {
    return { valid: false, reason: 'URL de réservation manquante' };
  }

  // L'URL doit contenir le numéro de vol ou les codes aéroports
  const urlLower = url.toLowerCase();
  const flightLower = flightNumber.toLowerCase();

  // Vérifier que l'URL contient des informations spécifiques
  if (urlLower.includes(flightLower) ||
      urlLower.includes(flightNumber.substring(0, 2).toLowerCase())) {
    return { valid: true, reason: 'OK - URL contient le numéro de vol' };
  }

  // Vérifier que ce n'est pas une URL générique
  const genericPatterns = [
    'google.com/travel/flights?',
    'skyscanner.com/?',
    'kayak.com/?',
  ];

  // URL générique sans paramètres de vol = invalide
  const isGeneric = genericPatterns.some(pattern => {
    const idx = urlLower.indexOf(pattern);
    if (idx === -1) return false;
    // Vérifier s'il y a des paramètres après
    const afterPattern = url.substring(idx + pattern.length);
    return afterPattern.length < 10; // URL trop courte = pas de paramètres
  });

  if (isGeneric) {
    return { valid: false, reason: 'URL générique sans paramètres spécifiques' };
  }

  return { valid: true, reason: 'OK - URL contient des paramètres de recherche' };
}

/**
 * Interface pour un vol à valider
 */
interface FlightToValidate {
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  bookingUrl?: string;
  airline?: string;
}

/**
 * Validation complète d'un vol
 * BLOQUE si le vol n'est pas valide
 */
function validateFlight(flight: FlightToValidate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Valider le numéro de vol
  const flightNumValidation = isValidFlightNumber(flight.flightNumber);
  if (!flightNumValidation.valid) {
    errors.push(`❌ Numéro de vol: ${flightNumValidation.reason}`);
  }

  // 2. Valider le code aéroport de départ
  if (!isValidAirportCode(flight.departureAirportCode)) {
    errors.push(`❌ Code départ invalide: "${flight.departureAirportCode}"`);
  } else if (!isKnownAirportCode(flight.departureAirportCode)) {
    errors.push(`⚠️ Code départ inconnu: "${flight.departureAirportCode}" (peut être valide)`);
  }

  // 3. Valider le code aéroport d'arrivée
  if (!isValidAirportCode(flight.arrivalAirportCode)) {
    errors.push(`❌ Code arrivée invalide: "${flight.arrivalAirportCode}"`);
  } else if (!isKnownAirportCode(flight.arrivalAirportCode)) {
    errors.push(`⚠️ Code arrivée inconnu: "${flight.arrivalAirportCode}" (peut être valide)`);
  }

  // 4. Valider l'URL de réservation si présente
  if (flight.bookingUrl) {
    const urlValidation = isSpecificBookingUrl(flight.bookingUrl, flight.flightNumber);
    if (!urlValidation.valid) {
      errors.push(`❌ URL de réservation: ${urlValidation.reason}`);
    }
  }

  // Un vol est valide seulement s'il n'y a pas d'erreurs critiques (❌)
  const hasErrors = errors.some(e => e.startsWith('❌'));

  return { valid: !hasErrors, errors };
}

// ============= TESTS =============

describe('Flight Validation - BLOCKING TESTS', () => {

  describe('Validation du format des numéros de vol', () => {
    it('devrait accepter un numéro de vol Vueling valide (VY8005)', () => {
      const result = isValidFlightNumber('VY8005');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter un numéro de vol Air France valide (AF1234)', () => {
      const result = isValidFlightNumber('AF1234');
      expect(result.valid).toBe(true);
    });

    it('devrait accepter un numéro de vol Iberia valide (IB5043)', () => {
      const result = isValidFlightNumber('IB5043');
      expect(result.valid).toBe(true);
    });

    it('devrait rejeter un numéro avec code compagnie inconnu', () => {
      const result = isValidFlightNumber('XX1234');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('inconnu');
    });

    it('devrait rejeter un numéro sans partie numérique', () => {
      const result = isValidFlightNumber('AFABC');
      expect(result.valid).toBe(false);
    });

    it('devrait rejeter un numéro trop court', () => {
      const result = isValidFlightNumber('AF');
      expect(result.valid).toBe(false);
    });

    it('devrait rejeter un numéro vide', () => {
      const result = isValidFlightNumber('');
      expect(result.valid).toBe(false);
    });
  });

  describe('Validation des codes aéroports', () => {
    it('devrait accepter CDG (Paris Charles de Gaulle)', () => {
      expect(isValidAirportCode('CDG')).toBe(true);
      expect(isKnownAirportCode('CDG')).toBe(true);
    });

    it('devrait accepter BCN (Barcelona)', () => {
      expect(isValidAirportCode('BCN')).toBe(true);
      expect(isKnownAirportCode('BCN')).toBe(true);
    });

    it('devrait accepter FCO (Rome Fiumicino)', () => {
      expect(isValidAirportCode('FCO')).toBe(true);
      expect(isKnownAirportCode('FCO')).toBe(true);
    });

    it('devrait rejeter un code invalide (AB)', () => {
      expect(isValidAirportCode('AB')).toBe(false);
    });

    it('devrait rejeter un code avec chiffres', () => {
      expect(isValidAirportCode('A12')).toBe(false);
    });

    it('devrait accepter un code valide mais inconnu (format OK)', () => {
      expect(isValidAirportCode('XYZ')).toBe(true);
      expect(isKnownAirportCode('XYZ')).toBe(false);
    });
  });

  describe('Validation des URLs de réservation', () => {
    it('devrait accepter une URL avec le numéro de vol', () => {
      const result = isSpecificBookingUrl(
        'https://www.google.com/travel/flights?q=VY8005%20CDG%20BCN%202024-06-15&curr=EUR',
        'VY8005'
      );
      expect(result.valid).toBe(true);
    });

    it('devrait accepter une URL avec des paramètres de recherche', () => {
      const result = isSpecificBookingUrl(
        'https://www.skyscanner.com/transport/flights/cdg/bcn/240615/?adults=2',
        'AF1234'
      );
      expect(result.valid).toBe(true);
    });

    it('devrait rejeter une URL vide', () => {
      const result = isSpecificBookingUrl('', 'VY8005');
      expect(result.valid).toBe(false);
    });
  });

  describe('Validation complète d\'un vol', () => {
    it('devrait valider un vol Vueling Paris-Barcelone complet', () => {
      const flight: FlightToValidate = {
        flightNumber: 'VY8005',
        departureAirportCode: 'CDG',
        arrivalAirportCode: 'BCN',
        bookingUrl: 'https://www.google.com/travel/flights?q=VY8005%20CDG%20BCN',
        airline: 'VY',
      };

      const result = validateFlight(flight);
      expect(result.valid).toBe(true);
      expect(result.errors.filter(e => e.startsWith('❌'))).toHaveLength(0);
    });

    it('devrait valider un vol Air France Paris-Rome complet', () => {
      const flight: FlightToValidate = {
        flightNumber: 'AF1404',
        departureAirportCode: 'CDG',
        arrivalAirportCode: 'FCO',
        bookingUrl: 'https://www.google.com/travel/flights?q=AF1404%20CDG%20FCO',
        airline: 'AF',
      };

      const result = validateFlight(flight);
      expect(result.valid).toBe(true);
    });

    it('devrait rejeter un vol avec numéro invalide', () => {
      const flight: FlightToValidate = {
        flightNumber: 'FAKE123',
        departureAirportCode: 'CDG',
        arrivalAirportCode: 'BCN',
      };

      const result = validateFlight(flight);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Numéro de vol'))).toBe(true);
    });

    it('devrait rejeter un vol avec code aéroport invalide', () => {
      const flight: FlightToValidate = {
        flightNumber: 'AF1234',
        departureAirportCode: 'XX',
        arrivalAirportCode: 'BCN',
      };

      const result = validateFlight(flight);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Code départ'))).toBe(true);
    });

    it('devrait rejeter un vol "undefined"', () => {
      const flight: FlightToValidate = {
        flightNumber: 'undefined',
        departureAirportCode: 'CDG',
        arrivalAirportCode: 'BCN',
      };

      const result = validateFlight(flight);
      expect(result.valid).toBe(false);
    });
  });
});

// Export pour utilisation dans d'autres fichiers
export { validateFlight, isValidFlightNumber, isValidAirportCode, isKnownAirportCode, isSpecificBookingUrl };
export type { FlightToValidate };
