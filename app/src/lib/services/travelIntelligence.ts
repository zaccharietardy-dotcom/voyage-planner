import type { Trip } from '@/lib/types';

export interface TravelIntelligenceData {
  currency?: {
    code: string;
    name: string;
    symbol: string;
    exchangeRate?: number; // vs EUR
  };
  holidays?: {
    name: string;
    date: string;
    type: string;
  }[];
  weatherSummary?: {
    avgTempMin: number;
    avgTempMax: number;
    mainCondition: string;
  };
  emergencyNumbers?: {
    police: string;
    ambulance: string;
    fire: string;
  };
}

// Map of common destination countries to their currencies
const COUNTRY_CURRENCIES: Record<string, { code: string; name: string; symbol: string }> = {
  'japon': { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  'japan': { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  'tokyo': { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  'kyoto': { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  'osaka': { code: 'JPY', name: 'Yen japonais', symbol: '¥' },
  'états-unis': { code: 'USD', name: 'Dollar américain', symbol: '$' },
  'usa': { code: 'USD', name: 'Dollar américain', symbol: '$' },
  'new york': { code: 'USD', name: 'Dollar américain', symbol: '$' },
  'los angeles': { code: 'USD', name: 'Dollar américain', symbol: '$' },
  'royaume-uni': { code: 'GBP', name: 'Livre sterling', symbol: '£' },
  'london': { code: 'GBP', name: 'Livre sterling', symbol: '£' },
  'londres': { code: 'GBP', name: 'Livre sterling', symbol: '£' },
  'suisse': { code: 'CHF', name: 'Franc suisse', symbol: 'CHF' },
  'thaïlande': { code: 'THB', name: 'Baht thaïlandais', symbol: '฿' },
  'thailand': { code: 'THB', name: 'Baht thaïlandais', symbol: '฿' },
  'bangkok': { code: 'THB', name: 'Baht thaïlandais', symbol: '฿' },
  'maroc': { code: 'MAD', name: 'Dirham marocain', symbol: 'MAD' },
  'marrakech': { code: 'MAD', name: 'Dirham marocain', symbol: 'MAD' },
  'turquie': { code: 'TRY', name: 'Livre turque', symbol: '₺' },
  'istanbul': { code: 'TRY', name: 'Livre turque', symbol: '₺' },
  'mexique': { code: 'MXN', name: 'Peso mexicain', symbol: '$' },
  'canada': { code: 'CAD', name: 'Dollar canadien', symbol: 'CA$' },
  'australie': { code: 'AUD', name: 'Dollar australien', symbol: 'A$' },
  'brésil': { code: 'BRL', name: 'Real brésilien', symbol: 'R$' },
  'inde': { code: 'INR', name: 'Roupie indienne', symbol: '₹' },
  'corée': { code: 'KRW', name: 'Won sud-coréen', symbol: '₩' },
  'seoul': { code: 'KRW', name: 'Won sud-coréen', symbol: '₩' },
  'chine': { code: 'CNY', name: 'Yuan chinois', symbol: '¥' },
  'pékin': { code: 'CNY', name: 'Yuan chinois', symbol: '¥' },
  // Euro zone countries - no need to show exchange rate
};

/**
 * Build travel intelligence data from trip info
 */
export function buildTravelIntelligence(trip: Trip): TravelIntelligenceData {
  const destination = (trip.preferences.destination || '').toLowerCase();
  const data: TravelIntelligenceData = {};

  // Currency
  for (const [key, currency] of Object.entries(COUNTRY_CURRENCIES)) {
    if (destination.includes(key)) {
      data.currency = currency;
      break;
    }
  }

  // Weather summary from trip days
  const weatherData = trip.days
    .map(d => d.weatherForecast)
    .filter((w): w is NonNullable<typeof w> => !!w);

  if (weatherData.length > 0) {
    const avgMin = Math.round(weatherData.reduce((s, w) => s + w.tempMin, 0) / weatherData.length);
    const avgMax = Math.round(weatherData.reduce((s, w) => s + w.tempMax, 0) / weatherData.length);
    const conditions = weatherData.map(w => w.condition);
    const mainCondition = conditions.sort((a, b) =>
      conditions.filter(v => v === b).length - conditions.filter(v => v === a).length
    )[0] || 'Variable';

    data.weatherSummary = { avgTempMin: avgMin, avgTempMax: avgMax, mainCondition };
  }

  // Emergency numbers from travel tips
  if (trip.travelTips?.emergency) {
    data.emergencyNumbers = {
      police: trip.travelTips.emergency.police,
      ambulance: trip.travelTips.emergency.ambulance,
      fire: trip.travelTips.emergency.fire,
    };
  }

  return data;
}
