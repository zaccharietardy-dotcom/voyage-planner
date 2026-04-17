/**
 * Hotel bookends — insère explicitement un passage à l'hôtel en début et
 * fin de chaque journée d'activités.
 *
 * Pourquoi : le scheduler V3 ordonne les activités mais n'injecte pas d'item
 * transport "retour hôtel" / "départ hôtel". Sur la liste ET la map, ça donne
 * l'impression que la dernière activité est le point d'arrêt, alors que le
 * voyageur dort à l'hôtel. Ces bookends explicitent le passage.
 *
 * Règles :
 *   - Premier item : si != hôtel/check-in/transport longhaul outbound et
 *     distance > 200m de l'hôtel → insérer item 'hotel_depart' avant.
 *   - Dernier item : si != hôtel/check-out/transport longhaul return et
 *     distance > 200m de l'hôtel → insérer item 'hotel_return' après.
 *   - Sauter un jour sans hôtel ni activités scorables.
 */

import type { TripDay, TripItem, Accommodation } from '@/lib/types';
import { calculateDistance } from '@/lib/services/geocoding';
import { generateGoogleMapsDirectionsLink } from '@/lib/services/linkGenerator';

const MIN_DISTANCE_FROM_HOTEL_KM = 0.2;
const WALKING_SPEED_KMH = 4.5;
const TRANSIT_SPEED_KMH = 22;
const DRIVING_SPEED_KMH = 30;

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseHHMM(time: string | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 55, Math.round(totalMinutes)));
  const rounded = Math.round(clamped / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  return calculateDistance(a.latitude, a.longitude, b.latitude, b.longitude);
}

type TransitMode = 'walking' | 'transit' | 'driving';

function pickMode(km: number): TransitMode {
  if (km < 1.2) return 'walking';
  if (km < 6) return 'transit';
  return 'driving';
}

function estimateTransferMinutes(km: number, mode: TransitMode): number {
  const speed = mode === 'walking' ? WALKING_SPEED_KMH : mode === 'transit' ? TRANSIT_SPEED_KMH : DRIVING_SPEED_KMH;
  const buffer = mode === 'walking' ? 0 : mode === 'transit' ? 5 : 2;
  return Math.max(5, Math.round((km / Math.max(1, speed)) * 60) + buffer);
}

function estimateTransferCost(km: number, mode: TransitMode): number {
  if (mode === 'walking') return 0;
  if (mode === 'transit') return km < 4 ? 2 : 3;
  return Math.max(8, Math.round(km * 1.5));
}

function isLonghaulTransport(item: TripItem): boolean {
  if (item.type !== 'flight' && item.type !== 'transport') return false;
  return item.transportRole === 'longhaul' || item.transportDirection === 'outbound' || item.transportDirection === 'return';
}

function isHotelAnchor(item: TripItem): boolean {
  return item.type === 'hotel' || item.type === 'checkin' || item.type === 'checkout';
}

function isBookendAlreadyPresent(item: TripItem, which: 'hotel_depart' | 'hotel_return'): boolean {
  return item.type === 'transport' && item.transportRole === which;
}

function findFirstRealItemIndex(items: TripItem[]): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isLonghaulTransport(it)) continue;      // skip arrival transport legs
    if (isHotelAnchor(it)) continue;             // skip hotel check-in anchor
    if (it.transportRole === 'transfer_hub') continue; // skip hub transfers
    return i;
  }
  return -1;
}

function findLastRealItemIndex(items: TripItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (isLonghaulTransport(it)) continue;
    if (isHotelAnchor(it)) continue;
    if (it.transportRole === 'transfer_hub') continue;
    return i;
  }
  return -1;
}

function buildBookendItem(args: {
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
  durationMin: number;
  mode: TransitMode;
  role: 'hotel_depart' | 'hotel_return';
  dayNumber: number;
  startTime: string;
  costEur: number;
}): TripItem {
  const { from, to, durationMin, mode, role, dayNumber, startTime, costEur } = args;
  const startMin = parseHHMM(startTime);
  const endTime = minutesToHHMM(startMin + durationMin);
  const title = role === 'hotel_depart'
    ? `Départ de l'hôtel → ${to.name}`
    : `Retour à l'hôtel (${from.name})`;
  const transportModeUi: TripItem['transportMode'] = mode === 'walking' ? 'walking' : mode === 'transit' ? 'transit' : 'taxi';
  const bookingUrl = generateGoogleMapsDirectionsLink(
    { name: from.name, lat: from.lat, lng: from.lng },
    { name: to.name, lat: to.lat, lng: to.lng },
    mode,
  );
  return {
    id: uuidv4(),
    dayNumber,
    startTime,
    endTime,
    type: 'transport',
    title,
    description: mode === 'walking' ? 'Trajet à pied' : mode === 'transit' ? 'Transports en commun' : 'Trajet en voiture/taxi',
    locationName: from.name,
    latitude: from.lat,
    longitude: from.lng,
    orderIndex: 0,
    duration: durationMin,
    estimatedCost: costEur,
    transportMode: transportModeUi,
    transportRole: role,
    transportTimeSource: 'estimated',
    bookingUrl,
    googleMapsUrl: bookingUrl,
  };
}

