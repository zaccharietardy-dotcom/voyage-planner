import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Trip, TripDay, TripItem } from './types';

// Extend jsPDF type to include autoTable plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable: typeof autoTable;
    lastAutoTable?: {
      finalY: number;
    };
  }
}

// Couleurs par type d'activité
const ACTIVITY_COLORS: Record<string, string> = {
  activity: '#3B82F6',
  restaurant: '#F97316',
  hotel: '#8B5CF6',
  transport: '#10B981',
  flight: '#EC4899',
  parking: '#6B7280',
  checkin: '#8B5CF6',
  checkout: '#8B5CF6',
  luggage: '#F59E0B',
  free_time: '#22C55E',
};

/**
 * Formatte la durée en minutes en format lisible
 */
function formatDuration(minutes?: number): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h${mins}`;
  if (hours > 0) return `${hours}h`;
  return `${mins}min`;
}

/**
 * Formatte le coût en euros
 */
function formatCost(cost?: number): string {
  if (cost === undefined || cost === null || cost === 0) return 'Gratuit';
  return `${cost.toFixed(0)}€`;
}

/**
 * Ajoute un header Narae Voyage avec titre et infos du voyage
 */
function addHeader(doc: jsPDF, trip: Trip, pageNumber: number = 1) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Titre Narae Voyage
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(212, 175, 55); // Couleur dorée
  doc.text('Narae Voyage', pageWidth / 2, 20, { align: 'center' });

  // Destination
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(trip.preferences.destination, pageWidth / 2, 30, { align: 'center' });

  // Dates
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  const startDate = format(new Date(trip.preferences.startDate), 'd MMMM yyyy', { locale: fr });
  const endDate = new Date(trip.preferences.startDate);
  endDate.setDate(endDate.getDate() + trip.preferences.durationDays - 1);
  const endDateStr = format(endDate, 'd MMMM yyyy', { locale: fr });
  doc.text(`${startDate} - ${endDateStr}`, pageWidth / 2, 37, { align: 'center' });

  // Ligne de séparation
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 42, pageWidth - 20, 42);

  return 47; // Position Y après le header
}

/**
 * Ajoute un footer avec numéro de page
 */
function addFooter(doc: jsPDF, pageNumber: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 150);
  doc.text(`Page ${pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  doc.text('Généré par Narae Voyage', pageWidth / 2, pageHeight - 5, { align: 'center' });
}

/**
 * Ajoute une section pour un jour
 */
function addDaySection(doc: jsPDF, day: TripDay, trip: Trip, startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentY = startY;

  // Vérifier si on a assez de place pour le titre du jour (30px minimum)
  if (currentY > pageHeight - 50) {
    doc.addPage();
    currentY = addHeader(doc, trip, doc.getCurrentPageInfo().pageNumber);
    addFooter(doc, doc.getCurrentPageInfo().pageNumber);
  }

  // Titre du jour
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  const dayTitle = `Jour ${day.dayNumber} - ${format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}`;
  doc.text(dayTitle, 20, currentY);
  currentY += 7;

  // Météo (si disponible)
  if (day.weatherForecast) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const weather = `${day.weatherForecast.condition} · ${day.weatherForecast.tempMin}°C - ${day.weatherForecast.tempMax}°C`;
    doc.text(weather, 20, currentY);
    currentY += 7;
  }

  // Préparer les données pour le tableau
  const tableData = day.items
    .filter(item => item.type !== 'transport') // Exclure les transports de la liste
    .map(item => {
      const time = item.startTime || '—';
      const title = item.title || 'Sans titre';
      const duration = formatDuration(item.duration);
      const cost = formatCost(item.estimatedCost);

      return [time, title, duration, cost];
    });

  // Tableau des activités
  autoTable(doc, {
    startY: currentY,
    head: [['Heure', 'Activité', 'Durée', 'Coût']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [212, 175, 55], // Couleur dorée
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: [0, 0, 0],
    },
    alternateRowStyles: {
      fillColor: [248, 248, 248],
    },
    columnStyles: {
      0: { cellWidth: 25 }, // Heure
      1: { cellWidth: 'auto' }, // Activité
      2: { cellWidth: 25 }, // Durée
      3: { cellWidth: 25 }, // Coût
    },
    margin: { left: 20, right: 20 },
    didDrawPage: (data) => {
      // Ne pas ajouter de footer ici, on le fait à la fin
    },
  });

  // Mise à jour de currentY après le tableau
  currentY = (doc as any).lastAutoTable.finalY + 10;

  return currentY;
}

/**
 * Ajoute le résumé budgétaire
 */
function addBudgetSummary(doc: jsPDF, trip: Trip, startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentY = startY;

  // Vérifier si on a assez de place
  if (currentY > pageHeight - 80) {
    doc.addPage();
    currentY = addHeader(doc, trip, doc.getCurrentPageInfo().pageNumber);
    addFooter(doc, doc.getCurrentPageInfo().pageNumber);
  }

  // Titre
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Résumé Budgétaire', 20, currentY);
  currentY += 10;

  // Données du budget
  const totalCost = trip.totalEstimatedCost || 0;
  const groupSize = trip.preferences.groupSize || 1;
  const perPerson = Math.round(totalCost / groupSize);
  const durationDays = trip.preferences.durationDays || 1;
  const perDay = Math.round(totalCost / durationDays);

  const budgetData: string[][] = [
    ['Coût total', `${totalCost.toFixed(0)}€`],
    ['Par personne', `${perPerson}€`],
    ['Par jour', `${perDay}€`],
  ];

  // Breakdown détaillé si disponible
  if (trip.costBreakdown) {
    budgetData.push(['', '']); // Ligne vide
    budgetData.push(['Détail', '']);
    if (trip.costBreakdown.flights > 0) {
      budgetData.push(['  Vols', `${trip.costBreakdown.flights.toFixed(0)}€`]);
    }
    if (trip.costBreakdown.accommodation > 0) {
      budgetData.push(['  Hébergement', `${trip.costBreakdown.accommodation.toFixed(0)}€`]);
    }
    if (trip.costBreakdown.activities > 0) {
      budgetData.push(['  Activités', `${trip.costBreakdown.activities.toFixed(0)}€`]);
    }
    if (trip.costBreakdown.food > 0) {
      budgetData.push(['  Restaurants', `${trip.costBreakdown.food.toFixed(0)}€`]);
    }
    if (trip.costBreakdown.transport > 0) {
      budgetData.push(['  Transports', `${trip.costBreakdown.transport.toFixed(0)}€`]);
    }
  }

  // Tableau du budget
  autoTable(doc, {
    startY: currentY,
    body: budgetData,
    theme: 'plain',
    bodyStyles: {
      fontSize: 10,
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 80, fontStyle: 'bold' },
      1: { cellWidth: 50, halign: 'right' },
    },
    margin: { left: 20, right: 20 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  return currentY;
}

/**
 * Exporte le voyage en PDF
 */
export function exportTripPdf(trip: Trip): void {
  // Créer le document PDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let currentY = addHeader(doc, trip, 1);
  addFooter(doc, 1);

  currentY += 5; // Espacement après le header

  // Ajouter chaque jour
  trip.days.forEach((day, index) => {
    currentY = addDaySection(doc, day, trip, currentY);

    // Espacement entre les jours
    if (index < trip.days.length - 1) {
      currentY += 5;
    }
  });

  // Ajouter le résumé budgétaire
  currentY = addBudgetSummary(doc, trip, currentY);

  // Télécharger le PDF
  const fileName = `voyage-${trip.preferences.destination.replace(/\s+/g, '-').toLowerCase()}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  doc.save(fileName);
}
