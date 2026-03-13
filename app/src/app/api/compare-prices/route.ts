import { NextRequest, NextResponse } from 'next/server';
import {
  compareHotelPrices,
  compareFlightPrices,
  compareActivityPrices,
  getTripCostSummary,
} from '@/lib/services/priceComparator';
import { checkRateLimit } from '@/lib/server/rateLimit';
import { BoundedTtlCache } from '@/lib/server/boundedCache';
import type { Trip } from '@/lib/types';

type ComparisonType = 'hotel' | 'flight' | 'activity' | 'trip-summary';

interface HotelParams {
  city: string;
  checkIn: string;
  checkOut: string;
  hotelName?: string;
  adults: number;
}

interface FlightParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
}

interface ActivityParams {
  activityName: string;
  city: string;
  date?: string;
}

interface TripSummaryParams {
  trip: Record<string, unknown>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const CACHE_MAX_ENTRIES = 500;
const MAX_CACHE_KEY_LENGTH = 2048;
const MAX_FIELD_LENGTH = 120;
const MAX_TRIP_PAYLOAD_LENGTH = 200_000;
const cache = new BoundedTtlCache<unknown>({ maxEntries: CACHE_MAX_ENTRIES, ttlMs: CACHE_TTL_MS });

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function normalizeString(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} requis`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${field} doit être une chaîne`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new Error(`${field} requis`);
    return undefined;
  }
  if (trimmed.length > MAX_FIELD_LENGTH) {
    throw new Error(`${field} trop long (max ${MAX_FIELD_LENGTH})`);
  }
  return trimmed;
}

function normalizeInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${field} doit être un entier`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} doit être entre ${min} et ${max}`);
  }
  return value;
}

function normalizeDate(value: unknown, field: string, required: boolean): string | undefined {
  const parsed = normalizeString(value, field, required);
  if (!parsed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw new Error(`${field} invalide (format attendu YYYY-MM-DD)`);
  }
  return parsed;
}

function ensureParamsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('params doit être un objet');
  }
  return value as Record<string, unknown>;
}

function parseRequestBody(payload: unknown):
  | { type: 'hotel'; params: HotelParams }
  | { type: 'flight'; params: FlightParams }
  | { type: 'activity'; params: ActivityParams }
  | { type: 'trip-summary'; params: TripSummaryParams } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload invalide');
  }

  const body = payload as Record<string, unknown>;
  const type = body.type;
  if (type !== 'hotel' && type !== 'flight' && type !== 'activity' && type !== 'trip-summary') {
    throw new Error('type invalide. Valeurs autorisées: hotel, flight, activity, trip-summary');
  }

  const params = ensureParamsObject(body.params);

  if (type === 'hotel') {
    return {
      type,
      params: {
        city: normalizeString(params.city, 'city', true) || '',
        checkIn: normalizeDate(params.checkIn, 'checkIn', true) || '',
        checkOut: normalizeDate(params.checkOut, 'checkOut', true) || '',
        hotelName: normalizeString(params.hotelName, 'hotelName', false),
        adults: normalizeInt(params.adults, 'adults', 1, 20),
      },
    };
  }

  if (type === 'flight') {
    return {
      type,
      params: {
        origin: normalizeString(params.origin, 'origin', true) || '',
        destination: normalizeString(params.destination, 'destination', true) || '',
        departureDate: normalizeDate(params.departureDate, 'departureDate', true) || '',
        returnDate: normalizeDate(params.returnDate, 'returnDate', false),
        adults: normalizeInt(params.adults, 'adults', 1, 20),
      },
    };
  }

  if (type === 'activity') {
    return {
      type,
      params: {
        activityName: normalizeString(params.activityName, 'activityName', true) || '',
        city: normalizeString(params.city, 'city', true) || '',
        date: normalizeDate(params.date, 'date', false),
      },
    };
  }

  if (!params.trip || typeof params.trip !== 'object' || Array.isArray(params.trip)) {
    throw new Error('trip requis pour trip-summary');
  }

  const serializedTrip = JSON.stringify(params.trip);
  if (serializedTrip.length > MAX_TRIP_PAYLOAD_LENGTH) {
    throw new Error(`trip trop volumineux (max ${MAX_TRIP_PAYLOAD_LENGTH} caractères)`);
  }

  return {
    type,
    params: {
      trip: params.trip as Record<string, unknown>,
    },
  };
}

function getCacheKey(type: ComparisonType, params: unknown): string | null {
  const key = `${type}:${stableSerialize(params)}`;
  if (key.length > MAX_CACHE_KEY_LENGTH) return null;
  return key;
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip, { windowMs: 60_000, maxRequests: 12 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  try {
    const parsed = parseRequestBody(await request.json().catch(() => null));
    const cacheKey = getCacheKey(parsed.type, parsed.params);
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return NextResponse.json({ data: cached, cached: true });
      }
    }

    let result: unknown;

    switch (parsed.type) {
      case 'hotel':
        result = await compareHotelPrices(parsed.params);
        break;
      case 'flight':
        result = await compareFlightPrices(parsed.params);
        break;
      case 'activity':
        result = await compareActivityPrices(parsed.params);
        break;
      case 'trip-summary':
        result = await getTripCostSummary(parsed.params.trip as unknown as Trip);
        break;
      default:
        return NextResponse.json(
          { error: 'type invalide. Valeurs autorisées: hotel, flight, activity, trip-summary' },
          { status: 400 }
        );
    }

    if (cacheKey) {
      cache.set(cacheKey, result);
    }

    return NextResponse.json({ data: result, cached: false });
  } catch (error) {
    if (error instanceof Error) {
      const knownValidationErrors = [
        'Payload invalide',
        'params doit être un objet',
        'type invalide. Valeurs autorisées: hotel, flight, activity, trip-summary',
        'trip requis pour trip-summary',
      ];

      if (
        knownValidationErrors.includes(error.message) ||
        error.message.endsWith(' requis') ||
        error.message.includes('doit être') ||
        error.message.includes('invalide') ||
        error.message.includes('trop long') ||
        error.message.includes('trop volumineux') ||
        error.message.includes('format attendu')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    console.error('[API] /api/compare-prices error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
