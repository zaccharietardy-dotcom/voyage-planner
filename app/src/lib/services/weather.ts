/**
 * Weather Service — Open-Meteo API
 *
 * Free, no API key required. Provides daily weather forecasts
 * for trip dates including temperature, weather condition, and icon.
 *
 * API docs: https://open-meteo.com/en/docs
 * Rate limit: 10,000 req/day (generous)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================
// Types
// ============================================

export interface DailyWeatherForecast {
  date: string; // YYYY-MM-DD
  tempMin: number; // °C
  tempMax: number; // °C
  condition: string; // Human-readable condition
  icon: string; // Emoji icon
  weatherCode: number; // WMO weather code
}

// ============================================
// WMO Weather Code mapping
// ============================================

const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0: { condition: 'Ciel dégagé', icon: '☀️' },
  1: { condition: 'Principalement dégagé', icon: '🌤️' },
  2: { condition: 'Partiellement nuageux', icon: '⛅' },
  3: { condition: 'Couvert', icon: '☁️' },
  45: { condition: 'Brouillard', icon: '🌫️' },
  48: { condition: 'Brouillard givrant', icon: '🌫️' },
  51: { condition: 'Bruine légère', icon: '🌦️' },
  53: { condition: 'Bruine modérée', icon: '🌦️' },
  55: { condition: 'Bruine dense', icon: '🌧️' },
  56: { condition: 'Bruine verglaçante', icon: '🌧️' },
  57: { condition: 'Bruine verglaçante dense', icon: '🌧️' },
  61: { condition: 'Pluie légère', icon: '🌦️' },
  63: { condition: 'Pluie modérée', icon: '🌧️' },
  65: { condition: 'Pluie forte', icon: '🌧️' },
  66: { condition: 'Pluie verglaçante', icon: '🌧️' },
  67: { condition: 'Pluie verglaçante forte', icon: '🌧️' },
  71: { condition: 'Neige légère', icon: '🌨️' },
  73: { condition: 'Neige modérée', icon: '🌨️' },
  75: { condition: 'Neige forte', icon: '❄️' },
  77: { condition: 'Grains de neige', icon: '❄️' },
  80: { condition: 'Averses légères', icon: '🌦️' },
  81: { condition: 'Averses modérées', icon: '🌧️' },
  82: { condition: 'Averses violentes', icon: '🌧️' },
  85: { condition: 'Averses de neige', icon: '🌨️' },
  86: { condition: 'Averses de neige fortes', icon: '❄️' },
  95: { condition: 'Orage', icon: '⛈️' },
  96: { condition: 'Orage avec grêle', icon: '⛈️' },
  99: { condition: 'Orage violent avec grêle', icon: '⛈️' },
};

function decodeWeatherCode(code: number): { condition: string; icon: string } {
  return WMO_CODES[code] || { condition: 'Inconnu', icon: '❓' };
}

// ============================================
// Cache (file-based, same pattern as other services)
// ============================================

const CACHE_DIR = join(process.cwd(), '.cache', 'weather');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (weather changes)

function getCachePath(key: string): string {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  return join(CACHE_DIR, `${key}.json`);
}

function readCache(key: string): DailyWeatherForecast[] | null {
  const path = getCachePath(key);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    if (Date.now() - raw.timestamp > CACHE_TTL_MS) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: DailyWeatherForecast[]): void {
  try {
    const path = getCachePath(key);
    writeFileSync(path, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    // Non-critical
  }
}

// ============================================
// Main API
// ============================================

/**
 * Fetch weather forecast for a destination and date range.
 * Uses Open-Meteo free API (no key required).
 *
 * @param coords - Destination coordinates
 * @param startDate - Trip start date
 * @param durationDays - Number of days
 * @returns Array of daily weather forecasts
 */
