/**
 * Analyseur de qualité des données — complétude, doublons, génériques
 */

import { Trip, TripItem } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

const GENERIC_ACTIVITY_PATTERNS = [
  /^pause caf[eé]/i,
  /^shopping local/i,
  /^quartier historique/i,
  /^point de vue/i,
  /^promenade digestive/i,
  /^glace artisanale/i,
  /^parc et jardins/i,
  /^march[eé] de /i,
  /^place centrale/i,
  /^galerie d'art locale/i,
  /^librairie-caf[eé]/i,
  /^ap[eé]ritif local/i,
  /^promenade nocturne/i,
  /^bar [àa] /i,
  /^rooftop bar/i,
  /^jazz club/i,
  /^pausa caf[eé]/i, /^paseo por/i, /^calle principal/i,
  /^plaza (central|mayor)/i, /^barrio histórico/i,
  /^helado artesanal/i, /^mirador panorámico$/i,
  /^passeggiata/i, /^piazza (centrale|principale)/i,
  /^gelato artigianale/i, /^quartiere storico/i,
  /^kaffeepause/i, /^historisches viertel/i,
  /^marktplatz$/i, /^aussichtspunkt$/i,
  /^café local/i, /^bairro histórico/i, /^miradouro$/i,
  /^koffiepauze/i,
  /^free time$/i, /^rest day$/i, /^optional activity$/i,
  /^local exploration$/i, /^wander around$/i,
  /^coffee break$/i, /^ice cream stop$/i,
];

