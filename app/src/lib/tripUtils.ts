import { BudgetLevel, Accommodation } from './types';
import { generateHotelLink, formatDateForUrl } from './services/linkGenerator';

/**
 * Génère l'URL de réservation pour un hébergement.
 * Préserve le bookingUrl natif (ex: Airbnb) s'il existe, sinon génère un lien Booking.com.
 */
export function getAccommodationBookingUrl(
  accom: Accommodation | null | undefined,
  destination: string,
  checkIn: string | Date,
  checkOut: string | Date,
): string | undefined {
  if (!accom?.name) return undefined;
  // Préserver le lien Airbnb natif s'il existe
  if (accom.bookingUrl && (accom.bookingUrl.includes('airbnb') || accom.type === 'apartment')) {
    return accom.bookingUrl;
  }
  return generateHotelLink(
    { name: accom.name, city: destination },
    { checkIn: formatDateForUrl(checkIn), checkOut: formatDateForUrl(checkOut) },
  );
}

/**
 * Choisit le mode de direction Google Maps en fonction de la distance
 * Walking si < 1.5km, transit si < 15km, driving sinon
 */
export function pickDirectionMode(from: { lat: number; lng: number }, to: { lat: number; lng: number }): 'walking' | 'transit' | 'driving' {
  const R = 6371; // km
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (dist < 1.5) return 'walking';
  if (dist < 15) return 'transit';
  return 'driving';
}

// Génère un ID unique
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Normalise une date pour éviter les problèmes de timezone
 * Convertit une date ISO (potentiellement en UTC) en date locale à midi
 * Ex: "2026-01-27T23:00:00.000Z" (UTC) → 27 janvier 12:00 local (pas le 28!)
 */
export function normalizeToLocalDate(dateInput: Date | string): Date {
  let dateStr: string;

  if (typeof dateInput === 'string') {
    // Si c'est une string ISO, extraire YYYY-MM-DD
    dateStr = dateInput.split('T')[0];
  } else {
    // Si c'est un objet Date, utiliser toISOString pour avoir YYYY-MM-DD
    // MAIS on veut la date LOCALE, pas UTC
    const year = dateInput.getFullYear();
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const day = String(dateInput.getDate()).padStart(2, '0');
    dateStr = `${year}-${month}-${day}`;
  }

  // Créer une date locale à midi pour éviter les problèmes de timezone
  const [year, month, day] = dateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day, 12, 0, 0, 0);

  return localDate;
}

// ============================================
// Fonctions utilitaires
// ============================================

export function formatDate(date: Date): string {
  // IMPORTANT: Utiliser getFullYear/Month/Date pour la date LOCALE
  // et non toISOString() qui convertit en UTC et peut décaler d'un jour
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatPriceLevel(level: 1 | 2 | 3 | 4): string {
  return '€'.repeat(level);
}

/**
 * Retourne le locationName pour un hôtel
 * Si l'adresse est disponible et valide, l'utiliser
 * Sinon, utiliser "Nom de l'hôtel, Ville" pour que Google Maps trouve le lieu
 */
export function getHotelLocationName(
  accommodation: { name?: string; address?: string } | null,
  destination: string
): string {
  // Si l'adresse existe et n'est pas le placeholder "Adresse non disponible"
  if (accommodation?.address &&
      !accommodation.address.toLowerCase().includes('non disponible') &&
      !accommodation.address.toLowerCase().includes('not available')) {
    return accommodation.address;
  }

  // Sinon utiliser le nom de l'hôtel + ville pour que Google Maps trouve
  if (accommodation?.name) {
    return `${accommodation.name}, ${destination}`;
  }

  // Fallback ultime
  return `Hébergement, ${destination}`;
}

export function getBudgetCabinClass(budgetLevel?: BudgetLevel): 'economy' | 'premium_economy' | 'business' | 'first' {
  switch (budgetLevel) {
    case 'luxury': return 'business';
    case 'comfort': return 'premium_economy';
    default: return 'economy';
  }
}

/**
 * Génère un lien Google Maps fiable pour un restaurant
 * Priorité: googleMapsUrl existante > place_id > nom + ville (plus fiable que nom + adresse incomplète)
 */
export function getReliableGoogleMapsPlaceUrl(
  restaurant: { name: string; address?: string; googleMapsUrl?: string } | null,
  destination: string,
): string | undefined {
  if (!restaurant) return undefined;
  // Utiliser l'URL existante si disponible (souvent de SerpAPI avec place_id)
  if (restaurant.googleMapsUrl) return restaurant.googleMapsUrl;
  // Construire une URL fiable: nom + ville est plus fiable que nom + adresse partielle
  const hasRealAddress = restaurant.address && !restaurant.address.includes('non disponible');
  const searchQuery = hasRealAddress
    ? `${restaurant.name}, ${restaurant.address}`
    : `${restaurant.name}, ${destination}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
}

export function getBudgetPriceLevel(budgetLevel?: BudgetLevel): 1 | 2 | 3 | 4 {
  switch (budgetLevel) {
    case 'economic': return 1;
    case 'moderate': return 2;
    case 'comfort': return 3;
    case 'luxury': return 4;
    default: return 2;
  }
}

