export interface FlightPriceDay {
  date: string; // ISO date
  price: number | null; // null = no data
  tier: 'cheap' | 'medium' | 'expensive' | null;
}

export interface FlightPriceMatrix {
  origin: string;
  destination: string;
  days: FlightPriceDay[];
  cheapestDate?: string;
  cheapestPrice?: number;
}

/**
 * Generates estimated flight prices for a date range.
 * Uses heuristic patterns (weekday vs weekend, advance booking, seasonality).
 * In production, this would call Amadeus/Skyscanner API.
 */
export function generateFlightPriceMatrix(
  origin: string,
  destination: string,
  centerDate: Date,
  rangeWeeks: number = 4,
  basePrice: number = 150
): FlightPriceMatrix {
  const days: FlightPriceDay[] = [];
  const start = new Date(centerDate);
  start.setDate(start.getDate() - Math.floor(rangeWeeks * 7 / 2));

  for (let i = 0; i < rangeWeeks * 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
    const month = date.getMonth();

    // Price modifiers
    let modifier = 1.0;

    // Weekend premium (Fri-Sun departures)
    if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
      modifier *= 1.3;
    }

    // Tuesday/Wednesday discount
    if (dayOfWeek === 2 || dayOfWeek === 3) {
      modifier *= 0.85;
    }

    // Summer premium (Jun-Aug)
    if (month >= 5 && month <= 7) {
      modifier *= 1.4;
    }

    // Holiday premium (Dec, school breaks)
    if (month === 11) modifier *= 1.5;
    if (month === 3) modifier *= 1.15; // Easter

    // Low season discount (Jan-Feb, Nov)
    if (month === 0 || month === 1 || month === 10) {
      modifier *= 0.8;
    }

    // Add some randomness (+/-15%)
    const noise = 0.85 + Math.random() * 0.3;
    const price = Math.round(basePrice * modifier * noise);

    days.push({
      date: date.toISOString().split('T')[0],
      price,
      tier: null, // Will be computed below
    });
  }

  // Compute tiers (quartiles)
  const prices = days.map(d => d.price).filter((p): p is number => p !== null);
  prices.sort((a, b) => a - b);
  const q25 = prices[Math.floor(prices.length * 0.25)] || 0;
  const q75 = prices[Math.floor(prices.length * 0.75)] || Infinity;

  for (const day of days) {
    if (day.price === null) continue;
    if (day.price <= q25) day.tier = 'cheap';
    else if (day.price >= q75) day.tier = 'expensive';
    else day.tier = 'medium';
  }

  const cheapest = days.reduce((min, d) =>
    d.price !== null && (min.price === null || d.price < min.price!) ? d : min
  , days[0]);

  return {
    origin,
    destination,
    days,
    cheapestDate: cheapest?.date,
    cheapestPrice: cheapest?.price ?? undefined,
  };
}
