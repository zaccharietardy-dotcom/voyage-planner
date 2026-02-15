// ============================================
// Types pour le Price Comparator
// ============================================

export type PricePlatform = 'booking' | 'expedia' | 'airbnb' | 'kayak' | 'viator' | 'tiqets' | 'getyourguide' | 'direct' | 'google_flights' | 'aviasales' | 'omio';

export interface PriceSource {
  platform: PricePlatform;
  price: number;
  currency: string;
  url?: string;
  lastChecked: string;
  isEstimate: boolean;
}

export interface HotelPriceComparison {
  hotelName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  prices: PriceSource[];
  bestPrice: PriceSource;
  averagePrice: number;
  savingsPercent: number;
}

export interface FlightPriceComparison {
  airline: string;
  route: string;
  departureDate: string;
  prices: PriceSource[];
  bestPrice: PriceSource;
  averagePrice: number;
}

export interface ActivityPriceComparison {
  activityName: string;
  city: string;
  prices: PriceSource[];
  bestPrice: PriceSource;
  freeAlternative?: string;
}

export interface TripCostSummary {
  accommodation: { total: number; bestTotal: number; savings: number };
  flights: { total: number; bestTotal: number; savings: number };
  activities: { total: number; bestTotal: number; savings: number };
  estimatedFood: number;
  estimatedTransport: number;
  grandTotal: number;
  bestGrandTotal: number;
  totalSavings: number;
  savingsPercent: number;
}
