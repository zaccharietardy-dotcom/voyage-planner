'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { TripItem, TRIP_ITEM_COLORS, ImportedPlace } from '@/lib/types';
import { AIRPORTS } from '@/lib/services/geocoding';
import type { PriceCell } from '@/lib/services/neighbourhoodPricing';
import { renderNeighbourhoodOverlay } from './NeighbourhoodMap';
import { cn } from '@/lib/utils';
import { 
  Maximize2, 
  Minimize2, 
  Globe, 
  PlusCircle, 
  MinusCircle, 
  MapPin, 
  Info 
} from 'lucide-react';

interface TripMapProps {
  items: TripItem[];
  selectedItemId?: string;
  onItemClick?: (item: TripItem) => void;
  hoveredItemId?: string;
  mapNumbers?: Map<string, number>;
  isVisible?: boolean;
  importedPlaces?: ImportedPlace[];
  flightInfo?: {
    departureCity?: string;
    departureCoords?: { lat: number; lng: number };
    arrivalCity?: string;
    arrivalCoords?: { lat: number; lng: number };
    stopoverCities?: string[];
  };
  neighbourhoodCells?: PriceCell[];
}

// ─── Constants ──────────────────────────────────────────────

const DAY_COLORS: { bg: string; border: string; text: string }[] = [
  { bg: '#0f172a', border: '#c5a059', text: '#ffffff' }, // Deep Blue & Gold — Jour 1
  { bg: '#1e293b', border: '#c5a059', text: '#ffffff' }, // Slate Blue & Gold — Jour 2
  { bg: '#334155', border: '#c5a059', text: '#ffffff' }, // Muted Blue & Gold — Jour 3
  { bg: '#020617', border: '#c5a059', text: '#ffffff' }, // Midnight & Gold — Jour 4
  { bg: '#0f172a', border: '#c5a059', text: '#ffffff' }, // Repeat with subtle variations
  { bg: '#1e293b', border: '#c5a059', text: '#ffffff' },
  { bg: '#334155', border: '#c5a059', text: '#ffffff' },
  { bg: '#020617', border: '#c5a059', text: '#ffffff' },
  { bg: '#0f172a', border: '#c5a059', text: '#ffffff' },
  { bg: '#1e293b', border: '#c5a059', text: '#ffffff' },
];
const DEFAULT_DAY_COLOR = { bg: '#0f172a', border: '#c5a059', text: '#ffffff' };

function getDayColor(dayNumber: number) {
  if (dayNumber < 1) return DEFAULT_DAY_COLOR;
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}

const TYPE_SHAPES: Record<string, { containerCss: string; innerCss: string }> = {
  activity:   { containerCss: 'border-radius:12px;', innerCss: '' },
  restaurant: { containerCss: 'border-radius:6px;', innerCss: '' },
  transport:  { containerCss: 'border-radius:6px;transform:rotate(45deg);', innerCss: 'transform:rotate(-45deg);' },
  flight:     { containerCss: 'border-radius:6px;transform:rotate(45deg);', innerCss: 'transform:rotate(-45deg);' },
  hotel:      { containerCss: 'border-radius:12px 12px 4px 4px;', innerCss: '' },
  checkin:    { containerCss: 'border-radius:12px 12px 4px 4px;', innerCss: '' },
  checkout:   { containerCss: 'border-radius:12px 12px 4px 4px;', innerCss: '' },
  parking:    { containerCss: 'border-radius:50%;border-style:dashed !important;', innerCss: '' },
  luggage:    { containerCss: 'border-radius:50%;border-style:dashed !important;', innerCss: '' },
  free_time:  { containerCss: 'border-radius:50%;border-style:dashed !important;', innerCss: '' },
};

const TYPE_LABELS: Record<string, string> = {
  activity: 'Activité',
  restaurant: 'Restaurant',
  hotel: 'Hôtel',
  transport: 'Transport',
  flight: 'Vol',
  parking: 'Parking',
  checkin: 'Check-in',
  checkout: 'Check-out',
  luggage: 'Bagages',
};

const TYPE_EMOJIS: Record<string, string> = {
  activity:   '🏛️',
  restaurant: '🍴',
  hotel:      '🏨',
  checkin:    '🔑',
  checkout:   '🧳',
  transport:  '🚇',
  flight:     '✈️',
  parking:    '🅿️',
  luggage:    '🧳',
  free_time:  '☕',
};

// ─── Helpers ────────────────────────────────────────────────

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseSortableTime(time?: string): number {
  if (!time) return Number.MAX_SAFE_INTEGER;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
  return h * 60 + m;
}

/**
 * Decode Google's encoded polyline into [lat, lng] pairs.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/** Format minutes into compact travel time label */
function formatTravelTime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function compareItemsForRoute(a: TripItem, b: TripItem): number {
  const dayDiff = (a.dayNumber || 0) - (b.dayNumber || 0);
  if (dayDiff !== 0) return dayDiff;

  const aOrder = typeof a.orderIndex === 'number' ? a.orderIndex : Number.MAX_SAFE_INTEGER;
  const bOrder = typeof b.orderIndex === 'number' ? b.orderIndex : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;

  return parseSortableTime(a.startTime) - parseSortableTime(b.startTime);
}

