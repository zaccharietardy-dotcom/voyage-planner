/**
 * Analyseur de réalisme — l'itinéraire est-il physiquement vivable ?
 */

import { Trip } from '../../../src/lib/types';
import { AnalysisIssue } from './schedule';

function parseTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
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

// Villes connues pour la chaleur en été
const HOT_CITIES_SUMMER = [
  'rome', 'roma', 'naples', 'napoli', 'barcelone', 'barcelona', 'séville', 'sevilla',
  'athènes', 'athens', 'marrakech', 'istanbul', 'lisbonne', 'lisboa', 'madrid',
  'dubai', 'bangkok', 'le caire', 'cairo',
];

export function analyzeRealism(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const totalDays = trip.days.length;

  for (const day of trip.days) {
    const isFirstDay = day.dayNumber === 1;
    const isLastDay = day.dayNumber === totalDays;
    const items = [...day.items].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    if (items.length === 0) continue;

    // ========================
    // Journée continue sans pause
    // ========================
    const nonLogistics = items.filter(i =>
      !['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage', 'hotel'].includes(i.type)
    );

    if (nonLogistics.length > 0) {
      const firstStart = parseTime(nonLogistics[0].startTime);
      const lastEnd = parseTime(nonLogistics[nonLogistics.length - 1].endTime);
      const totalSpan = lastEnd - firstStart;

      if (totalSpan > 600) { // >10h
        // Vérifier s'il y a au moins une pause de 30min
        let hasBreak = false;
        for (let i = 0; i < nonLogistics.length - 1; i++) {
          const gap = parseTime(nonLogistics[i + 1].startTime) - parseTime(nonLogistics[i].endTime);
          if (gap >= 30) {
            hasBreak = true;
            break;
          }
        }
        if (!hasBreak) {
          issues.push({
            severity: 'warning',
            category: 'realism',
            message: `Jour ${day.dayNumber}: ${(totalSpan / 60).toFixed(0)}h d'activités continues sans pause ≥30min`,
            dayNumber: day.dayNumber,
            details: { totalHours: (totalSpan / 60).toFixed(1) },
          });
        }
      }
    }

    // ========================
    // Transitions repas irréalistes
    // ========================
    const restaurants = items.filter(i => i.type === 'restaurant');
    for (const resto of restaurants) {
      const restoIdx = items.indexOf(resto);
      if (restoIdx > 0) {
        const prev = items[restoIdx - 1];
        if (prev.latitude !== 0 && resto.latitude !== 0) {
          const dist = haversineDistance(prev.latitude, prev.longitude, resto.latitude, resto.longitude);
          const gap = parseTime(resto.startTime) - parseTime(prev.endTime);
          if (dist > 3 && gap < 20) {
            issues.push({
              severity: 'warning',
              category: 'realism',
              message: `Jour ${day.dayNumber}: restaurant "${resto.title}" à ${dist.toFixed(1)}km de l'activité précédente ("${prev.title}") avec seulement ${gap}min de battement`,
              dayNumber: day.dayNumber,
              itemTitle: resto.title,
              details: { distKm: dist.toFixed(1), gapMin: gap },
            });
          }
        }
      }
    }

    // ========================
    // Premier jour surchargé
    // ========================
    if (isFirstDay) {
      const flight = items.find(i => i.type === 'flight');
      if (flight) {
        const arrivalTime = parseTime(flight.endTime);
        const activitiesAfter = nonLogistics.filter(i => parseTime(i.startTime) > arrivalTime);
        if (activitiesAfter.length > 4) {
          issues.push({
            severity: 'info',
            category: 'realism',
            message: `Jour 1: ${activitiesAfter.length} activités après l'arrivée (${flight.endTime}) — jour d'arrivée chargé`,
            dayNumber: 1,
            details: { activitiesAfterArrival: activitiesAfter.length, arrivalTime: flight.endTime },
          });
        }
      }
    }

    // ========================
    // Dernier jour — timing vol retour
    // ========================
    if (isLastDay) {
      const flight = items.find(i => i.type === 'flight');
      if (flight) {
        const flightStart = parseTime(flight.startTime);
        const activitiesBefore = nonLogistics.filter(i => parseTime(i.endTime) < flightStart);
        const lastActivity = activitiesBefore[activitiesBefore.length - 1];
        if (lastActivity) {
          const gap = flightStart - parseTime(lastActivity.endTime);
          if (gap < 120) { // <2h avant le vol
            issues.push({
              severity: 'warning',
              category: 'realism',
              message: `Dernier jour: dernière activité (${lastActivity.endTime}) à seulement ${gap}min avant le vol (${flight.startTime}) — risqué`,
              dayNumber: day.dayNumber,
              details: { gapMinutes: gap },
            });
          }
        }
      }
    }

    // ========================
    // Heures d'ouverture typiques
    // ========================
    for (const item of items) {
      if (item.type !== 'activity') continue;
      const startHour = parseTime(item.startTime) / 60;
      const title = item.title.toLowerCase();

      // Musée après 19h
      if ((title.includes('musée') || title.includes('museum')) && startHour >= 19) {
        issues.push({
          severity: 'warning',
          category: 'realism',
          message: `Jour ${day.dayNumber}: "${item.title}" prévu à ${item.startTime} — la plupart des musées ferment avant 19h`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
        });
      }

      // Marché après 15h
      if ((title.includes('marché') || title.includes('market') || title.includes('mercato')) && startHour >= 15) {
        issues.push({
          severity: 'info',
          category: 'realism',
          message: `Jour ${day.dayNumber}: "${item.title}" prévu à ${item.startTime} — les marchés ferment souvent en début d'après-midi`,
          dayNumber: day.dayNumber,
          itemTitle: item.title,
        });
      }
    }
  }

  // ========================
  // Météo implicite — chaleur estivale
  // ========================
  const startDate = new Date(trip.preferences.startDate);
  const month = startDate.getMonth(); // 0-indexed
  const isSummer = month >= 5 && month <= 8; // Juin-Septembre

  if (isSummer) {
    const dest = trip.preferences.destination.toLowerCase();
    const isHotCity = HOT_CITIES_SUMMER.some(c => dest.includes(c));

    if (isHotCity) {
      for (const day of trip.days) {
        const outdoorAfternoon = day.items.filter(item => {
          if (item.type !== 'activity') return false;
          const startHour = parseTime(item.startTime) / 60;
          if (startHour < 13 || startHour > 16) return false;
          const title = item.title.toLowerCase();
          return title.includes('randonnée') || title.includes('hike') || title.includes('walk') ||
                 title.includes('promenade') || title.includes('visite à pied') || title.includes('walking tour');
        });

        if (outdoorAfternoon.length > 0) {
          issues.push({
            severity: 'info',
            category: 'realism',
            message: `Jour ${day.dayNumber}: activité outdoor "${outdoorAfternoon[0].title}" prévue en plein après-midi d'été à ${trip.preferences.destination} — attention à la chaleur`,
            dayNumber: day.dayNumber,
          });
        }
      }
    }
  }

  return issues;
}
