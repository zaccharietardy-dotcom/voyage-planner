/**
 * Neighbourhood pricing overlay for Leaflet maps.
 *
 * Exports a helper that draws coloured rectangles on a raw Leaflet map instance,
 * matching TripMap's direct-Leaflet approach (no react-leaflet dependency).
 */

import type { PriceCell } from '@/lib/services/neighbourhoodPricing';

const TIER_COLORS: Record<string, string> = {
  budget: '#22C55E',   // green
  mid: '#F59E0B',      // amber
  premium: '#EF4444',  // red
};

/**
 * Renders neighbourhood price-cell rectangles on the given Leaflet map.
 * Returns a cleanup function that removes all created layers.
 */
export function renderNeighbourhoodOverlay(
  L: any,
  map: any,
  cells: PriceCell[],
  gridSizeKm: number = 0.5
): () => void {
  if (cells.length === 0) return () => {};

  const latStep = gridSizeKm / 111;
  const avgLat = cells.reduce((s, c) => s + c.lat, 0) / cells.length;
  const lngStep = gridSizeKm / (111 * Math.cos(avgLat * Math.PI / 180));

  const layers: any[] = [];

  for (const cell of cells) {
    const bounds: [[number, number], [number, number]] = [
      [cell.lat - latStep / 2, cell.lng - lngStep / 2],
      [cell.lat + latStep / 2, cell.lng + lngStep / 2],
    ];

    const color = TIER_COLORS[cell.tier] || TIER_COLORS.mid;

    const rect = L.rectangle(bounds, {
      color,
      fillColor: color,
      fillOpacity: 0.25,
      weight: 1,
      opacity: 0.5,
    });

    const hotelsList = cell.hotels
      .slice(0, 3)
      .map(
        (h: { name: string; price: number; rating: number }) =>
          `<br/><small>${h.name} - ${h.price}\u20AC \u2B50${h.rating}</small>`
      )
      .join('');

    rect.bindPopup(
      `<div style="text-align:center">
        <strong>${cell.avgPrice}\u20AC/nuit</strong><br/>
        <small>${cell.hotelCount} h\u00F4tel${cell.hotelCount > 1 ? 's' : ''}</small>
        ${hotelsList}
      </div>`,
      { className: 'clean-popup' }
    );

    rect.addTo(map);
    layers.push(rect);
  }

  return () => {
    layers.forEach((layer) => map.removeLayer(layer));
  };
}
