import { calculateDistance } from './geocoding';

export interface DestinationEnvelopeBBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface DestinationEnvelope {
  center: { lat: number; lng: number };
  bbox: DestinationEnvelopeBBox;
  radiusKm: number;
  bufferKm: number;
  country?: string;
  admin?: string;
  displayName?: string;
  source: 'nominatim' | 'resolved_cities' | 'fallback_center';
  confidence: 'high' | 'medium' | 'low';
}

interface DestinationEnvelopeOptions {
  resolvedCityCoords?: Array<{ lat: number; lng: number }>;
  fallbackCenter?: { lat: number; lng: number };
}

interface NominatimAddress {
  country?: string;
  state?: string;
  region?: string;
  county?: string;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  boundingbox?: [string, string, string, string];
  address?: NominatimAddress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function deriveBufferKm(radiusKm: number): number {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return 12;
  return clamp(radiusKm * 0.1, 8, 35);
}

function bboxFromCenter(center: { lat: number; lng: number }, radiusKm: number): DestinationEnvelopeBBox {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
  const lonDelta = radiusKm / (111.32 * cosLat);
  return {
    south: center.lat - latDelta,
    north: center.lat + latDelta,
    west: center.lng - lonDelta,
    east: center.lng + lonDelta,
  };
}

function computeRadiusFromBbox(center: { lat: number; lng: number }, bbox: DestinationEnvelopeBBox): number {
  const corners = [
    { lat: bbox.south, lng: bbox.west },
    { lat: bbox.south, lng: bbox.east },
    { lat: bbox.north, lng: bbox.west },
    { lat: bbox.north, lng: bbox.east },
  ];
  const maxDist = Math.max(...corners.map((corner) => calculateDistance(center.lat, center.lng, corner.lat, corner.lng)));
  return clamp(maxDist, 10, 450);
}

function parseNominatimBBox(raw?: [string, string, string, string]): DestinationEnvelopeBBox | null {
  if (!raw || raw.length !== 4) return null;
  const south = Number.parseFloat(raw[0]);
  const north = Number.parseFloat(raw[1]);
  const west = Number.parseFloat(raw[2]);
  const east = Number.parseFloat(raw[3]);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  if (south > north) return null;
  return { south, north, west, east };
}

function bboxFromPoints(points: Array<{ lat: number; lng: number }>, paddingKm: number): DestinationEnvelopeBBox | null {
  const valid = points.filter((point) => isFiniteCoord(point.lat, point.lng));
  if (valid.length === 0) return null;
  let south = valid[0].lat;
  let north = valid[0].lat;
  let west = valid[0].lng;
  let east = valid[0].lng;
  for (const point of valid) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  const center = { lat: (south + north) / 2, lng: (west + east) / 2 };
  const padded = bboxFromCenter(center, paddingKm);
  return {
    south: Math.min(south, padded.south),
    north: Math.max(north, padded.north),
    west: Math.min(west, padded.west),
    east: Math.max(east, padded.east),
  };
}

export function getEnvelopeAdaptiveRadiusKm(envelope: DestinationEnvelope): number {
  return clamp(envelope.radiusKm + envelope.bufferKm, 20, 320);
}

export function isPointWithinDestinationEnvelope(
  point: { lat: number; lng: number },
  envelope: DestinationEnvelope,
  options?: { extraBufferKm?: number }
): boolean {
  if (!isFiniteCoord(point.lat, point.lng)) return false;
  const extra = Math.max(0, options?.extraBufferKm || 0);
  const totalBuffer = envelope.bufferKm + extra;
  const latBufferDeg = totalBuffer / 111.32;
  const cosLat = Math.max(0.2, Math.cos((envelope.center.lat * Math.PI) / 180));
  const lonBufferDeg = totalBuffer / (111.32 * cosLat);
  const withinLat = point.lat >= envelope.bbox.south - latBufferDeg && point.lat <= envelope.bbox.north + latBufferDeg;
  const withinLng = point.lng >= envelope.bbox.west - lonBufferDeg && point.lng <= envelope.bbox.east + lonBufferDeg;
  return withinLat && withinLng;
}

export async function buildDestinationEnvelope(
  destination: string,
  options?: DestinationEnvelopeOptions
): Promise<DestinationEnvelope | null> {
  const query = (destination || '').trim();
  if (!query) return null;

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      'accept-language': 'fr,en',
    });
    if (process.env.NOMINATIM_EMAIL) {
      params.set('email', process.env.NOMINATIM_EMAIL);
    }

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'voyage-planner/1.0' },
      next: { revalidate: 3600 },
    });
    if (response.ok) {
      const payload = (await response.json()) as NominatimResult[];
      const first = Array.isArray(payload) ? payload[0] : null;
      const bbox = parseNominatimBBox(first?.boundingbox);
      const lat = Number.parseFloat(first?.lat || '');
      const lng = Number.parseFloat(first?.lon || '');
      if (bbox) {
        const center = isFiniteCoord(lat, lng)
          ? { lat, lng }
          : { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 };
        const radiusKm = computeRadiusFromBbox(center, bbox);
        return {
          center,
          bbox,
          radiusKm,
          bufferKm: deriveBufferKm(radiusKm),
          country: first?.address?.country,
          admin: first?.address?.state || first?.address?.region || first?.address?.county,
          displayName: first?.display_name,
          source: 'nominatim',
          confidence: 'high',
        };
      }
    }
  } catch (error) {
    console.warn('[DestinationEnvelope] Nominatim envelope lookup failed:', error);
  }

  const resolvedBBox = bboxFromPoints(options?.resolvedCityCoords || [], 12);
  if (resolvedBBox) {
    const center = {
      lat: (resolvedBBox.south + resolvedBBox.north) / 2,
      lng: (resolvedBBox.west + resolvedBBox.east) / 2,
    };
    const radiusKm = computeRadiusFromBbox(center, resolvedBBox);
    return {
      center,
      bbox: resolvedBBox,
      radiusKm,
      bufferKm: deriveBufferKm(radiusKm),
      source: 'resolved_cities',
      confidence: 'medium',
    };
  }

  if (options?.fallbackCenter && isFiniteCoord(options.fallbackCenter.lat, options.fallbackCenter.lng)) {
    const radiusKm = 30;
    return {
      center: options.fallbackCenter,
      bbox: bboxFromCenter(options.fallbackCenter, radiusKm),
      radiusKm,
      bufferKm: deriveBufferKm(radiusKm),
      source: 'fallback_center',
      confidence: 'low',
    };
  }

  return null;
}
