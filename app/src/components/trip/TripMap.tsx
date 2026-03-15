'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { TripItem, TRIP_ITEM_COLORS, ImportedPlace } from '@/lib/types';
import { AIRPORTS } from '@/lib/services/geocoding';
import type { PriceCell } from '@/lib/services/neighbourhoodPricing';
import { renderNeighbourhoodOverlay } from './NeighbourhoodMap';

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

const DAY_COLORS: { bg: string; border: string }[] = [
  { bg: '#6366F1', border: '#4F46E5' }, // Indigo   — Jour 1
  { bg: '#06B6D4', border: '#0891B2' }, // Cyan     — Jour 2
  { bg: '#F59E0B', border: '#D97706' }, // Ambre    — Jour 3
  { bg: '#EF4444', border: '#DC2626' }, // Rouge    — Jour 4
  { bg: '#8B5CF6', border: '#7C3AED' }, // Violet   — Jour 5
  { bg: '#10B981', border: '#059669' }, // Émeraude — Jour 6
  { bg: '#F97316', border: '#EA580C' }, // Orange   — Jour 7
  { bg: '#EC4899', border: '#DB2777' }, // Rose     — Jour 8
  { bg: '#14B8A6', border: '#0D9488' }, // Teal     — Jour 9
  { bg: '#A855F7', border: '#9333EA' }, // Pourpre  — Jour 10
];
const DEFAULT_DAY_COLOR = { bg: '#6B7280', border: '#4B5563' };

function getDayColor(dayNumber: number) {
  if (dayNumber < 1) return DEFAULT_DAY_COLOR;
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}