export async function fetchWeatherForecast(
  coords: { lat: number; lng: number },
  startDate: Date,
  durationDays: number
): Promise<DailyWeatherForecast[]> {
  const start = formatDate(startDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays - 1);
  const end = formatDate(endDate);

  // Cache key based on coords (rounded) + dates
  const cacheKey = `weather-${coords.lat.toFixed(2)}-${coords.lng.toFixed(2)}-${start}-${end}`;
  const cached = readCache(cacheKey);
  if (cached) {
    console.log(`[Weather] Cache hit for ${start} → ${end}`);
    return cached;
  }

  // Open-Meteo supports forecasts up to 16 days ahead.
  // For dates beyond that, it falls back to historical/climate data.
  // We try forecast first, then fallback to historical averages.
  const now = new Date();
  const daysUntilStart = Math.floor((startDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  try {
    let forecasts: DailyWeatherForecast[];

    if (daysUntilStart <= 14) {
      // Within forecast range — use forecast API
      forecasts = await fetchFromForecastAPI(coords, start, end);
    } else {
      // Beyond forecast range — use climate/historical averages
      forecasts = await fetchFromClimateAPI(coords, startDate, durationDays);
    }

    if (forecasts.length > 0) {
      writeCache(cacheKey, forecasts);
      console.log(`[Weather] ${forecasts.length} days fetched for ${start} → ${end}`);
    }

    return forecasts;
  } catch (e) {
    console.warn('[Weather] Fetch failed (non-critical):', e instanceof Error ? e.message : e);
    return [];
  }
}

// ============================================
// Forecast API (< 16 days ahead)
// ============================================

async function fetchFromForecastAPI(
  coords: { lat: number; lng: number },
  startDate: string,
  endDate: string
): Promise<DailyWeatherForecast[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', coords.lat.toFixed(4));
  url.searchParams.set('longitude', coords.lng.toFixed(4));
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode');
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo forecast API error: ${response.status}`);
  }

  const data = await response.json();
  return parseOpenMeteoResponse(data);
}

// ============================================
// Climate/Historical API (> 16 days ahead)
// Uses historical weather for same dates last year as approximation
// ============================================

async function fetchFromClimateAPI(
  coords: { lat: number; lng: number },
  startDate: Date,
  durationDays: number
): Promise<DailyWeatherForecast[]> {
  // Use last year's data for the same dates as a climate approximation
  const lastYearStart = new Date(startDate);
  lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
  const lastYearEnd = new Date(lastYearStart);
  lastYearEnd.setDate(lastYearEnd.getDate() + durationDays - 1);

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', coords.lat.toFixed(4));
  url.searchParams.set('longitude', coords.lng.toFixed(4));
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weathercode');
  url.searchParams.set('start_date', formatDate(lastYearStart));
  url.searchParams.set('end_date', formatDate(lastYearEnd));
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo archive API error: ${response.status}`);
  }

  const data = await response.json();
  const historicalForecasts = parseOpenMeteoResponse(data);

  // Remap dates to the actual trip dates (not last year's)
  return historicalForecasts.map((f, i) => {
    const actualDate = new Date(startDate);
    actualDate.setDate(actualDate.getDate() + i);
    return {
      ...f,
      date: formatDate(actualDate),
    };
  });
}

// ============================================
// Response parser
// ============================================

function parseOpenMeteoResponse(data: any): DailyWeatherForecast[] {
  const daily = data?.daily;
  if (!daily?.time || !daily?.temperature_2m_max || !daily?.temperature_2m_min || !daily?.weathercode) {
    return [];
  }

  return daily.time.map((date: string, i: number) => {
    const code = daily.weathercode[i] ?? 0;
    const { condition, icon } = decodeWeatherCode(code);

    return {
      date,
      tempMin: Math.round(daily.temperature_2m_min[i] ?? 0),
      tempMax: Math.round(daily.temperature_2m_max[i] ?? 0),
      condition,
      icon,
      weatherCode: code,
    };
  });
}

// ============================================
// Helpers
// ============================================

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
