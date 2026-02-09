/**
 * Analyseur de qualité des données — complétude, doublons, génériques
 */

import { Trip } from '../../../src/lib/types';
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
      if (item.type === 'activity') {
        allTitles.push(item.title);

        if (isGenericActivity(item.title)) {
          issues.push({
            severity: 'critical',
            category: 'data-quality',
            message: `Jour ${day.dayNumber}: "${item.title}" est une activité générique inventée`,
            dayNumber: day.dayNumber,
            itemTitle: item.title,
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
    });
  }

  return issues;
}
