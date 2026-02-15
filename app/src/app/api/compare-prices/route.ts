import { NextRequest, NextResponse } from 'next/server';
import {
  compareHotelPrices,
  compareFlightPrices,
  compareActivityPrices,
  getTripCostSummary,
} from '@/lib/services/priceComparator';

// Cache simple en mémoire (1 heure)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 heure

function getCacheKey(type: string, params: any): string {
  return `${type}-${JSON.stringify(params)}`;
}

function getFromCache(key: string): any | null {
  const cached = cache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return cached.data;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, params } = body;

    if (!type || !params) {
      return NextResponse.json(
        { error: 'Missing required fields: type, params' },
        { status: 400 }
      );
    }

    // Vérifier le cache
    const cacheKey = getCacheKey(type, params);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return NextResponse.json({ data: cached, cached: true });
    }

    let result: any;

    switch (type) {
      case 'hotel': {
        const { city, checkIn, checkOut, hotelName, adults } = params;
        if (!city || !checkIn || !checkOut || !adults) {
          return NextResponse.json(
            { error: 'Missing required hotel params: city, checkIn, checkOut, adults' },
            { status: 400 }
          );
        }
        result = await compareHotelPrices({ city, checkIn, checkOut, hotelName, adults });
        break;
      }

      case 'flight': {
        const { origin, destination, departureDate, returnDate, adults } = params;
        if (!origin || !destination || !departureDate || !adults) {
          return NextResponse.json(
            { error: 'Missing required flight params: origin, destination, departureDate, adults' },
            { status: 400 }
          );
        }
        result = await compareFlightPrices({ origin, destination, departureDate, returnDate, adults });
        break;
      }

      case 'activity': {
        const { activityName, city, date } = params;
        if (!activityName || !city) {
          return NextResponse.json(
            { error: 'Missing required activity params: activityName, city' },
            { status: 400 }
          );
        }
        result = await compareActivityPrices({ activityName, city, date });
        break;
      }

      case 'trip-summary': {
        const { trip } = params;
        if (!trip) {
          return NextResponse.json(
            { error: 'Missing required trip-summary params: trip' },
            { status: 400 }
          );
        }
        result = await getTripCostSummary(trip);
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown comparison type: ${type}. Valid types: hotel, flight, activity, trip-summary` },
          { status: 400 }
        );
    }

    // Mettre en cache
    setCache(cacheKey, result);

    return NextResponse.json({ data: result, cached: false });
  } catch (error) {
    console.error('[API] /api/compare-prices error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
