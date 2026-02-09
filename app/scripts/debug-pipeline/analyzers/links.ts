/**
 * Analyseur de liens — validité des URLs de réservation
 */

import { Trip } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
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
      });
    } else if (!isValidUrl(trip.outboundFlight.bookingUrl)) {
      issues.push({
        severity: 'critical',
        category: 'links',
        message: `Vol aller: bookingUrl invalide — "${trip.outboundFlight.bookingUrl.substring(0, 80)}..."`,
      });
    }
  }

  if (trip.returnFlight) {
    if (!trip.returnFlight.bookingUrl) {
      issues.push({
        severity: 'warning',
        category: 'links',
        message: `Vol retour ${trip.returnFlight.flightNumber}: pas de bookingUrl`,
      });
    } else if (!isValidUrl(trip.returnFlight.bookingUrl)) {
      issues.push({
        severity: 'critical',
        category: 'links',
        message: `Vol retour: bookingUrl invalide`,
      });
    }
  }

  // Hébergement
  if (trip.accommodation && !trip.accommodation.bookingUrl) {
    issues.push({
      severity: 'warning',
      category: 'links',
      message: `Hébergement "${trip.accommodation.name}": pas de bookingUrl`,
    });
  }

  // Items du voyage
  for (const day of trip.days) {
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
          });
        }
      }
    }
  }

  return issues;
}
