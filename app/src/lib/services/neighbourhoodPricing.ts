import type { Accommodation } from '@/lib/types';

export interface PriceCell {
  lat: number;
  lng: number;
  avgPrice: number;
  hotelCount: number;
  tier: 'budget' | 'mid' | 'premium';
  hotels: { name: string; price: number; rating: number }[];
}

/**
 * Clusters accommodation options into a geographic grid and computes pricing tiers
 */
export function clusterAccommodationsByArea(
  accommodations: Accommodation[],
  gridSizeKm: number = 0.5
): PriceCell[] {
  if (accommodations.length === 0) return [];

  // Convert grid size from km to degrees (approximate)
  const latStep = gridSizeKm / 111; // ~111km per degree latitude
  const avgLat = accommodations.reduce((s, a) => s + a.latitude, 0) / accommodations.length;
  const lngStep = gridSizeKm / (111 * Math.cos(avgLat * Math.PI / 180));

  // Group by grid cell
  const cells = new Map<string, { lat: number; lng: number; hotels: Accommodation[] }>();

  for (const acc of accommodations) {
    const cellLat = Math.floor(acc.latitude / latStep) * latStep + latStep / 2;
    const cellLng = Math.floor(acc.longitude / lngStep) * lngStep + lngStep / 2;
    const key = `${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;

    if (!cells.has(key)) {
      cells.set(key, { lat: cellLat, lng: cellLng, hotels: [] });
    }
    cells.get(key)!.hotels.push(acc);
  }

  // Compute averages and tiers
  const priceCells: PriceCell[] = [];
  const allAvgPrices: number[] = [];

  for (const [, cell] of cells) {
    const avgPrice = Math.round(
      cell.hotels.reduce((s, h) => s + h.pricePerNight, 0) / cell.hotels.length
    );
    allAvgPrices.push(avgPrice);
    priceCells.push({
      lat: cell.lat,
      lng: cell.lng,
      avgPrice,
      hotelCount: cell.hotels.length,
      tier: 'mid', // Will be set below
      hotels: cell.hotels.map(h => ({
        name: h.name,
        price: h.pricePerNight,
        rating: h.rating,
      })),
    });
  }

  // Set tiers based on price distribution
  allAvgPrices.sort((a, b) => a - b);
  const q33 = allAvgPrices[Math.floor(allAvgPrices.length * 0.33)] || 0;
  const q66 = allAvgPrices[Math.floor(allAvgPrices.length * 0.66)] || Infinity;

  for (const cell of priceCells) {
    if (cell.avgPrice <= q33) cell.tier = 'budget';
    else if (cell.avgPrice >= q66) cell.tier = 'premium';
    else cell.tier = 'mid';
  }

  return priceCells;
}
