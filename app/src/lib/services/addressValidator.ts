/**
 * Service de validation des adresses (Bug #4)
 *
 * Exigences:
 * - Les activités DOIVENT avoir des adresses exactes (pas juste "Barcelona")
 * - Les itinéraires doivent afficher les adresses complètes
 * - Les adresses doivent inclure nom de rue et numéro
 */

/**
 * Longueur minimale pour une adresse valide
 */
export const MIN_ADDRESS_LENGTH = 5;

/**
 * Mots génériques qui ne constituent pas une adresse valide
 */
const GENERIC_LOCATIONS = [
  'centre-ville',
  'city center',
  'downtown',
  'centro',
  'centre',
  'center',
];

/**
 * Interface pour une activité avec adresse
 */
export interface ActivityWithAddress {
  name: string;
  address?: string;
  city?: string;
}

/**
 * Résultat de validation d'adresse
 */
export interface AddressValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Composants extraits d'une adresse
 */
export interface AddressComponents {
  street: string;
  number?: string;
  city?: string;
}

/**
 * Vérifie si une adresse est valide (pas générique, assez longue)
 */
export function isValidAddress(address: string | null | undefined): boolean {
  // Null/undefined check
  if (address === null || address === undefined) {
    return false;
  }

  // Longueur minimale
  if (address.length < MIN_ADDRESS_LENGTH) {
    return false;
  }

  const normalized = address.toLowerCase().trim();

  // Rejeter les locations génériques seules
  for (const generic of GENERIC_LOCATIONS) {
    if (normalized === generic) {
      return false;
    }
  }

  // Rejeter si c'est juste un nom de ville (un seul mot sans numéro)
  const words = normalized.split(/[\s,]+/).filter(w => w.length > 0);
  if (words.length === 1) {
    return false;
  }

  // Une adresse valide doit avoir plus qu'un simple nom de ville
  // Vérifie qu'il y a au moins un chiffre ou plusieurs mots significatifs
  const hasNumber = /\d/.test(address);
  const hasMultipleWords = words.length >= 2;

  return hasNumber || hasMultipleWords;
}

/**
 * Valide qu'une activité a une adresse exacte
 */
export function validateActivityAddress(activity: ActivityWithAddress): AddressValidationResult {
  const { name, address, city } = activity;

  // Pas d'adresse du tout
  if (!address || address.trim() === '') {
    return {
      valid: false,
      error: `Activity "${name}" requires an exact address`,
    };
  }

  // Adresse trop courte
  if (address.length < MIN_ADDRESS_LENGTH) {
    return {
      valid: false,
      error: `Activity "${name}" requires an exact address (too short)`,
    };
  }

  const normalized = address.toLowerCase().trim();

  // Vérifier si c'est une location générique
  for (const generic of GENERIC_LOCATIONS) {
    if (normalized.includes(generic)) {
      return {
        valid: false,
        error: `Activity "${name}" requires an exact address, not a generic location`,
      };
    }
  }

  // Vérifier si c'est juste le nom de la ville
  if (city && normalized === city.toLowerCase().trim()) {
    return {
      valid: false,
      error: `Activity "${name}" requires an exact address, not just the city name`,
    };
  }

  // Vérifier qu'il y a plus qu'un seul mot
  const words = normalized.split(/[\s,]+/).filter(w => w.length > 0);
  if (words.length === 1) {
    return {
      valid: false,
      error: `Activity "${name}" requires an exact address with street name`,
    };
  }

  return { valid: true };
}

/**
 * Formate une activité avec son adresse entre parenthèses
 */
export function formatActivityWithAddress(activity: { name: string; address?: string }): string {
  const { name, address } = activity;

  if (!address || address.trim() === '') {
    return name;
  }

  return `${name} (${address})`;
}

/**
 * Extrait les composants d'une adresse (rue, numéro, ville)
 */
export function extractAddressComponents(address: string): AddressComponents {
  if (!address || address.trim() === '') {
    return { street: '', number: undefined, city: undefined };
  }

  const trimmed = address.trim();

  // Séparer par virgule pour obtenir les parties
  const parts = trimmed.split(',').map(p => p.trim());

  if (parts.length === 0) {
    return { street: '', number: undefined, city: undefined };
  }

  // La dernière partie est généralement la ville
  let city: string | undefined;
  let streetPart: string;

  if (parts.length >= 2) {
    // Dernière partie = ville (ou partie de ville)
    city = parts[parts.length - 1];

    // Si plusieurs parties avant la ville, les joindre pour street
    if (parts.length > 2) {
      // Joindre toutes les parties sauf la première pour la ville
      city = parts.slice(1).join(', ');
    }

    streetPart = parts[0];
  } else {
    streetPart = parts[0];
    city = undefined;
  }

  // Extraire le numéro de la rue
  // Pattern: "Street Name 123" ou "Street Name 123-456"
  const numberMatch = streetPart.match(/(\d+(?:-\d+)?)\s*$/);

  let street: string;
  let number: string | undefined;

  if (numberMatch) {
    number = numberMatch[1];
    street = streetPart.slice(0, numberMatch.index).trim();
  } else {
    street = streetPart;
    number = undefined;
  }

  return { street, number, city };
}