const TYPE_SHAPES: Record<string, { containerCss: string; innerCss: string }> = {
  activity:   { containerCss: 'border-radius:50%;', innerCss: '' },
  restaurant: { containerCss: 'border-radius:4px;', innerCss: '' },
  transport:  { containerCss: 'border-radius:3px;transform:rotate(45deg);', innerCss: 'transform:rotate(-45deg);' },
  flight:     { containerCss: 'border-radius:3px;transform:rotate(45deg);', innerCss: 'transform:rotate(-45deg);' },
  hotel:      { containerCss: 'border-radius:4px 4px 50% 50%;', innerCss: '' },
  checkin:    { containerCss: 'border-radius:4px 4px 50% 50%;', innerCss: '' },
  checkout:   { containerCss: 'border-radius:4px 4px 50% 50%;', innerCss: '' },
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
  const size = isHighlighted ? 36 : 30;
  const fontSize = isHighlighted ? 14 : 12;
  const shadow = isHighlighted
    ? `box-shadow: 0 0 0 3px ${colors.bg}40, 0 2px 8px rgba(0,0,0,0.3);`
    : 'box-shadow: 0 1px 4px rgba(0,0,0,0.25);';

  // For losange types, compose rotate(45deg) with scale when highlighted
  const isLosange = type === 'transport' || type === 'flight';
  let containerTransform = '';
  if (isLosange) {
    containerTransform = isHighlighted
      ? 'transform:rotate(45deg) scale(1.2);z-index:1000;'
      : 'transform:rotate(45deg);';
  } else {
    containerTransform = isHighlighted ? 'transform:scale(1.2);z-index:1000;' : '';
  }

  // Strip transform from containerCss since we handle it via containerTransform
  const shapeCss = isLosange
    ? shape.containerCss.replace('transform:rotate(45deg);', '')
    : shape.containerCss;

  return L.divIcon({
    className: 'numbered-marker',
    html: `<div style="
      width:${size}px;height:${size}px;
      ${shapeCss}
      background:${colors.bg};border:2px solid white;
      color:white;font-size:${fontSize}px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      ${shadow}
      transition:transform 0.15s ease;
      ${containerTransform}
    "><span style="display:flex;align-items:center;justify-content:center;${shape.innerCss}">${num}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function getPopupContent(item: TripItem, index: number): string {
  const color = getDayColor(item.dayNumber).bg;
  const googleMapsUrl = item.googleMapsPlaceUrl ||
    item.googleMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;

  const imageHtml = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px 8px 0 0;margin-bottom:8px;" onerror="this.style.display='none'" />`
    : '';

  let details = '';
  if (item.estimatedCost) details += `<span style="color:var(--color-muted-foreground);font-size:11px;">~${item.estimatedCost}€</span>`;
  if (item.rating) details += `${details ? ' · ' : ''}<span style="color:var(--color-muted-foreground);font-size:11px;">${item.rating.toFixed(1)}★</span>`;
  if (item.timeFromPrevious) details += `${details ? ' · ' : ''}<span style="color:var(--color-muted-foreground);font-size:11px;">${item.timeFromPrevious}min</span>`;

  const maxW = typeof window !== 'undefined' ? Math.min(280, window.innerWidth - 60) : 280;

  return `
    <div style="min-width:200px;max-width:${maxW}px;font-family:system-ui,-apple-system,sans-serif;color:var(--color-card-foreground);">
      ${imageHtml}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div style="width:24px;height:24px;border-radius:50%;background:${color};color:white;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${index}</div>
        <div style="font-size:14px;font-weight:600;line-height:1.2;">${escapeHtml(item.title)}</div>
      </div>
      <div style="font-size:12px;color:var(--color-muted-foreground);margin-bottom:4px;">${escapeHtml(item.startTime)} - ${escapeHtml(item.endTime)}</div>
      ${item.description ? `<div style="font-size:12px;color:var(--color-muted-foreground);margin-bottom:6px;line-height:1.3;">${escapeHtml(item.description.slice(0, 120))}${item.description.length > 120 ? '...' : ''}</div>` : ''}
      ${details ? `<div style="margin-bottom:6px;">${details}</div>` : ''}
      <div style="display:flex;gap:8px;padding-top:6px;border-top:1px solid var(--color-border);">
        <a href="${escapeHtml(googleMapsUrl)}" target="_blank" style="color:var(--color-primary);font-size:12px;text-decoration:none;font-weight:500;">Google Maps</a>
        ${item.bookingUrl ? `<a href="${escapeHtml(item.bookingUrl)}" target="_blank" style="color:#34a853;font-size:12px;text-decoration:none;font-weight:500;">Réserver</a>` : ''}
      </div>
    </div>
  `;
}


// ─── Inline styles for Leaflet overrides ────────────────────

const LEAFLET_STYLE_OVERRIDES = `
.clean-popup .leaflet-popup-content-wrapper {
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  padding: 0;
  overflow: hidden;
  background: var(--color-card);
  color: var(--color-card-foreground);
}
.clean-popup .leaflet-popup-content {
  margin: 12px;
  margin-top: 0;
}
.clean-popup .leaflet-popup-content img {
  margin-left: -12px;
  margin-right: -12px;
  width: calc(100% + 24px) !important;
  max-width: none !important;
}
.clean-popup .leaflet-popup-tip {
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  background: var(--color-card);
}
.dark .clean-popup .leaflet-popup-content-wrapper {
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
.direction-arrow, .numbered-marker, .origin-marker, .plane-marker {
  background: none !important;
  border: none !important;
}
.numbered-marker {
  z-index: 500 !important;
}
.leaflet-control-attribution {
  font-size: 10px !important;
  opacity: 0.6 !important;
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

    // Add markers (flights are represented by the arc + plane icon below)
    displayItems.forEach((item) => {
      if (!item.latitude || !item.longitude || item.type === 'flight') return;
      const num = mapNumbers?.get(item.id) ?? globalIndex++;
      const icon = createNumberedIcon(L, num, item.type, item.dayNumber, false);

      const marker = L.marker([item.latitude, item.longitude], { icon })
        .bindPopup(getPopupContent(item, num), {
          maxWidth: typeof window !== 'undefined' ? Math.min(280, window.innerWidth - 60) : 280,
          className: 'clean-popup',
        });

      marker.on('click', () => onItemClickRef.current?.(item));

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
      const hotelItem = displayItems.find(
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

      for (const item of dayItems) {
        if (item.type !== 'checkin' && item.type !== 'checkout') {
          nodes.push({ coords: [item.latitude, item.longitude], item });
        }
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
        const nextItem = toNode.item;

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

        // Halo
        const halo = L.polyline(segmentCoords, {
          color,
          weight: 12,
          opacity: 0.22,
          smoothFactor: 1.5,
          lineJoin: 'round',
          lineCap: 'round',
        });
        routeLayer.addLayer(halo);

        // Main line
        const polyline = L.polyline(segmentCoords, {
          color,
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1.5,
          lineJoin: 'round',
          lineCap: 'round',
        });
        routeLayer.addLayer(polyline);

        // Arrow decorators
        if (polylineDecoratorRef.current) {
          const decorator = L.polylineDecorator(polyline, {
            patterns: [{
              offset: '25%',
              repeat: 80,
              symbol: L.Symbol.arrowHead({
                pixelSize: 10,
                polygon: false,
                pathOptions: {
                  stroke: true,
                  color,
                  weight: 2,
                  opacity: 0.8,
                  fillOpacity: 0,
                },
              }),
            }],
          });
          routeLayer.addLayer(decorator);
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
            <div className="absolute top-3 left-3 z-[1000] flex gap-1 overflow-x-auto max-w-[65%] pb-1" style={{ scrollbarWidth: 'none' }}>
              <button
                onClick={() => setFilterDay(null)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors shadow-sm border ${
                  filterDay === null
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white/90 dark:bg-card/90 text-muted-foreground border-border/50 hover:bg-white dark:hover:bg-card'
                }`}
              >
                Tout
              </button>
              {dayNumbers.map(d => {
                const dc = getDayColor(d);
                return (
                  <button
                    key={d}
                    onClick={() => setFilterDay(filterDay === d ? null : d)}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors shadow-sm border ${
                      filterDay !== d ? 'bg-white/90 dark:bg-card/90 text-muted-foreground hover:bg-white dark:hover:bg-card' : ''
                    }`}
                    style={filterDay === d
                      ? { background: dc.bg, color: 'white', borderColor: dc.border }
                      : undefined
                    }
                  >
                    J{d}
                  </button>
                );
              })}
            </div>
          )}

          {/* Day summary legend — top-left, below filter chips */}
          {daySummaries.length > 1 && (
            <div className="absolute top-12 left-3 z-[1000] flex flex-col gap-0.5 bg-white/90 dark:bg-card/90 backdrop-blur-sm rounded-lg shadow-md border border-border/50 px-2.5 py-1.5">
              {daySummaries.map(({ dayNum, totalKm, color }) => (
                <div key={dayNum} className="flex items-center gap-2 text-xs font-semibold" style={{ color }}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span>J{dayNum}{totalKm > 0 ? ` · ${totalKm.toFixed(1)} km` : ''}</span>
                </div>
              ))}
            </div>
          )}

          {/* Top-right: Fit all + Fullscreen */}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
            <button
              onClick={handleFitAll}
              title="Voir tout"
              aria-label="Voir tous les points sur la carte"
              className="w-8 h-8 bg-white dark:bg-card rounded-md shadow-md border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <button
              onClick={handleFullscreen}
              title={isFullscreen ? 'Quitter plein écran' : 'Plein écran'}
              aria-label={isFullscreen ? 'Quitter le mode plein écran' : 'Afficher en plein écran'}
              className="w-8 h-8 bg-white dark:bg-card rounded-md shadow-md border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
            </button>
          </div>

          {/* Bottom-right: Custom zoom controls */}
          <div className="absolute bottom-6 right-3 z-[1000] flex flex-col">
            <button
              onClick={handleZoomIn}
              title="Zoom avant"
              aria-label="Zoomer sur la carte"
              className="w-8 h-8 bg-white dark:bg-card rounded-t-md shadow-md border border-border/50 border-b-0 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom arrière"
              aria-label="Dézoomer sur la carte"
              className="w-8 h-8 bg-white dark:bg-card rounded-b-md shadow-md border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
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
