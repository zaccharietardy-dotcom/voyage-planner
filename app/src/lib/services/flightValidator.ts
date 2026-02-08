/**
 * Validation des numéros de vol
 *
 * Ce module exporte des fonctions pour valider que les vols sont réels
 * et bloque les faux vols avant qu'ils n'arrivent à l'utilisateur.
 */

// Codes IATA des compagnies aériennes connues
const KNOWN_AIRLINES = new Set([
  // Europe
  'AF', 'IB', 'VY', 'LH', 'BA', 'KL', 'AZ', 'FR', 'U2', 'TP', 'SN', 'OS', 'LX', 'SK', 'A3',
  'UX', 'I2', 'YW', 'NT', 'PC', 'XK', 'EN', 'BT', 'OA', 'FB', 'JU', 'OU', 'OK', 'LO', 'RO',
  'EI', 'AY', 'BV', 'NO', 'XR', 'D8', 'DY',
  // Low-cost
  'W6', 'V7', 'TO', 'HV', 'LS', 'BE', 'DS',
  // Internationales
  'EK', 'QR', 'TK', 'EY', 'AA', 'UA', 'DL', 'AC', 'CX', 'SQ', 'QF', 'NH', 'JL',
  'CA', 'CZ', 'MU', 'AI', 'SV', 'GF', 'WY', 'MS', 'AT', 'ET', 'SA', 'KE', 'OZ',
  'TG', 'MH', 'GA', 'BR', 'CI', 'PR', 'VN',
]);

/**
 * Valide qu'un numéro de vol est au format correct
 * @param flightNumber Le numéro de vol (ex: VY8005, AF1234)
 * @returns true si le format est valide
 */
export function validateFlightNumber(flightNumber: string): boolean {
  if (!flightNumber || flightNumber.length < 3) {
    return false;
  }

  // Cas spéciaux à rejeter (fallbacks des APIs)
  const invalidValues = ['undefined', 'null', 'MOCK', 'N/A', 'UNKNOWN', 'NA', ''];
  if (invalidValues.includes(flightNumber) || invalidValues.includes(flightNumber.toUpperCase())) {
    console.warn(`[FlightValidator] Numéro de vol invalide rejeté: "${flightNumber}"`);
    return false;
  }

  // Extraire le code compagnie (2 caractères)
  const airlineCode = flightNumber.substring(0, 2).toUpperCase();
  const flightNum = flightNumber.substring(2);

  // Vérifier que le code compagnie est connu
  if (!KNOWN_AIRLINES.has(airlineCode)) {
    console.warn(`[FlightValidator] Code compagnie inconnu: ${airlineCode}`);
    return false;
  }

  // Vérifier que le numéro de vol est un nombre valide
  const numericPart = parseInt(flightNum, 10);
  if (isNaN(numericPart) || numericPart <= 0 || numericPart > 9999) {
    console.warn(`[FlightValidator] Numéro de vol invalide: ${flightNum}`);
    return false;
  }

  return true;
}

/**
 * Valide qu'un code aéroport est au format IATA (3 lettres majuscules)
 */
export function validateAirportCode(code: string): boolean {
  if (!code || code.length !== 3) return false;
  return /^[A-Z]{3}$/.test(code.toUpperCase());
}

/**
 * Filtre une liste de vols pour ne garder que les vols valides
 */
export function filterValidFlights<T extends { flightNumber: string; departureAirportCode: string; arrivalAirportCode: string }>(
  flights: T[]
): T[] {
  return flights.filter(flight => {
    const isFlightValid = validateFlightNumber(flight.flightNumber);
    const isDepValid = validateAirportCode(flight.departureAirportCode);
    const isArrValid = validateAirportCode(flight.arrivalAirportCode);

    if (!isFlightValid || !isDepValid || !isArrValid) {
      return false;
    }

    return true;
  });
}