function isGenericActivity(title: string): boolean {
  return GENERIC_ACTIVITY_PATTERNS.some(p => p.test(title));
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeTransportMode(mode?: string): TripItem['transportMode'] | undefined {
  if (!mode) return undefined;
  const normalized = mode.toLowerCase();
  if (normalized === 'train' || normalized === 'bus' || normalized === 'car' || normalized === 'ferry') return normalized;
  if (normalized === 'walking' || normalized === 'walk') return 'walking';
  if (normalized === 'transit' || normalized === 'metro' || normalized === 'tram' || normalized === 'subway' || normalized === 'public') return 'transit';
  return undefined;
}

function inferModeFromTitle(title: string): TripItem['transportMode'] | undefined {
  const t = title.toLowerCase();
  if (t.includes('train') || t.includes('tgv') || t.includes('ter') || t.includes('🚄')) return 'train';
  if (t.includes('bus') || t.includes('🚌')) return 'bus';
  if (t.includes('ferry') || t.includes('bateau') || t.includes('⛴')) return 'ferry';
  if (t.includes('walk') || t.includes('à pied')) return 'walking';
  if (t.includes('car') || t.includes('voiture') || t.includes('🚗')) return 'car';
  return undefined;
}

function inferDominantModeFromLegs(item: TripItem): TripItem['transportMode'] | undefined {
  if (!item.transitLegs || item.transitLegs.length === 0) return undefined;
  const weighted = new Map<TripItem['transportMode'], number>();
  for (const leg of item.transitLegs) {
    const mode = normalizeTransportMode(leg.mode);
    if (!mode) continue;
    weighted.set(mode, (weighted.get(mode) || 0) + Math.max(1, leg.duration || 1));
  }
  if (weighted.size === 0) return undefined;
  return [...weighted.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function extractBoundaryCounterpartId(item: TripItem, dayNumber: number): string | null {
  const departPrefix = `hotel-depart-${dayNumber}-`;
  if (item.id.startsWith(departPrefix)) return item.id.slice(departPrefix.length);

  const returnPrefix = `hotel-return-${dayNumber}-`;
  if (item.id.startsWith(returnPrefix)) return item.id.slice(returnPrefix.length);

  return null;
}

export function analyzeDataQuality(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  // Champs top-level manquants
  if (!trip.accommodation) {
    issues.push({ severity: 'warning', category: 'data-quality', message: 'Pas d\'hébergement défini' });
  }
  if (!trip.carbonFootprint) {
    issues.push({ severity: 'info', category: 'data-quality', message: 'Pas d\'empreinte carbone calculée' });
  }
  if (!trip.costBreakdown) {
    issues.push({ severity: 'warning', category: 'data-quality', message: 'Pas de breakdown des coûts' });
  }
  if (!trip.travelTips) {
    issues.push({ severity: 'info', category: 'data-quality', message: 'Pas de conseils de voyage' });
  }

  // Vols manquants si transport avion
  if (trip.preferences.transport === 'plane' || trip.preferences.transport === 'optimal') {
    if (!trip.outboundFlight && !trip.selectedTransport) {
      issues.push({ severity: 'info', category: 'data-quality', message: 'Pas de vol aller défini (transport optimal/avion)' });
    }
  }

  // Activités génériques
  const allTitles: string[] = [];
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type === 'transport') {
        const explicitMode = normalizeTransportMode(item.transportMode);
        const titleMode = inferModeFromTitle(item.title);
        const legsMode = inferDominantModeFromLegs(item);

        if (!explicitMode && (titleMode || legsMode)) {
          issues.push({
            severity: 'info',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: transport "${item.title}" sans transportMode explicite`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'DATA_TRANSPORT_MODE_MISSING',
            component: 'pipeline/step7-assemble',
          });
        }

        if (explicitMode && titleMode && explicitMode !== titleMode) {
          issues.push({
            severity: 'warning',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: transportMode="${explicitMode}" incohérent avec le titre "${item.title}"`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            details: { transportMode: explicitMode, titleMode },
            code: 'DATA_TRANSPORT_MODE_TITLE_MISMATCH',
            component: 'pipeline/step7-assemble',
            frequencyWeight: 1.2,
            autofixCandidate: true,
          });
        }

        if (explicitMode && legsMode && explicitMode !== legsMode) {
          issues.push({
            severity: 'warning',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: transportMode="${explicitMode}" incohérent avec transitLegs (${legsMode}) pour "${item.title}"`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            details: { transportMode: explicitMode, legsMode },
            code: 'DATA_TRANSPORT_MODE_LEGS_MISMATCH',
            component: 'pipeline/step7-assemble',
            frequencyWeight: 1.3,
            autofixCandidate: true,
          });
        }

        // Vérification cohérence boundary hôtel
        const boundaryCounterpartId = extractBoundaryCounterpartId(item, day.dayNumber);
        if (boundaryCounterpartId) {
          const counterpart = day.items.find((candidate) => candidate.id === boundaryCounterpartId);
          if (counterpart && item.latitude && item.longitude && counterpart.latitude && counterpart.longitude) {
            const directDistance = haversineDistance(item.latitude, item.longitude, counterpart.latitude, counterpart.longitude);
            const declaredDistance = item.distanceFromPrevious || 0;
            if (directDistance > 0.2 && declaredDistance < 0.05) {
              issues.push({
                severity: 'critical',
                category: 'data-quality',
                message: `Jour ${day.dayNumber}: segment boundary hôtel incohérent pour "${item.title}" (${directDistance.toFixed(2)}km réel, ${declaredDistance.toFixed(2)}km déclaré)`,
                dayNumber: day.dayNumber,
                itemTitle: item.title,
                details: { directDistanceKm: Number(directDistance.toFixed(3)), declaredDistanceKm: declaredDistance, counterpartId: boundaryCounterpartId },
                code: 'DATA_HOTEL_BOUNDARY_INCOHERENT',
                component: 'pipeline/step7-assemble',
                frequencyWeight: 2.5,
                autofixCandidate: true,
              });
            }
          }
        }
      }

      if (item.type === 'activity') {
        allTitles.push(item.title);

        if (isGenericActivity(item.title)) {
          issues.push({
            severity: 'critical',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: "${item.title}" est une activité générique inventée`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'DATA_GENERIC_ACTIVITY',
            component: 'pipeline/activity-selection',
          });
        }

        // Description vide
        if (!item.description || item.description.trim().length < 10) {
          issues.push({
            severity: 'info',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: "${item.title}" n'a pas de description`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
            code: 'DATA_ACTIVITY_DESCRIPTION_MISSING',
            component: 'pipeline/content',
          });
        }
      }
    }

    // Thème du jour manquant
    if (!day.theme) {
      issues.push({
        severity: 'info',
        category: 'data-quality',
        message: `Jour ${day.dayNumber}: pas de thème défini`,
        dayNumber: day.dayNumber,
        code: 'DATA_DAY_THEME_MISSING',
        component: 'pipeline/day-narrative',
      });
    }
  }

  // Doublons d'attractions (même titre sur des jours différents)
  const titleCounts = new Map<string, number[]>();
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      const normalized = item.title.toLowerCase().trim();
      if (!titleCounts.has(normalized)) {
        titleCounts.set(normalized, []);
      }
      titleCounts.get(normalized)!.push(day.dayNumber);
    }
  }

  for (const [title, days] of titleCounts) {
    if (days.length > 1) {
      issues.push({
        severity: 'critical',
        category: 'data-quality',
        message: `Attraction "${title}" apparaît ${days.length} fois (jours ${days.join(', ')})`,
        details: { days },
        code: 'DATA_ACTIVITY_DUPLICATE',
        component: 'pipeline/step6-balance',
        frequencyWeight: 1.8,
        autofixCandidate: true,
      });
    }
  }

  // Nombre de jours vs durée demandée
  if (trip.days.length !== trip.preferences.durationDays) {
    issues.push({
      severity: 'critical',
      category: 'data-quality',
      message: `${trip.days.length} jours générés mais ${trip.preferences.durationDays} demandés`,
      details: { generated: trip.days.length, requested: trip.preferences.durationDays },
      code: 'DATA_DAY_COUNT_MISMATCH',
      component: 'pipeline/step1-structure',
      frequencyWeight: 2,
    });
  }

  return issues;
}