export interface InjectHotelBookendsOptions {
  /** si true, log chaque injection pour debug. */
  verbose?: boolean;
}

export function injectHotelBookends(
  days: TripDay[],
  hotel: Accommodation | null | undefined,
  options: InjectHotelBookendsOptions = {},
): { injected: number; skipped: number } {
  const stats = { injected: 0, skipped: 0 };
  if (!hotel || !hotel.latitude || !hotel.longitude) return stats;

  const hotelPoint = { latitude: hotel.latitude, longitude: hotel.longitude, name: hotel.name || 'Hôtel' };

  for (const day of days) {
    if (!day.items || day.items.length === 0) continue;
    const firstIdx = findFirstRealItemIndex(day.items);
    const lastIdx = findLastRealItemIndex(day.items);
    if (firstIdx === -1 || lastIdx === -1) {
      stats.skipped++;
      continue;
    }

    const firstItem = day.items[firstIdx];
    const lastItem = day.items[lastIdx];

    // ---- Début de journée : hôtel → première activité ----
    // Skip si premier item est déjà un hotel_depart ou < 200m de l'hôtel.
    // Skip aussi si il existe un item transport longhaul outbound avant (jour 1 arrivée).
    const hasArrivalBefore = day.items.slice(0, firstIdx).some(it => isLonghaulTransport(it) && it.transportDirection === 'outbound');
    const firstDistKm = distanceKm(hotelPoint, { latitude: firstItem.latitude, longitude: firstItem.longitude });
    const alreadyDepart = day.items.some(it => isBookendAlreadyPresent(it, 'hotel_depart'));

    if (!hasArrivalBefore && !alreadyDepart && firstDistKm >= MIN_DISTANCE_FROM_HOTEL_KM) {
      const mode = pickMode(firstDistKm);
      const durationMin = estimateTransferMinutes(firstDistKm, mode);
      const firstStartMin = parseHHMM(firstItem.startTime);
      const departStartMin = Math.max(0, firstStartMin - durationMin);
      const bookend = buildBookendItem({
        from: { name: hotelPoint.name, lat: hotelPoint.latitude, lng: hotelPoint.longitude },
        to: { name: firstItem.locationName || firstItem.title, lat: firstItem.latitude, lng: firstItem.longitude },
        durationMin,
        mode,
        role: 'hotel_depart',
        dayNumber: day.dayNumber,
        startTime: minutesToHHMM(departStartMin),
        costEur: estimateTransferCost(firstDistKm, mode),
      });
      day.items.splice(firstIdx, 0, bookend);
      stats.injected++;
      if (options.verbose) {
        console.log(`[hotel-bookends] Day ${day.dayNumber}: +hotel_depart → ${firstItem.title} (${firstDistKm.toFixed(1)} km, ${durationMin} min)`);
      }
    } else if (options.verbose) {
      console.log(`[hotel-bookends] Day ${day.dayNumber}: skip hotel_depart (arrival=${hasArrivalBefore}, already=${alreadyDepart}, dist=${firstDistKm.toFixed(2)} km)`);
    }

    // Recompute last index (might have shifted after insertion above)
    const lastIdxAfter = findLastRealItemIndex(day.items);
    if (lastIdxAfter === -1) continue;
    const lastItemAfter = day.items[lastIdxAfter];

    // ---- Fin de journée : dernière activité → hôtel ----
    // Skip si dernier item est checkout, transport longhaul return, ou < 200m.
    const hasReturnAfter = day.items.slice(lastIdxAfter + 1).some(it => isLonghaulTransport(it) && it.transportDirection === 'return');
    const lastDistKm = distanceKm(hotelPoint, { latitude: lastItemAfter.latitude, longitude: lastItemAfter.longitude });
    const alreadyReturn = day.items.some(it => isBookendAlreadyPresent(it, 'hotel_return'));

    if (!hasReturnAfter && !alreadyReturn && lastDistKm >= MIN_DISTANCE_FROM_HOTEL_KM) {
      const mode = pickMode(lastDistKm);
      const durationMin = estimateTransferMinutes(lastDistKm, mode);
      const lastEndMin = parseHHMM(lastItemAfter.endTime);
      const bookend = buildBookendItem({
        from: { name: lastItemAfter.locationName || lastItemAfter.title, lat: lastItemAfter.latitude, lng: lastItemAfter.longitude },
        to: { name: hotelPoint.name, lat: hotelPoint.latitude, lng: hotelPoint.longitude },
        durationMin,
        mode,
        role: 'hotel_return',
        dayNumber: day.dayNumber,
        startTime: minutesToHHMM(lastEndMin),
        costEur: estimateTransferCost(lastDistKm, mode),
      });
      day.items.splice(lastIdxAfter + 1, 0, bookend);
      stats.injected++;
      if (options.verbose) {
        console.log(`[hotel-bookends] Day ${day.dayNumber}: +hotel_return from ${lastItemAfter.title} (${lastDistKm.toFixed(1)} km, ${durationMin} min)`);
      }
    }

    // Re-index orderIndex to reflect the new array order
    day.items.forEach((item, idx) => { item.orderIndex = idx; });
  }

  return stats;
}