function createNumberedIcon(L: any, num: number, type: string, dayNumber: number, isHighlighted: boolean) {
  const colors = getDayColor(dayNumber);
  const shape = TYPE_SHAPES[type] || TYPE_SHAPES.activity;
  const size = isHighlighted ? 44 : 38;
  const emoji = TYPE_EMOJIS[type] || '📍';
  const shadow = isHighlighted
    ? `box-shadow: 0 0 25px rgba(197, 160, 89, 0.6), 0 8px 20px rgba(0,0,0,0.4);`
    : 'box-shadow: 0 4px 12px rgba(0,0,0,0.2);';

  const isLosange = type === 'transport' || type === 'flight';
  let containerTransform = '';
  if (isLosange) {
    containerTransform = isHighlighted
      ? 'transform:rotate(45deg) scale(1.1);z-index:1000;'
      : 'transform:rotate(45deg);';
  } else {
    containerTransform = isHighlighted ? 'transform:scale(1.1);z-index:1000;' : '';
  }

  const shapeCss = isLosange
    ? shape.containerCss.replace('transform:rotate(45deg);', '')
    : shape.containerCss;

  // Premium Marker: Gold background, White border, Dark Blue text
  return L.divIcon({
    className: 'numbered-marker',
    html: `<div style="
      width:${size}px;height:${size}px;
      ${shapeCss}
      background:linear-gradient(135deg, #c5a059 0%, #a37f3d 100%);
      border:2px solid white;
      color:#020617;
      display:flex;align-items:center;justify-content:center;
      ${shadow}
      transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      ${containerTransform}
    ">
      <span style="font-family:'Playfair Display', serif; font-size:${size * 0.45}px; font-weight:800; ${shape.innerCss}">${num}</span>
      <div style="
        position:absolute;
        top:-8px;
        right:-8px;
        background:#020617;
        width:20px;height:20px;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;
        border:1.5px solid #c5a059;
        box-shadow:0 2px 4px rgba(0,0,0,0.3);
        ${shape.innerCss}
      ">${emoji}</div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function createEmojiIcon(L: any, type: string, dayNumber: number) {
  const emoji = TYPE_EMOJIS[type] || '📍';
  const bgColors: Record<string, string> = {
    restaurant: '#F97316',
    hotel: '#8B5CF6',
  };
  const bg = bgColors[type] || '#64748b';
  const size = 36;

  return L.divIcon({
    className: 'emoji-marker',
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${bg};
      border:2px solid white;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      font-size:18px;
    ">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function safeImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  try { const u = new URL(url); return u.protocol === 'https:' ? url : ''; }
  catch { return ''; }
}

function getPopupContent(item: TripItem, index: number): string {
  const color = getDayColor(item.dayNumber).bg;
  const googleMapsUrl = item.googleMapsPlaceUrl ||
    item.googleMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;

  const maxW = typeof window !== 'undefined' ? Math.min(300, window.innerWidth - 40) : 300;

  // Hardcoded colors for premium look
  const textColor = '#020617';
  const mutedColor = '#64748b';
  const goldColor = '#c5a059';
  const borderColor = '#e2e8f0';

  // Build transport fallback from available metadata
  const transportModeFallback = (() => {
    if (item.type !== 'transport') return '';
    const modeLabels: Record<string, string> = { walk: 'Marche', public: 'Transport en commun', car: 'Voiture' };
    const label = modeLabels[item.transportToPrevious || ''] || 'Déplacement';
    const dist = item.distanceFromPrevious;
    if (dist) {
      return dist < 1 ? `${label} — ${Math.round(dist * 1000)}m` : `${label} — ${dist.toFixed(1)}km`;
    }
    return label;
  })();

  // For transport: use description (from→to) as display title, fallback to mode info
  const displayTitle = item.type === 'transport'
    ? (item.description || item.title || transportModeFallback)
    : (item.title || '');

  // Photo — onerror hides only the img, not the container
  const sanitizedImageUrl = safeImageUrl(item.imageUrl || '');
  const hasImage = !!sanitizedImageUrl;
  const imageHtml = hasImage
    ? `<div style="position:relative;width:100%;height:160px;overflow:hidden;border-radius:15px 15px 0 0;background:#0f172a;">
        <img src="${sanitizedImageUrl}" alt="${escapeHtml(displayTitle)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" />
        <div style="position:absolute;bottom:0;left:0;right:0;height:80px;background:linear-gradient(transparent,rgba(2,6,23,0.9));"></div>
        <div style="position:absolute;bottom:12px;left:15px;right:15px;display:flex;align-items:center;gap:10px;">
          <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg, #c5a059 0%, #a37f3d 100%);color:white;font-family:'Playfair Display', serif;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,255,255,0.3);box-shadow:0 4px 10px rgba(0,0,0,0.3);">${index}</div>
          <div style="font-family:'Playfair Display', serif;font-size:16px;font-weight:700;color:white;text-shadow:0 2px 4px rgba(0,0,0,0.5);line-height:1.2;">${escapeHtml(displayTitle)}</div>
        </div>
      </div>`
    : '';

  // Title row (always show if no image)
  const titleHtml = hasImage ? '' : `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg, #c5a059 0%, #a37f3d 100%);color:white;font-family:'Playfair Display', serif;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${index}</div>
      <div style="font-family:'Playfair Display', serif;font-size:16px;font-weight:700;line-height:1.2;color:${textColor};">${escapeHtml(displayTitle)}</div>
    </div>`;

  // Transport mode details — show mode info (from title or fallback)
  const transportModeText = item.type === 'transport' ? (item.title || transportModeFallback) : '';
  const transportDetailsHtml = item.type === 'transport' && transportModeText
    ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${mutedColor};margin-bottom:6px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span style="font-weight:600;color:${textColor};">${escapeHtml(transportModeText)}</span>
      </div>`
    : '';

  // Time display — trim startTime to avoid invisible whitespace
  const startTimeTrimmed = item.startTime?.trim() || '';
  const timeHtml = startTimeTrimmed
    ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${mutedColor};margin-bottom:6px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span style="font-weight:700;color:${textColor};letter-spacing:0.02em;">${escapeHtml(startTimeTrimmed)}${item.endTime ? ` – ${escapeHtml(item.endTime)}` : ''}</span>
        ${item.duration ? `<span style="color:${goldColor};font-weight:600;margin-left:4px;">${item.duration} min</span>` : ''}
      </div>`
    : item.duration
      ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:${mutedColor};margin-bottom:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${goldColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span style="color:${goldColor};font-weight:600;">${item.duration} min</span>
        </div>`
      : '';

  // Rating + cost
  const metaParts: string[] = [];
  if (item.rating) metaParts.push(`<span style="color:${goldColor};font-weight:700;">${item.rating.toFixed(1)}★</span>`);
  if (item.estimatedCost) metaParts.push(`<span style="font-weight:600;">~${item.estimatedCost}€</span>`);
  if (item.locationName) metaParts.push(escapeHtml(item.locationName));
  const metaHtml = metaParts.length > 0
    ? `<div style="font-size:11px;color:${mutedColor};margin-top:4px;display:flex;align-items:center;gap:8px;">${metaParts.join('<span style="opacity:0.3;">·</span>')}</div>`
    : '';

  // Action links
  const links = [`<a href="${escapeHtml(googleMapsUrl)}" target="_blank" style="background:${goldColor}15;color:${goldColor};padding:6px 12px;border-radius:8px;font-size:11px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;border:1px solid ${goldColor}30;transition:all 0.2s;">Itinéraire</a>`];
  if (item.bookingUrl) links.push(`<a href="${escapeHtml(item.bookingUrl)}" target="_blank" style="background:${goldColor};color:white;padding:6px 12px;border-radius:8px;font-size:11px;text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;box-shadow:0 4px 10px ${goldColor}40;">Réserver</a>`);

  return `
    <div style="min-width:220px;max-width:${maxW}px;font-family:system-ui,-apple-system,sans-serif;color:${textColor};">
      ${imageHtml}
      <div style="padding:${hasImage ? '15px 15px 15px' : '5px 0'};">
        ${titleHtml}
        ${transportDetailsHtml}
        ${timeHtml}
        ${metaHtml}
        <div style="display:flex;gap:10px;margin-top:15px;padding-top:12px;border-top:1px solid ${borderColor};">
          ${links.join('')}
        </div>
      </div>
    </div>
  `;
}


// ─── Inline styles for Leaflet overrides ────────────────────

const LEAFLET_STYLE_OVERRIDES = `
.clean-popup .leaflet-popup-content-wrapper {
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.15);
  padding: 0;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid rgba(197, 160, 89, 0.2);
}
.clean-popup .leaflet-popup-content {
  margin: 15px;
  margin-top: 0;
  width: auto !important;
}
.clean-popup .leaflet-popup-content img {
  margin-left: -15px;
  margin-right: -15px;
  width: calc(100% + 30px) !important;
  max-width: none !important;
}
.clean-popup .leaflet-popup-tip {
  background: #ffffff;
  border: 1px solid rgba(197, 160, 89, 0.1);
}
.dark .clean-popup .leaflet-popup-content-wrapper {
  background: #020617;
  border-color: rgba(197, 160, 89, 0.1);
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.dark .clean-popup .leaflet-popup-tip {
  background: #020617;
}
.direction-arrow, .numbered-marker, .origin-marker, .plane-marker {
  background: none !important;
  border: none !important;
}
.numbered-marker {
  z-index: 500 !important;
  cursor: pointer !important;
}
.leaflet-popup {
  z-index: 1100 !important;
}
.leaflet-control-attribution {
  font-size: 9px !important;
  opacity: 0.4 !important;
}
@keyframes dashflow {
  to { stroke-dashoffset: -20; }
}
.animated-route {
  animation: dashflow 1.2s linear infinite;
}
.route-label {
  background: none !important;
  border: none !important;
  z-index: 400 !important;
}
`;

// ─── Component ──────────────────────────────────────────────

export function TripMap({ items, selectedItemId, onItemClick, hoveredItemId, mapNumbers, isVisible = true, importedPlaces, flightInfo, neighbourhoodCells }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const polylineDecoratorRef = useRef<any>(null);

  // Layer groups for explicit cleanup
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);

  // Marker references for hover/selection
  const markerMapRef = useRef<Map<string, { marker: any; num: number; type: string; dayNumber: number }>>(new Map());

  // Stored bounds for "fit all" button
  const storedBoundsRef = useRef<any>(null);

  // Track if initial fitBounds has been done
  const isInitialFitRef = useRef(true);

  // Stable ref for onItemClick to avoid rebuilding markers on parent re-renders
  const onItemClickRef = useRef(onItemClick);
  useEffect(() => { onItemClickRef.current = onItemClick; }, [onItemClick]);

  // Stable ref for items to use in selection effect
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [filterDay, setFilterDay] = useState<number | null>(null);
  const [showNeighbourhoods, setShowNeighbourhoods] = useState(false);

  // Compute stable items key to detect real changes
  const itemsKey = useMemo(() => items.map(i => i.id).sort().join(','), [items]);
  // Track last itemsKey that triggered fitBounds — prevents re-centering on unrelated effect re-runs
  const lastFitItemsKeyRef = useRef<string>('');

  // Get unique day numbers for filter chips
  const dayNumbers = useMemo(() => {
    const days = new Set<number>();
    items.forEach(i => { if (i.dayNumber) days.add(i.dayNumber); });
    return Array.from(days).sort((a, b) => a - b);
  }, [items]);

  // Filtered items based on day filter
  const displayItems = useMemo(() => {
    if (filterDay === null) return items;
    return items.filter(i => i.dayNumber === filterDay);
  }, [items, filterDay]);

  // Per-day summary for the map legend overlay
  const daySummaries = useMemo(() => {
    const summaries: { dayNum: number; totalKm: number; color: string }[] = [];
    const byDay = new Map<number, TripItem[]>();
    displayItems.forEach((item) => {
      const d = item.dayNumber || 0;
      const list = byDay.get(d);
      if (list) list.push(item);
      else byDay.set(d, [item]);
    });
    Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([dayNum, dayItems]) => {
        const totalKm = dayItems
          .filter(i => i.distanceFromPrevious)
          .reduce((s, i) => s + (i.distanceFromPrevious || 0), 0);
        summaries.push({
          dayNum,
          totalKm,
          color: getDayColor(dayNum).bg,
        });
      });
    return summaries;
  }, [displayItems]);

  // ─── Load Leaflet ────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadLeaflet = async () => {
      try {
        const L = await import('leaflet');
        leafletRef.current = L.default;

        // Load polyline decorator
        const PolylineDecorator = await import('leaflet-polylinedecorator');
        polylineDecoratorRef.current = PolylineDecorator.default;

        // Inject Leaflet CSS
        if (!document.getElementById('leaflet-css')) {
          const link = document.createElement('link');
          link.id = 'leaflet-css';
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);
        }

        // Inject custom style overrides
        if (!document.getElementById('tripmap-css')) {
          const style = document.createElement('style');
          style.id = 'tripmap-css';
          style.textContent = LEAFLET_STYLE_OVERRIDES;
          document.head.appendChild(style);
        }

        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load Leaflet:', error);
      }
    };
    loadLeaflet();
  }, []);

  // ─── Create map instance (once) ─────────────────────────

  useEffect(() => {
    if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = leafletRef.current;
    if (!L) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([48.8566, 2.3522], 3);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Create persistent layer groups
    markerLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, [isLoaded]); // NO center dependency — map created once

  // ─── invalidateSize on visibility change / tab switch ───

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isVisible) return;
    // Small delay to let the DOM update (tab transition)
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [isVisible]);

  // ResizeObserver fallback for dynamic container size changes
  useEffect(() => {
    const container = mapRef.current;
    const map = mapInstanceRef.current;
    if (!container || !map) return;

    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isLoaded]);

  // ─── Build markers & routes (on real item changes only) ──

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    const markerLayer = markerLayerRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !L || !markerLayer || !routeLayer) return;

    // Clear previous layers cleanly
    markerLayer.clearLayers();
    routeLayer.clearLayers();
    markerMapRef.current.clear();

    if (displayItems.length === 0) {
      storedBoundsRef.current = null;
      return;
    }

    const bounds = L.latLngBounds([]);
    let globalIndex = 1;

    // Add markers — only activities get sequential numbers
    // Transport, checkin, checkout, luggage, free_time, parking are hidden from map to reduce clutter
    const HIDDEN_TYPES = new Set(['transport', 'flight', 'checkin', 'checkout', 'luggage', 'free_time', 'parking']);
    displayItems.forEach((item) => {
      if (!item.latitude || !item.longitude) return;
      if (HIDDEN_TYPES.has(item.type)) return;
      // Activities get sequential numbers, restaurants/hotels get emoji-only (num=0)
      const isNumbered = item.type === 'activity';
      const num = isNumbered ? (mapNumbers?.get(item.id) ?? globalIndex++) : 0;
      const icon = isNumbered
        ? createNumberedIcon(L, num, item.type, item.dayNumber, false)
        : createEmojiIcon(L, item.type, item.dayNumber);

      const marker = L.marker([item.latitude, item.longitude], { icon, interactive: true })
        .bindPopup(getPopupContent(item, num), {
          maxWidth: typeof window !== 'undefined' ? Math.min(280, window.innerWidth - 60) : 280,
          className: 'clean-popup',
        });

      // Use popupopen instead of click to avoid conflicts with Leaflet's popup toggle
      marker.on('popupopen', () => onItemClickRef.current?.(item));

      markerLayer.addLayer(marker);
      markerMapRef.current.set(item.id, { marker, num, type: item.type, dayNumber: item.dayNumber });
      bounds.extend([item.latitude, item.longitude]);
    });

    // NOTE: Departure (origin) coords intentionally NOT added to bounds.
    // But ARRIVAL airport at destination IS added — the user wants to see the route
    // from the airport to the first activity.
    const flightItems = displayItems.filter(i => i.type === 'flight');
    const arrivalAirportCoords = new Map<number, [number, number]>(); // dayNumber → coords
    const departureAirportCoords = new Map<number, [number, number]>();
    for (const fi of flightItems) {
      const arrCode = fi.flight?.arrivalAirportCode;
      if (fi.orderIndex === 0 && arrCode) {
        // Arrival flight — look up arrival airport coords
        const ap = AIRPORTS[arrCode];
        if (ap) {
          const coords: [number, number] = [ap.latitude, ap.longitude];
          arrivalAirportCoords.set(fi.dayNumber, coords);
          bounds.extend(coords); // Include in map view
          // Add airport marker
          const airportIcon = L.divIcon({
            className: 'plane-marker',
            html: `<div style="background:${getDayColor(fi.dayNumber).bg};width:26px;height:26px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:13px;">✈️</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          });
          const airportMarker = L.marker(coords, { icon: airportIcon, interactive: false });
          markerLayer.addLayer(airportMarker);
        }
      } else if (fi.orderIndex !== 0 && fi.latitude && fi.longitude) {
        // Departure flight — item coords are already the departure airport
        const coords: [number, number] = [fi.latitude, fi.longitude];
        departureAirportCoords.set(fi.dayNumber, coords);
        bounds.extend(coords);
        const airportIcon = L.divIcon({
          className: 'plane-marker',
          html: `<div style="background:${getDayColor(fi.dayNumber).bg};width:26px;height:26px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:13px;">✈️</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const airportMarker = L.marker(coords, { icon: airportIcon, interactive: false });
        markerLayer.addLayer(airportMarker);
      }
    }

    // fitBounds only on first render or when items actually change
    // (not when flightInfo/mapNumbers cause effect re-run with same items)
    if (bounds.isValid()) {
      storedBoundsRef.current = bounds;
      const itemsActuallyChanged = lastFitItemsKeyRef.current !== itemsKey;
      if (isInitialFitRef.current) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        isInitialFitRef.current = false;
        lastFitItemsKeyRef.current = itemsKey;
      } else if (itemsActuallyChanged) {
        // Items changed (e.g. day filter) — refit
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
        lastFitItemsKeyRef.current = itemsKey;
      }
      // else: effect re-ran but items didn't change — don't refit (user may be panning/zooming)
    }

    // Draw route polylines PER DAY with real routes when available
    const routeCandidates = displayItems
      .filter((item) => item.latitude && item.longitude && item.type !== 'flight')
      .sort(compareItemsForRoute);

    const byDay = new Map<number, TripItem[]>();
    routeCandidates.forEach((item) => {
      const day = item.dayNumber || 0;
      const list = byDay.get(day);
      if (list) list.push(item);
      else byDay.set(day, [item]);
    });

    const dayEntries = Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]);
    const usedLabelPositions: [number, number][] = []; // Anti-collision tracking for route labels

    // Pre-populate with activity marker positions so route-labels avoid overlapping markers
    routeCandidates.forEach((item) => {
      usedLabelPositions.push([item.latitude, item.longitude]);
    });

    dayEntries.forEach(([dayNum, dayItems]) => {
      // Extract hotel coordinates from checkin/checkout items
      const hotelItem = items.find(
        (item) =>
          (item.type === 'checkin' || item.type === 'checkout') &&
          item.dayNumber === dayNum &&
          item.accommodation?.latitude &&
          item.accommodation?.longitude
      );
      const hotelCoords = hotelItem?.accommodation
        ? [hotelItem.accommodation.latitude, hotelItem.accommodation.longitude] as [number, number]
        : null;

      // Build ordered node list: hotel → activities → hotel
      interface RouteNode {
        coords: [number, number];
        item?: TripItem; // undefined for hotel nodes
      }
      const nodes: RouteNode[] = [];

      if (hotelCoords) {
        nodes.push({ coords: hotelCoords });
      }

      // Build route nodes: skip transport items but propagate their travel data
      // to the next non-transport item (so route labels show transit info between activities)
      let pendingTransport: TripItem | null = null;
      for (const item of dayItems) {
        if (item.type === 'checkin' || item.type === 'checkout') continue;
        if (item.type === 'transport') {
          // Store transport data for the next activity/restaurant node
          pendingTransport = item;
          continue;
        }
        // Merge pending transport data onto this item (for route label display)
        const nodeItem = pendingTransport ? {
          ...item,
          timeFromPrevious: pendingTransport.timeFromPrevious ?? pendingTransport.duration ?? item.timeFromPrevious,
          distanceFromPrevious: pendingTransport.distanceFromPrevious ?? item.distanceFromPrevious,
          transportToPrevious: pendingTransport.transportToPrevious ?? item.transportToPrevious,
          transitInfo: pendingTransport.transitInfo ?? item.transitInfo,
          routePolylineFromPrevious: pendingTransport.routePolylineFromPrevious ?? item.routePolylineFromPrevious,
        } : item;
        pendingTransport = null;
        nodes.push({ coords: [nodeItem.latitude, nodeItem.longitude], item: nodeItem });
      }

      const hasReturnTransport = dayItems.some(item =>
        (item.type === 'transport' || item.type === 'flight') &&
        item.transportRole === 'longhaul' &&
        (item.title.includes('→') || item.id.includes('ret-'))
      );
      if (hotelCoords && !hasReturnTransport) {
        nodes.push({ coords: hotelCoords });
      }

      // Inject airport nodes for flights (pre-computed above)
      const arrCoords = arrivalAirportCoords.get(dayNum);
      if (arrCoords) {
        // Replace hotel start node with arrival airport, or prepend
        if (nodes.length > 0 && !nodes[0].item) nodes[0] = { coords: arrCoords };
        else nodes.unshift({ coords: arrCoords });
      }
      const depCoords = departureAirportCoords.get(dayNum);
      if (depCoords) {
        // Replace hotel end node with departure airport, or append
        if (nodes.length > 0 && !nodes[nodes.length - 1].item) {
          nodes[nodes.length - 1] = { coords: depCoords };
        } else {
          nodes.push({ coords: depCoords });
        }
      }

      if (nodes.length < 2) return;

      const color = filterDay === null ? getDayColor(dayNum).bg : getDayColor(filterDay).bg;

      // Draw per-segment: real polyline or straight line fallback
      for (let i = 0; i < nodes.length - 1; i++) {
        const fromNode = nodes[i];
        const toNode = nodes[i + 1];
        let nextItem = toNode.item;

        // Determine segment coords: decoded polyline or straight line
        let segmentCoords: [number, number][];
        if (nextItem?.routePolylineFromPrevious) {
          try {
            segmentCoords = decodePolyline(nextItem.routePolylineFromPrevious);
            // Ensure polyline connects to actual from/to nodes — the encoded polyline
            // may have been computed between different items (e.g. filtered-out transports)
            if (segmentCoords.length > 0) {
              const firstPt = segmentCoords[0];
              const lastPt = segmentCoords[segmentCoords.length - 1];
              const dStart = Math.abs(firstPt[0] - fromNode.coords[0]) + Math.abs(firstPt[1] - fromNode.coords[1]);
              const dEnd = Math.abs(lastPt[0] - toNode.coords[0]) + Math.abs(lastPt[1] - toNode.coords[1]);
              if (dStart > 0.002) segmentCoords.unshift(fromNode.coords);
              if (dEnd > 0.002) segmentCoords.push(toNode.coords);
            }
          } catch {
            segmentCoords = [fromNode.coords, toNode.coords];
          }
        } else {
          segmentCoords = [fromNode.coords, toNode.coords];
        }

        // When showing all days, reduce visual noise
        const isAllDays = filterDay === null;
        const haloOpacity = isAllDays ? 0.05 : 0.15;
        const lineOpacity = isAllDays ? 0.3 : 0.7;
        const lineWeight = isAllDays ? 2 : 3;

        // Halo
        const halo = L.polyline(segmentCoords, {
          color: isAllDays ? getDayColor(dayNum).bg : '#c5a059',
          weight: isAllDays ? 6 : 10,
          opacity: haloOpacity,
          smoothFactor: 2,
          lineJoin: 'round',
          lineCap: 'round',
        });
        routeLayer.addLayer(halo);

        // Main line
        const polyline = L.polyline(segmentCoords, {
          color: isAllDays ? getDayColor(dayNum).bg : '#c5a059',
          weight: lineWeight,
          opacity: lineOpacity,
          smoothFactor: 2,
          lineJoin: 'round',
          lineCap: 'round',
        });
        routeLayer.addLayer(polyline);

        // Arrow decorators
        if (polylineDecoratorRef.current) {
          const decorator = L.polylineDecorator(polyline, {
            patterns: [{
              offset: '25%',
              repeat: 100,
              symbol: L.Symbol.arrowHead({
                pixelSize: 8,
                polygon: false,
                pathOptions: {
                  stroke: true,
                  color: '#c5a059',
                  weight: 1.5,
                  opacity: 0.6,
                  fillOpacity: 0,
                },
              }),
            }],
          });
          routeLayer.addLayer(decorator);
        }

        // Estimate travel time from segment distance if no transport data
        if (nextItem && !nextItem.timeFromPrevious && segmentCoords.length >= 2) {
          const first = segmentCoords[0];
          const last = segmentCoords[segmentCoords.length - 1];
          const dLat = (last[0] - first[0]) * 111.32;
          const dLng = (last[1] - first[1]) * 111.32 * Math.cos(first[0] * Math.PI / 180);
          const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
          if (distKm > 0.05) { // >50m
            nextItem = { ...nextItem, distanceFromPrevious: distKm };
            if (distKm <= 1.5) {
              nextItem.timeFromPrevious = Math.ceil((distKm / 4.5) * 60);
              nextItem.transportToPrevious = 'walk';
            } else {
              nextItem.timeFromPrevious = Math.ceil(distKm * 3);
              nextItem.transportToPrevious = 'public';
            }
          }
        }

        // Travel time label at segment midpoint
        if (nextItem?.timeFromPrevious && nextItem.timeFromPrevious >= 2) {
          const midIdx = Math.floor(segmentCoords.length / 2);
          const midPoint = segmentCoords[midIdx];

          // Anti-collision: skip if another label is within ~100m (0.001°)
          const tooClose = usedLabelPositions.some(
            ([lat, lng]) => Math.abs(lat - midPoint[0]) < 0.001 && Math.abs(lng - midPoint[1]) < 0.001
          );
          if (tooClose) continue;

          // Parse day color hex to RGB for rgba() border
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);

          // Determine display mode
          const hasTransitLines = nextItem.transitInfo?.lines && nextItem.transitInfo.lines.length > 0;
          const isWalk = nextItem.transportToPrevious === 'walk' ||
            (!hasTransitLines && (nextItem.timeFromPrevious || 0) <= 20);

          // SVG icons inline (12x12)
          const walkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1.5"/><path d="M7 21l3-9 2.5 2v7M15.5 7.5L18 10l-4.5 1.5L11 8l4-1z"/></svg>';
          const carIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-6H7L5 12v5z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/></svg>';
          const taxiIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-6H7L5 12v5z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/><rect x="10" y="3" width="4" height="3"/></svg>';
          const transitIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M12 3v14M7.5 21l1.5-4M16.5 21l-1.5-4"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>';

          // Mode icons for transit badges (10x10, white stroke)
          const modeIcons: Record<string, string> = {
            metro: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18L12 4l9 14"/><path d="M7.5 12h9"/></svg>',
            tram: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="12" height="13" rx="2"/><path d="M9 21l-2-3M15 21l2-3M12 2v3M8 12h8"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>',
            ferry: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M4 17l2-9h12l2 9"/><path d="M12 3v5"/></svg>',
            train: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16M12 3v14M7.5 21l1.5-4M16.5 21l-1.5-4"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/></svg>',
            bus: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 10h16M8 21v-3M16 21v-3"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>',
          };

          // Pill container style
          const pillStyle = `background:rgba(255,255,255,0.92);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border:1px solid rgba(${r},${g},${b},0.15);color:${color};font-size:10px;font-weight:600;padding:3px 8px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,0.1);display:inline-flex;align-items:center;gap:3px;white-space:nowrap;`;

          // Format distance label
          const distKm = nextItem.distanceFromPrevious;
          const distLabel = distKm
            ? (distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`)
            : '';

          let labelContent = '';

          if (isWalk) {
            // Walking: pedestrian icon + time + distance
            labelContent = `<span style="${pillStyle}">${walkIcon} ${formatTravelTime(nextItem.timeFromPrevious)}${distLabel ? ` · ${distLabel}` : ''}</span>`;
          } else if (hasTransitLines) {
            // Transit: time + distance + colored line badges
            const badges = nextItem.transitInfo!.lines.slice(0, 3).map(line => {
              const bgColor = line.color || '#6B7280';
              const mIcon = modeIcons[line.mode] || modeIcons.bus;
              return `<span style="background:${bgColor};color:white;font-size:8px;font-weight:700;padding:1px 4px;border-radius:3px;display:inline-flex;align-items:center;gap:1px;line-height:1.2;">${mIcon}${line.number}</span>`;
            }).join('');
            labelContent = `<span style="${pillStyle}">${formatTravelTime(nextItem.timeFromPrevious)}${distLabel ? ` · ${distLabel}` : ''} ${badges}</span>`;
          } else {
            // Car/taxi/generic transport
            const icon = nextItem.transportToPrevious === 'taxi' ? taxiIcon
              : nextItem.transportToPrevious === 'car' ? carIcon
              : transitIcon;
            labelContent = `<span style="${pillStyle}">${icon} ${formatTravelTime(nextItem.timeFromPrevious)}${distLabel ? ` · ${distLabel}` : ''}</span>`;
          }

          const labelIcon = L.divIcon({
            className: 'route-label',
            html: `<div style="transform:translate(-50%,-50%);position:absolute;">${labelContent}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });
          const labelMarker = L.marker(midPoint, { icon: labelIcon, interactive: false });
          routeLayer.addLayer(labelMarker);
          usedLabelPositions.push([midPoint[0], midPoint[1]]);
        }
      }
    });

    // Day summary pills are rendered as a React legend overlay (see JSX below)

    // Flight arc
    if (flightInfo?.departureCoords) {
      const originIcon = L.divIcon({
        className: 'origin-marker',
        html: `<div style="
          background:linear-gradient(135deg,#10B981,#059669);
          width:30px;height:30px;border-radius:50%;border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.25);
          display:flex;align-items:center;justify-content:center;
          font-size:14px;
        ">🏠</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15],
      });

      const originMarker = L.marker(
        [flightInfo.departureCoords.lat, flightInfo.departureCoords.lng],
        { icon: originIcon }
      ).bindPopup(`<b>Ville de départ</b><br/>${escapeHtml(flightInfo.departureCity || 'Origine')}`);
      markerLayer.addLayer(originMarker);

      const firstDestItem = displayItems.find(i => i.type !== 'flight' && i.latitude && i.longitude);
      if (firstDestItem) {
        const startLat = flightInfo.departureCoords.lat;
        const startLng = flightInfo.departureCoords.lng;
        const endLat = firstDestItem.latitude;
        const endLng = firstDestItem.longitude;

        const curvePoints: [number, number][] = [];
        const numPoints = 80;
        for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints;
          const lat = startLat + t * (endLat - startLat);
          const lng = startLng + t * (endLng - startLng);
          const arc = Math.sin(t * Math.PI) * Math.abs(endLng - startLng) * 0.15;
          curvePoints.push([lat + arc, lng]);
        }

        const flightLine = L.polyline(curvePoints, {
          color: '#6366F1',
          weight: 2,
          opacity: 0.6,
          dashArray: '4, 4',
          lineJoin: 'round',
          lineCap: 'round',
        });
        routeLayer.addLayer(flightLine);

        // Airplane marker
        const planeIndex = Math.floor(numPoints * 0.6);
        const planePos = curvePoints[planeIndex];
        const nextPos = curvePoints[Math.min(planeIndex + 3, numPoints)];
        const p1 = map.latLngToContainerPoint(planePos);
        const p2 = map.latLngToContainerPoint(nextPos);
        const planeDx = p2.x - p1.x;
        const planeDy = p2.y - p1.y;
        const planeAngle = Math.atan2(planeDx, -planeDy) * 180 / Math.PI;

        const planeIcon = L.divIcon({
          className: 'plane-marker',
          html: `<div style="font-size:16px;transform:rotate(${planeAngle + 90}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">✈️</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const planeMarker = L.marker(planePos, { icon: planeIcon, interactive: false });
        routeLayer.addLayer(planeMarker);
      }
    }

    // ─── Add imported places markers (distinct style) ─────────
    if (importedPlaces && importedPlaces.length > 0) {
      importedPlaces.forEach((place) => {
        if (!place.lat || !place.lng) return;

        // Star icon marker (wish list style)
        const importedIcon = L.divIcon({
          className: 'imported-place-marker',
          html: `<div style="
            width:28px;height:28px;border-radius:50%;
            background:#FBBF24;border:2px solid white;
            color:white;font-size:14px;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 1px 4px rgba(0,0,0,0.25);
            transition:transform 0.15s ease;
          ">⭐</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -14],
        });

        const categoryLabel = escapeHtml(place.category || 'autre');
        const popupHtml = `
          <div style="min-width:160px;padding:4px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(place.name)}</div>
            ${place.address ? `<div style="font-size:11px;color:#666;margin-bottom:4px;">${escapeHtml(place.address)}</div>` : ''}
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">
              <span style="background:#FBBF24;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">Lieu importé</span>
              <span style="background:#E5E7EB;color:#374151;padding:2px 6px;border-radius:4px;font-size:10px;">${categoryLabel}</span>
            </div>
            ${place.notes ? `<div style="font-size:11px;color:#666;margin-top:6px;font-style:italic;">${escapeHtml(place.notes)}</div>` : ''}
            ${place.sourceUrl ? `<a href="${escapeHtml(place.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;color:#3B82F6;font-size:11px;text-decoration:underline;">Voir sur Maps</a>` : ''}
          </div>
        `;

        const marker = L.marker([place.lat, place.lng], { icon: importedIcon })
          .bindPopup(popupHtml, {
            maxWidth: typeof window !== 'undefined' ? Math.min(280, window.innerWidth - 60) : 280,
            className: 'clean-popup',
          });

        markerLayer.addLayer(marker);
        bounds.extend([place.lat, place.lng]);
      });

      // Re-fit bounds to include imported places
      if (bounds.isValid()) {
        storedBoundsRef.current = bounds;
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, isLoaded, flightInfo, mapNumbers, filterDay, importedPlaces]);

  // ─── Hover highlight (O(1) icon swap, no full rebuild) ──

  const prevHoveredRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const L = leafletRef.current;
    if (!L) return;

    // Restore previous hover
    const prevId = prevHoveredRef.current;
    if (prevId && prevId !== hoveredItemId) {
      const prevEntry = markerMapRef.current.get(prevId);
      if (prevEntry) {
        prevEntry.marker.setIcon(createNumberedIcon(L, prevEntry.num, prevEntry.type, prevEntry.dayNumber, false));
      }
    }

    // Highlight new
    if (hoveredItemId) {
      const entry = markerMapRef.current.get(hoveredItemId);
      if (entry) {
        entry.marker.setIcon(createNumberedIcon(L, entry.num, entry.type, entry.dayNumber, true));
      }
    }

    prevHoveredRef.current = hoveredItemId;
  }, [hoveredItemId]);

  // ─── Pan to selected item ────────────────────────────────

  useEffect(() => {
    if (!selectedItemId || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const item = itemsRef.current.find((i) => i.id === selectedItemId);
    if (item?.latitude && item?.longitude) {
      const currentZoom = map.getZoom();
      const targetZoom = Math.max(currentZoom, 15);
      map.setView([item.latitude, item.longitude], targetZoom, { animate: true });

      const entry = markerMapRef.current.get(selectedItemId);
      if (entry?.marker) {
        setTimeout(() => entry.marker.openPopup(), 300);
      }
    }
  }, [selectedItemId]);

  // ─── Fullscreen handling ─────────────────────────────────

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      (container.requestFullscreen?.() || (container as any).webkitRequestFullscreen?.());
    }
  }, []);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setTimeout(() => mapInstanceRef.current?.invalidateSize(), 100);
    };
    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  }, []);

  // ─── Neighbourhood overlay ─────────────────────────────

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map || !showNeighbourhoods || !neighbourhoodCells || neighbourhoodCells.length === 0) return;

    const cleanup = renderNeighbourhoodOverlay(L, map, neighbourhoodCells);
    return cleanup;
  }, [showNeighbourhoods, neighbourhoodCells]);

  // ─── Control handlers ────────────────────────────────────

  const handleFitAll = useCallback(() => {
    const map = mapInstanceRef.current;
    const bounds = storedBoundsRef.current;
    if (map && bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    mapInstanceRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    mapInstanceRef.current?.zoomOut();
  }, []);

  // ─── Render ──────────────────────────────────────────────

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden bg-muted">
      {/* Loading state */}
      {!isLoaded && (
        <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center bg-muted/80 backdrop-blur-sm gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-sm text-muted-foreground">Chargement de la carte...</span>
        </div>
      )}

      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* ── Controls overlay ── */}
      {isLoaded && (
        <>
          {/* Top-left: Day filter chips */}
          {dayNumbers.length > 1 && (
            <div className="absolute top-4 left-4 z-[1000] flex gap-2 overflow-x-auto max-w-[70%] pb-2 scrollbar-hide">
              <button
                onClick={() => setFilterDay(null)}
                className={cn(
                  "flex-shrink-0 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg border backdrop-blur-md",
                  filterDay === null
                    ? "bg-gold-gradient text-white border-white/20"
                    : "bg-white/80 dark:bg-[#020617]/80 text-muted-foreground border-white/10 hover:border-gold/30"
                )}
              >
                Tout
              </button>
              {dayNumbers.map(d => {
                const isActive = filterDay === d;
                return (
                  <button
                    key={d}
                    onClick={() => setFilterDay(isActive ? null : d)}
                    className={cn(
                      "flex-shrink-0 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all shadow-lg border backdrop-blur-md",
                      isActive
                        ? "bg-gold text-white border-white/20"
                        : "bg-white/80 dark:bg-[#020617]/80 text-muted-foreground border-white/10 hover:border-gold/30"
                    )}
                  >
                    Jour {d}
                  </button>
                );
              })}
            </div>
          )}

          {/* Day summary legend — top-left, below filter chips */}
          {daySummaries.length > 1 && (
            <div className="absolute top-14 left-4 z-[1000] flex flex-col gap-1.5 bg-white/40 dark:bg-[#020617]/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 px-4 py-3 min-w-[120px]">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold mb-1">Itinéraires</span>
              {daySummaries.map(({ dayNum, totalKm, color }) => (
                <div key={dayNum} className="flex items-center justify-between gap-4 text-[11px] font-bold">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0 bg-gold shadow-[0_0_8px_rgba(197,160,89,0.5)]" />
                    <span className="text-foreground/90">J{dayNum}</span>
                  </div>
                  {totalKm > 0 && <span className="text-muted-foreground font-mono text-[10px]">{totalKm.toFixed(1)}km</span>}
                </div>
              ))}
            </div>
          )}

          {/* Top-right: Fit all + Fullscreen */}
          <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
            <button
              onClick={handleFitAll}
              className="w-10 h-10 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md rounded-xl shadow-xl border border-white/10 flex items-center justify-center text-gold hover:scale-110 transition-all active:scale-95 group"
            >
              <Maximize2 className="h-5 w-5 group-hover:rotate-12 transition-transform" />
            </button>
            <button
              onClick={handleFullscreen}
              className="w-10 h-10 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md rounded-xl shadow-xl border border-white/10 flex items-center justify-center text-gold hover:scale-110 transition-all active:scale-95"
            >
              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
            </button>
          </div>

          {/* Bottom-right: Custom zoom controls */}
          <div className="absolute bottom-8 right-4 z-[1000] flex flex-col gap-1 shadow-2xl rounded-xl overflow-hidden border border-white/10">
            <button
              onClick={handleZoomIn}
              className="w-10 h-10 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md flex items-center justify-center text-gold hover:bg-gold/10 transition-colors"
            >
              <PlusCircle className="h-5 w-5" />
            </button>
            <button
              onClick={handleZoomOut}
              className="w-10 h-10 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md flex items-center justify-center text-gold hover:bg-gold/10 transition-colors border-t border-white/5"
            >
              <MinusCircle className="h-5 w-5" />
            </button>
          </div>


          {/* Bottom-left: Legend toggle + Neighbourhood toggle */}
          <div className="absolute bottom-6 left-3 z-[1000] flex gap-1.5">
            {neighbourhoodCells && neighbourhoodCells.length > 0 && (
              <button
                onClick={() => setShowNeighbourhoods(!showNeighbourhoods)}
                title={showNeighbourhoods ? 'Masquer les quartiers' : 'Quartiers & prix'}
                aria-label={showNeighbourhoods ? 'Masquer la carte des quartiers' : 'Afficher la carte des quartiers'}
                className={`w-8 h-8 rounded-md shadow-md border border-border/50 flex items-center justify-center transition-colors ${
                  showNeighbourhoods ? 'bg-amber-500 text-white' : 'bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowLegend(!showLegend)}
              title="Légende"
              aria-label={showLegend ? 'Masquer la légende' : 'Afficher la légende'}
              className={`w-8 h-8 rounded-md shadow-md border border-border/50 flex items-center justify-center transition-colors ${
                showLegend ? 'bg-primary text-primary-foreground' : 'bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
              </svg>
            </button>
            {showLegend && (
              <div className="absolute bottom-10 left-0 bg-white dark:bg-card rounded-lg shadow-lg border border-border/50 p-2.5 text-xs min-w-[130px]">
                {/* Formes */}
                <div className="space-y-1.5 mb-2">
                  <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Formes</div>
                  {([
                    ['activity', 'Activité', 'border-radius:50%;'],
                    ['restaurant', 'Restaurant', 'border-radius:3px;'],
                    ['transport', 'Transport', 'border-radius:2px;transform:rotate(45deg);'],
                    ['hotel', 'Hôtel', 'border-radius:3px 3px 50% 50%;'],
                    ['parking', 'Parking / Autre', 'border-radius:50%;border-style:dashed;'],
                  ] as const).map(([key, label, css]) => (
                    <div key={key} className="flex items-center gap-2">
                      <div className="w-3 h-3 flex-shrink-0" style={{ background: '#9CA3AF', border: '1.5px solid #6B7280', ...Object.fromEntries(css.split(';').filter(Boolean).map(s => { const [k, v] = s.split(':'); return [k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.trim()]; })) }} />
                      <span className="text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
                {/* Jours */}
                {dayNumbers.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border/50">
                    <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">Jours</div>
                    {dayNumbers.map(d => (
                      <div key={d} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: getDayColor(d).bg }} />
                        <span className="text-muted-foreground">Jour {d}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
