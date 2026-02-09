/**
 * Analyseur de rythme & équilibre — tempo, variété, densité
 */

import { Trip, TripItemType } from '../../../src/lib/types';
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

export function analyzeRhythm(trip: Trip): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  const dayStats: { dayNumber: number; activityCount: number; occupiedMinutes: number; freeMinutes: number }[] = [];

  for (const day of trip.days) {
    const activities = day.items.filter(i => i.type === 'activity' || i.type === 'restaurant');
    const allItems = [...day.items].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    if (allItems.length === 0) continue;

    // Calculer le temps occupé
    let occupiedMinutes = 0;
    for (const item of allItems) {
      const duration = parseTime(item.endTime) - parseTime(item.startTime);
      if (duration > 0) occupiedMinutes += duration;
    }

    // Temps libre = temps entre première et dernière activité - temps occupé
    const firstStart = parseTime(allItems[0].startTime);
    const lastEnd = parseTime(allItems[allItems.length - 1].endTime);
    const totalDayMinutes = lastEnd - firstStart;
    const freeMinutes = Math.max(0, totalDayMinutes - occupiedMinutes);

    dayStats.push({
      dayNumber: day.dayNumber,
      activityCount: activities.length,
      occupiedMinutes,
      freeMinutes,
    });

    // Jour surchargé (>8 activités hors logistique)
    if (activities.length > 8) {
      issues.push({
        severity: 'warning',
        category: 'rhythm',
        message: `Jour ${day.dayNumber}: ${activities.length} activités/restaurants — journée surchargée`,
        dayNumber: day.dayNumber,
        details: { activityCount: activities.length },
      });
    }

    // Moins d'1h de temps libre dans la journée (hors jours de trajet)
    const isTravel = day.items.some(i => i.type === 'flight');
    if (!isTravel && freeMinutes < 60 && totalDayMinutes > 360) {
      issues.push({
        severity: 'warning',
        category: 'rhythm',
        message: `Jour ${day.dayNumber}: seulement ${freeMinutes}min de temps libre — pas de pause`,
        dayNumber: day.dayNumber,
        details: { freeMinutes, occupiedMinutes },
      });
    }

    // Temps de marche implicite entre activités consécutives
    const nonLogistics = day.items
      .filter(i => !['flight', 'transport', 'checkin', 'checkout', 'parking', 'luggage'].includes(i.type))
      .sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

    let totalWalkKm = 0;
    for (let i = 0; i < nonLogistics.length - 1; i++) {
      const curr = nonLogistics[i];
      const next = nonLogistics[i + 1];
      if (curr.latitude === 0 || next.latitude === 0) continue;
      const dist = haversineDistance(curr.latitude, curr.longitude, next.latitude, next.longitude);
      if (dist < 3) { // Probablement à pied si <3km
        totalWalkKm += dist;
      }
    }

    if (totalWalkKm > 8) {
      issues.push({
        severity: 'info',
        category: 'rhythm',
        message: `Jour ${day.dayNumber}: ~${totalWalkKm.toFixed(1)}km de marche implicite entre activités`,
        dayNumber: day.dayNumber,
        details: { walkKm: totalWalkKm.toFixed(1) },
      });
    }
  }

  // Variabilité entre jours (jour très chargé suivi d'un jour vide)
  for (let i = 0; i < dayStats.length - 1; i++) {
    const curr = dayStats[i];
    const next = dayStats[i + 1];
    if (curr.activityCount > 0 && next.activityCount > 0) {
      const ratio = Math.max(curr.activityCount, next.activityCount) / Math.min(curr.activityCount, next.activityCount);
      if (ratio > 2.5) {
        issues.push({
          severity: 'info',
          category: 'rhythm',
          message: `Jour ${curr.dayNumber} (${curr.activityCount} activités) vs jour ${next.dayNumber} (${next.activityCount} activités) — déséquilibre important`,
          details: { day1: curr.activityCount, day2: next.activityCount },
        });
      }
    }
  }

  // Variété des types d'activités
  const typeCounts = new Map<string, number>();
  let totalActivities = 0;
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'activity') continue;
      totalActivities++;
      // Essayer de deviner le type depuis le titre
      const title = item.title.toLowerCase();
      let actType = 'other';
      if (title.includes('musée') || title.includes('museum') || title.includes('galerie') || title.includes('gallery')) actType = 'museum';
      else if (title.includes('église') || title.includes('church') || title.includes('cathédrale') || title.includes('basilique') || title.includes('basilica')) actType = 'church';
      else if (title.includes('parc') || title.includes('park') || title.includes('jardin') || title.includes('garden')) actType = 'park';
      else if (title.includes('plage') || title.includes('beach')) actType = 'beach';
      else if (title.includes('marché') || title.includes('market')) actType = 'market';

      typeCounts.set(actType, (typeCounts.get(actType) || 0) + 1);
    }
  }

  // Trop de musées
  const museumCount = typeCounts.get('museum') || 0;
  if (museumCount > 0 && totalActivities > 0 && museumCount / totalActivities > 0.5) {
    issues.push({
      severity: 'warning',
      category: 'rhythm',
      message: `${museumCount}/${totalActivities} activités sont des musées — manque de variété`,
      details: { museumCount, totalActivities },
    });
  }

  // 3 jours consécutifs dominés par le même type
  for (let i = 0; i < trip.days.length - 2; i++) {
    const getDayTypes = (dayNum: number) => {
      const day = trip.days.find(d => d.dayNumber === dayNum);
      if (!day) return new Set<string>();
      const types = new Set<string>();
      for (const item of day.items) {
        if (item.type === 'activity') {
          const t = item.title.toLowerCase();
          if (t.includes('musée') || t.includes('museum')) types.add('museum');
          if (t.includes('église') || t.includes('church')) types.add('church');
        }
      }
      return types;
    };

    const d1 = getDayTypes(trip.days[i].dayNumber);
    const d2 = getDayTypes(trip.days[i + 1].dayNumber);
    const d3 = getDayTypes(trip.days[i + 2].dayNumber);

    for (const type of ['museum', 'church']) {
      if (d1.has(type) && d2.has(type) && d3.has(type)) {
        issues.push({
          severity: 'warning',
          category: 'rhythm',
          message: `3 jours consécutifs avec des ${type === 'museum' ? 'musées' : 'églises'} (jours ${trip.days[i].dayNumber}-${trip.days[i + 2].dayNumber}) — monotone`,
          details: { type, days: [trip.days[i].dayNumber, trip.days[i + 1].dayNumber, trip.days[i + 2].dayNumber] },
        });
        break;
      }
    }
  }

  return issues;
}
