import type { TripItem } from '../../types';

export type LonghaulDirection = 'outbound' | 'return';
export type LonghaulTransitLeg = NonNullable<TripItem['transitLegs']>[number];

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeLegDurationMinutes(leg: LonghaulTransitLeg): number {
  if (typeof leg.duration === 'number' && Number.isFinite(leg.duration) && leg.duration > 0) {
    return Math.max(1, Math.round(leg.duration));
  }

  const dep = parseIsoDate(leg.departure);
  const arr = parseIsoDate(leg.arrival);
  if (dep && arr && arr.getTime() > dep.getTime()) {
    return Math.max(1, Math.round((arr.getTime() - dep.getTime()) / 60000));
  }

  return 30;
}

function scaleDurationsToWindow(
  durations: number[],
  availableMinutes: number
): number[] {
  if (durations.length === 0 || availableMinutes <= 0) return durations;

  const total = durations.reduce((sum, d) => sum + d, 0);
  if (total <= 0) return durations;
  if (Math.abs(total - availableMinutes) <= 1) return durations.slice();

  const scaled = durations.map((d) => Math.max(1, Math.round((d / total) * availableMinutes)));
  const scaledTotal = scaled.reduce((sum, d) => sum + d, 0);
  const delta = availableMinutes - scaledTotal;
  if (delta !== 0) {
    const idx = scaled.length - 1;
    scaled[idx] = Math.max(1, scaled[idx] + delta);
  }
  return scaled;
}

function swapOmioRouteDirection(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 3) return pathname;

  const supportedModes = new Set(['trains', 'bus', 'vols']);
  let modeIndex = 0;
  const maybeLocale = segments[0];

  if (
    !supportedModes.has(maybeLocale)
    && segments.length >= 4
    && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(maybeLocale)
    && supportedModes.has(segments[1])
  ) {
    modeIndex = 1;
  }

  if (!supportedModes.has(segments[modeIndex])) return pathname;

  const fromIndex = modeIndex + 1;
  const toIndex = modeIndex + 2;
  if (!segments[fromIndex] || !segments[toIndex]) return pathname;

  [segments[fromIndex], segments[toIndex]] = [segments[toIndex], segments[fromIndex]];
  return `/${segments.join('/')}`;
}

export function normalizeReturnTransportBookingUrl(
  rawUrl: string | undefined,
  returnDate: Date,
  options: { swapOmioDirection?: boolean } = {}
): string | undefined {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const dateStr = toIsoDate(returnDate);

    if (options.swapOmioDirection) {
      url.pathname = swapOmioRouteDirection(url.pathname);
    }

    if (url.searchParams.has('departure_date')) {
      url.searchParams.set('departure_date', dateStr);
    }
    if (url.searchParams.has('rideDate')) {
      url.searchParams.set('rideDate', dateStr);
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function getTransitLegsDurationMinutes(legs?: LonghaulTransitLeg[]): number {
  if (!legs || legs.length === 0) return 0;
  return legs.reduce((sum, leg) => sum + computeLegDurationMinutes(leg), 0);
}

export function rebaseTransitLegsToTimeline(args: {
  transitLegs?: LonghaulTransitLeg[];
  startTime: Date;
  direction?: LonghaulDirection;
  windowEndTime?: Date;
  fitToWindow?: boolean;
}): LonghaulTransitLeg[] | undefined {
  const { transitLegs, startTime, direction = 'outbound', windowEndTime, fitToWindow = false } = args;
  if (!transitLegs || transitLegs.length === 0) return undefined;

  const baseLegs = direction === 'return'
    ? transitLegs.slice().reverse().map((leg) => ({
        ...leg,
        from: leg.to,
        to: leg.from,
      }))
    : transitLegs.slice().map((leg) => ({ ...leg }));

  const baseDurations = baseLegs.map((leg) => computeLegDurationMinutes(leg));
  const shouldFitToWindow = fitToWindow && windowEndTime && windowEndTime.getTime() > startTime.getTime();
  const durations = shouldFitToWindow
    ? scaleDurationsToWindow(baseDurations, Math.max(1, Math.round((windowEndTime!.getTime() - startTime.getTime()) / 60000)))
    : baseDurations;

  let cursorMs = startTime.getTime();
  return baseLegs.map((leg, idx) => {
    const dep = new Date(cursorMs);
    const durMinutes = Math.max(1, durations[idx] || computeLegDurationMinutes(leg));
    const arr = new Date(cursorMs + durMinutes * 60000);
    cursorMs = arr.getTime();

    return {
      ...leg,
      departure: dep.toISOString(),
      arrival: arr.toISOString(),
      duration: durMinutes,
    };
  });
}

export function inferLonghaulDirectionFromItem(
  item: Pick<TripItem, 'transportDirection' | 'transportRole' | 'id' | 'title'>
): LonghaulDirection {
  if (item.transportDirection === 'outbound' || item.transportDirection === 'return') {
    return item.transportDirection;
  }
  if (item.transportRole === 'daytrip_return') return 'return';
  if (item.transportRole === 'daytrip_outbound') return 'outbound';
  if ((item.id || '').includes('transport-ret-') || /retour/i.test(item.title || '')) return 'return';
  return 'outbound';
}

export function buildTrainDescription(
  prefix: string,
  operators: Array<string | undefined>
): string {
  const seen = new Set<string>();
  const unique = operators
    .map((value) => (value || '').trim())
    .filter((value) => value.length > 0)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (unique.length === 0) {
    return `${prefix} (operateur non disponible)`;
  }
  return `${prefix} ${unique.join(' / ')}`;
}
