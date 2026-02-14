/**
 * Analyseur de liens — validité des URLs de réservation
 */

import { Trip } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/;

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function extractDepartureDate(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('departure_date');
  } catch {
    return null;
  }
}

function toIsoDay(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function collectStringFields(input: unknown, pathPrefix: string = '', seen = new WeakSet<object>()): Array<{ path: string; value: string }> {
  if (typeof input === 'string') {
    return [{ path: pathPrefix || '$', value: input }];
  }

  if (!input || typeof input !== 'object') return [];
  if (seen.has(input as object)) return [];
  seen.add(input as object);

  if (Array.isArray(input)) {
    return input.flatMap((v, idx) => collectStringFields(v, `${pathPrefix}[${idx}]`, seen));
  }

  const obj = input as Record<string, unknown>;
  return Object.entries(obj).flatMap(([key, value]) => {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    return collectStringFields(value, nextPath, seen);
  });
}

export function analyzeLinks(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  // Vols
  if (trip.outboundFlight) {
    if (!trip.outboundFlight.bookingUrl) {
      issues.push({
        severity: 'warning',
        category: 'links',
        message: `Vol aller ${trip.outboundFlight.flightNumber}: pas de bookingUrl`,
        code: 'LINK_OUTBOUND_MISSING',
        component: 'pipeline/transport',
      });
    } else if (!isValidUrl(trip.outboundFlight.bookingUrl)) {
      issues.push({
        severity: 'critical',
        category: 'links',
        message: `Vol aller: bookingUrl invalide — "${trip.outboundFlight.bookingUrl.substring(0, 80)}..."`,
        code: 'LINK_OUTBOUND_INVALID',
        component: 'pipeline/transport',
        frequencyWeight: 1.4,
      });
    }
  }

  if (trip.returnFlight) {
    if (!trip.returnFlight.bookingUrl) {
      issues.push({
        severity: 'warning',
        category: 'links',
        message: `Vol retour ${trip.returnFlight.flightNumber}: pas de bookingUrl`,
        code: 'LINK_RETURN_MISSING',
        component: 'pipeline/transport',
      });
    } else if (!isValidUrl(trip.returnFlight.bookingUrl)) {
      issues.push({
        severity: 'critical',
        category: 'links',
        message: `Vol retour: bookingUrl invalide`,
        code: 'LINK_RETURN_INVALID',
        component: 'pipeline/transport',
        frequencyWeight: 1.4,
      });
    }
  }

  // Hébergement
  if (trip.accommodation && !trip.accommodation.bookingUrl) {
    issues.push({
      severity: 'warning',
      category: 'links',
      message: `Hébergement "${trip.accommodation.name}": pas de bookingUrl`,
      code: 'LINK_HOTEL_MISSING',
      component: 'pipeline/accommodation',
    });
  }

  // Fuite clé API dans n'importe quel champ string du payload
  const stringFields = collectStringFields(trip);
  for (const field of stringFields) {
    if (!GOOGLE_API_KEY_PATTERN.test(field.value)) continue;
    issues.push({
      severity: 'critical',
      category: 'links',
      message: `Fuite de clé API détectée dans le payload (${field.path})`,
      details: { path: field.path },
      code: 'LINK_API_KEY_LEAK',
      component: 'pipeline/security',
      frequencyWeight: 3,
      autofixCandidate: true,
    });
  }

  // Items du voyage
  for (const day of trip.days) {
    const dayIso = toIsoDay(day.date);

    for (const item of day.items) {
      // Activités sans aucun lien
      if (item.type === 'activity') {
        const hasAnyLink = item.bookingUrl || item.viatorUrl || item.googleMapsUrl || item.googleMapsPlaceUrl;
        if (!hasAnyLink) {
          issues.push({
            severity: 'info',
            category: 'links',
            message: `Jour ${day.dayNumber}: "${item.title}" n'a aucun lien (booking, viator, maps)`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'LINK_ACTIVITY_NONE',
            component: 'pipeline/links',
          });
        }
      }

      // Restaurants sans lien Google Maps
      if (item.type === 'restaurant') {
        const hasLink = item.googleMapsUrl || item.googleMapsPlaceUrl || (item.restaurant?.googleMapsUrl);
        if (!hasLink) {
          issues.push({
            severity: 'info',
            category: 'links',
            message: `Jour ${day.dayNumber}: restaurant "${item.title}" n'a pas de lien Google Maps`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'LINK_RESTAURANT_MAPS_MISSING',
            component: 'pipeline/restaurants',
          });
        }
      }

      // Vérifier la validité des URLs présentes
      const urlFields: [string, string | undefined][] = [
        ['bookingUrl', item.bookingUrl],
        ['viatorUrl', item.viatorUrl],
        ['googleMapsUrl', item.googleMapsUrl],
        ['googleMapsPlaceUrl', item.googleMapsPlaceUrl],
      ];

      for (const [fieldName, url] of urlFields) {
        if (url && !isValidUrl(url)) {
          issues.push({
            severity: 'critical',
            category: 'links',
            message: `Jour ${day.dayNumber}: "${item.title}" — ${fieldName} invalide: "${url.substring(0, 80)}"`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'LINK_ITEM_INVALID',
            component: 'pipeline/links',
            frequencyWeight: 1.6,
            autofixCandidate: true,
          });
        }
      }

      // Cohérence booking transport: departure_date doit matcher la date du jour de segment
      if (item.type === 'transport' && item.bookingUrl && dayIso) {
        const departureDate = extractDepartureDate(item.bookingUrl);
        if (departureDate && departureDate !== dayIso) {
          issues.push({
            severity: 'critical',
            category: 'links',
            message: `Jour ${day.dayNumber}: departure_date=${departureDate} incohérente pour "${item.title}" (attendu ${dayIso})`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            details: { departureDate, expectedDate: dayIso, bookingUrl: item.bookingUrl },
            code: 'LINK_TRANSPORT_DATE_MISMATCH',
            component: 'pipeline/step7-assemble',
            frequencyWeight: 2,
            autofixCandidate: true,
          });
        }
      }
    }
  }

  return issues;
}
