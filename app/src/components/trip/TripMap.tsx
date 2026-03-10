'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { TripItem, TRIP_ITEM_COLORS, ImportedPlace } from '@/lib/types';

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
  const size = isHighlighted ? 32 : 26;
  const fontSize = isHighlighted ? 13 : 11;
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
`;

// ─── Component ──────────────────────────────────────────────

export function TripMap({ items, selectedItemId, onItemClick, hoveredItemId, mapNumbers, isVisible = true, importedPlaces, flightInfo }: TripMapProps) {
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

  // Compute stable items key to detect real changes
  const itemsKey = useMemo(() => items.map(i => i.id).sort().join(','), [items]);

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

        // Load marker cluster plugin
        await import('leaflet.markercluster');

        // Inject Leaflet CSS
        if (!document.getElementById('leaflet-css')) {
          const link = document.createElement('link');
          link.id = 'leaflet-css';
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);
        }

        // Inject MarkerCluster CSS (custom themed)
        if (!document.getElementById('markercluster-css')) {
          const style = document.createElement('style');
          style.id = 'markercluster-css';
          style.textContent = `
            .marker-cluster-custom {
              background: rgba(30, 58, 95, 0.15);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .marker-cluster-custom div {
              background: linear-gradient(135deg, #102a45, #1e3a5f);
              color: #d4a853;
              border-radius: 50%;
              font-weight: 700;
              font-size: 13px;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 2px 8px rgba(16, 42, 69, 0.4);
              border: 2px solid rgba(212, 168, 83, 0.6);
            }
            .dark .marker-cluster-custom div {
              background: linear-gradient(135deg, #d4a853, #b8923d);
              color: #102a45;
              border-color: rgba(16, 42, 69, 0.6);
            }
          `;
          document.head.appendChild(style);
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

    // Create persistent layer groups (markers use clustering)
    markerLayerRef.current = (L as any).markerClusterGroup({
      maxClusterRadius: 45,
      disableClusteringAtZoom: 15,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 36 : count < 30 ? 42 : 48;
        return L.divIcon({
          html: `<div style="width:${size - 8}px;height:${size - 8}px;">${count}</div>`,
          className: 'marker-cluster-custom',
          iconSize: L.point(size, size),
        });
      },
    }).addTo(map);
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

    // Add markers
    displayItems.forEach((item) => {
      if (!item.latitude || !item.longitude) return;
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

    // NOTE: Departure coords intentionally NOT added to bounds.
    // The departure marker is still displayed, but we don't want the map to zoom out
    // to fit the departure city (e.g. Lyon) when viewing activities in the destination (e.g. Milan).

    // fitBounds only on first render or when items actually change
    if (bounds.isValid()) {
      storedBoundsRef.current = bounds;
      if (isInitialFitRef.current) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        isInitialFitRef.current = false;
      } else {
        // Items changed (e.g. day filter) — refit
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
      }
    }

    // Draw route polylines PER DAY (prevents cross-day zigzags)
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
    dayEntries.forEach(([dayNum, dayItems], idx) => {
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

      // Build route: hotel → activities → hotel (or departure transport on last day)
      const routeCoords: [number, number][] = [];

      // Start from hotel (if available)
      if (hotelCoords) {
        routeCoords.push(hotelCoords);
      }

      // Add all day items (excluding checkin/checkout which are at hotel)
      for (const item of dayItems) {
        if (item.type !== 'checkin' && item.type !== 'checkout') {
          routeCoords.push([item.latitude, item.longitude]);
        }
      }

      // End at hotel (unless last day with departure transport)
      const hasReturnTransport = dayItems.some(item =>
        (item.type === 'transport' || item.type === 'flight') &&
        item.transportRole === 'longhaul' &&
        (item.title.includes('→') || item.id.includes('ret-'))
      );
      if (hotelCoords && !hasReturnTransport) {
        routeCoords.push(hotelCoords);
      }

      if (routeCoords.length < 2) return;

      const color = filterDay === null ? getDayColor(dayNum).bg : getDayColor(filterDay).bg;

      // Halo (ombre)
      const halo = L.polyline(routeCoords, {
        color,
        weight: 7,
        opacity: 0.15,
        smoothFactor: 1.5,
        lineJoin: 'round',
        lineCap: 'round',
      });
      routeLayer.addLayer(halo);

      // Route principale
      const polyline = L.polyline(routeCoords, {
        color,
        weight: 3,
        opacity: 0.7,
        smoothFactor: 1.5,
        lineJoin: 'round',
        lineCap: 'round',
      });
      routeLayer.addLayer(polyline);

      // Decorator avec flèches directionnelles
      if (polylineDecoratorRef.current) {
        const decorator = L.polylineDecorator(polyline, {
          patterns: [{
            offset: '25%',
            repeat: 80,
            symbol: L.Symbol.arrowHead({
              pixelSize: 9,
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
    });

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

          {/* Bottom-left: Legend toggle */}
          <div className="absolute bottom-6 left-3 z-[1000]">
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
