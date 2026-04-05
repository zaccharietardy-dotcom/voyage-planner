import * as Sharing from 'expo-sharing';
import type { Trip, TripDay, TripItem } from './types/trip';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderItem(item: TripItem): string {
  const cost = item.estimatedCost ? `<span style="color:#c5a059;font-weight:bold">${item.estimatedCost}€</span>` : '';
  return `
    <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #1e293b">
      <div style="width:6px;border-radius:3px;background:#c5a059;flex-shrink:0"></div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px">${item.startTime || ''} ${item.type}</span>
          ${cost}
        </div>
        <div style="color:#f8fafc;font-size:14px;font-weight:600;margin:4px 0">${escapeHtml(item.title)}</div>
        ${item.description ? `<div style="color:#94a3b8;font-size:11px">${escapeHtml(item.description)}</div>` : ''}
        ${item.locationName ? `<div style="color:#64748b;font-size:10px;margin-top:2px">📍 ${escapeHtml(item.locationName)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderDay(day: TripDay): string {
  return `
    <div style="margin-bottom:24px">
      <div style="background:linear-gradient(135deg,#c5a059,#d4af37);padding:12px 16px;border-radius:12px;margin-bottom:12px">
        <span style="color:#020617;font-size:18px;font-weight:700">Jour ${day.dayNumber}</span>
        ${day.date ? `<span style="color:rgba(2,6,23,0.6);font-size:12px;margin-left:12px">${day.date}</span>` : ''}
      </div>
      ${day.items.map(renderItem).join('')}
    </div>
  `;
}

function generateHtml(trip: Trip): string {
  const destination = trip.preferences?.destination || 'Voyage';
  const days = trip.days || [];
  const totalCost = trip.costBreakdown
    ? Object.values(trip.costBreakdown).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0)
    : 0;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #020617; color: #f8fafc; padding: 32px; }
    .header { text-align: center; margin-bottom: 32px; padding: 24px; border: 1px solid rgba(197,160,89,0.3); border-radius: 16px; }
    .header h1 { color: #c5a059; font-size: 28px; margin-bottom: 8px; }
    .header .meta { color: #94a3b8; font-size: 13px; }
    .budget { display: flex; justify-content: center; gap: 24px; margin: 16px 0; }
    .budget-item { text-align: center; }
    .budget-value { color: #c5a059; font-size: 20px; font-weight: 700; }
    .budget-label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
    .footer { text-align: center; margin-top: 32px; color: #475569; font-size: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>✈️ ${escapeHtml(destination)}</h1>
    <div class="meta">${days.length} jours d'aventure</div>
    ${totalCost > 0 ? `
      <div class="budget">
        <div class="budget-item">
          <div class="budget-value">${Math.round(totalCost)}€</div>
          <div class="budget-label">Budget total</div>
        </div>
        <div class="budget-item">
          <div class="budget-value">${days.length > 0 ? Math.round(totalCost / days.length) : 0}€</div>
          <div class="budget-label">Par jour</div>
        </div>
      </div>
    ` : ''}
  </div>

  ${days.map(renderDay).join('')}

  <div class="footer">
    Généré par Narae Voyage — naraevoyage.com
  </div>
</body>
</html>
  `;
}

export async function exportTripPdf(trip: Trip): Promise<void> {
  // Dynamic import to avoid bundling expo-print when not needed
  const Print = await import('expo-print');
  const html = generateHtml(trip);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
