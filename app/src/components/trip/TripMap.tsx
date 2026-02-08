'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';

interface TripMapProps {
  items: TripItem[];
  selectedItemId?: string;
  onItemClick?: (item: TripItem) => void;
  hoveredItemId?: string;
  mapNumbers?: Map<string, number>;
  isVisible?: boolean;
  flightInfo?: {
    departureCity?: string;
    departureCoords?: { lat: number; lng: number };
    arrivalCity?: string;
    arrivalCoords?: { lat: number; lng: number };
    stopoverCities?: string[];
  };
}

// ─── Constants ──────────────────────────────────────────────

const MARKER_COLORS: Record<string, { bg: string; border: string }> = {
  activity: { bg: '#3B82F6', border: '#2563EB' },
  restaurant: { bg: '#F97316', border: '#EA580C' },
  hotel: { bg: '#8B5CF6', border: '#7C3AED' },
  transport: { bg: '#10B981', border: '#059669' },
  flight: { bg: '#EC4899', border: '#DB2777' },
  parking: { bg: '#6B7280', border: '#4B5563' },
  checkin: { bg: '#8B5CF6', border: '#7C3AED' },
  checkout: { bg: '#8B5CF6', border: '#7C3AED' },
  luggage: { bg: '#F59E0B', border: '#D97706' },
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

function createNumberedIcon(L: any, num: number, type: string, isHighlighted: boolean) {
  const colors = MARKER_COLORS[type] || { bg: '#666', border: '#444' };
  const size = isHighlighted ? 32 : 26;
  const fontSize = isHighlighted ? 13 : 11;
  const shadow = isHighlighted
    ? `box-shadow: 0 0 0 3px ${colors.bg}40, 0 2px 8px rgba(0,0,0,0.3);`
    : 'box-shadow: 0 1px 4px rgba(0,0,0,0.25);';

  return L.divIcon({
    className: 'numbered-marker',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${colors.bg};border:2px solid white;
      color:white;font-size:${fontSize}px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      ${shadow}
      transition:transform 0.15s ease;
      ${isHighlighted ? 'transform:scale(1.2);z-index:1000;' : ''}
    ">${num}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function getPopupContent(item: TripItem, index: number): string {
  const color = MARKER_COLORS[item.type]?.bg || '#666';
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
        <div style="font-size:14px;font-weight:600;line-height:1.2;">${item.title}</div>
      </div>
      <div style="font-size:12px;color:var(--color-muted-foreground);margin-bottom:4px;">${item.startTime} - ${item.endTime}</div>
      ${item.description ? `<div style="font-size:12px;color:var(--color-muted-foreground);margin-bottom:6px;line-height:1.3;">${item.description.slice(0, 120)}${item.description.length > 120 ? '...' : ''}</div>` : ''}
      ${details ? `<div style="margin-bottom:6px;">${details}</div>` : ''}
      <div style="display:flex;gap:8px;padding-top:6px;border-top:1px solid var(--color-border);">
        <a href="${googleMapsUrl}" target="_blank" style="color:var(--color-primary);font-size:12px;text-decoration:none;font-weight:500;">Google Maps</a>
        ${item.bookingUrl ? `<a href="${item.bookingUrl}" target="_blank" style="color:#34a853;font-size:12px;text-decoration:none;font-weight:500;">Réserver</a>` : ''}
      </div>
    </div>
  `;
}

function addDirectionArrows(
  L: any,
  map: any,
  routeCoords: [number, number][],
  color: string,
  layerGroup: any
): void {
  if (routeCoords.length < 2) return;

  // Compute total route distance for even arrow spacing
  let totalDist = 0;
  const segDists: number[] = [];
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const d = map.distance(routeCoords[i], routeCoords[i + 1]);
    segDists.push(d);
    totalDist += d;
  }

  if (totalDist < 100) return; // too short for arrows

  // Place arrows every ~20% of total distance (max 5 arrows)
  const arrowInterval = totalDist / 6;
  let accumulated = 0;
  let nextArrowAt = arrowInterval;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const segLen = segDists[i];
    accumulated += segLen;

    if (accumulated >= nextArrowAt) {
      const start = routeCoords[i];
      const end = routeCoords[i + 1];

      // Use screen-space angle for Mercator-correct direction
      const p1 = map.latLngToContainerPoint(start);
      const p2 = map.latLngToContainerPoint(end);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const angleDeg = Math.atan2(dx, -dy) * 180 / Math.PI;

      const midLat = (start[0] + end[0]) / 2;
      const midLng = (start[1] + end[1]) / 2;

      const arrowIcon = L.divIcon({
        className: 'direction-arrow',
        html: `<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${angleDeg}deg);filter:drop-shadow(0 0 2px white) drop-shadow(0 0 2px white);" fill="none">
          <path d="M3 10L7 4L11 10" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const arrowMarker = L.marker([midLat, midLng], {
        icon: arrowIcon,
        interactive: false,
        zIndexOffset: -50,
      });
      layerGroup.addLayer(arrowMarker);

      nextArrowAt += arrowInterval;
    }
  }
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
`;

// ─── Component ──────────────────────────────────────────────

export function TripMap({ items, selectedItemId, onItemClick, hoveredItemId, mapNumbers, isVisible = true, flightInfo }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);

  // Layer groups for explicit cleanup
  const markerLayerRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);

  // Marker references for hover/selection
  const markerMapRef = useRef<Map<string, { marker: any; num: number; type: string }>>(new Map());

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

    // Add markers
    displayItems.forEach((item) => {
      if (!item.latitude || !item.longitude) return;
      const num = mapNumbers?.get(item.id) ?? globalIndex++;
      const icon = createNumberedIcon(L, num, item.type, false);

      const marker = L.marker([item.latitude, item.longitude], { icon })
        .bindPopup(getPopupContent(item, num), {
          maxWidth: typeof window !== 'undefined' ? Math.min(280, window.innerWidth - 60) : 280,
          className: 'clean-popup',
        });

      marker.on('click', () => onItemClickRef.current?.(item));

      markerLayer.addLayer(marker);
      markerMapRef.current.set(item.id, { marker, num, type: item.type });
      bounds.extend([item.latitude, item.longitude]);
    });

    // Add flight departure coords to bounds
    if (flightInfo?.departureCoords) {
      bounds.extend([flightInfo.departureCoords.lat, flightInfo.departureCoords.lng]);
    }

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

    // Draw route polyline between non-flight items in chronological order
    const routeCoords = displayItems
      .filter((item) => item.latitude && item.longitude && item.type !== 'flight')
      .sort((a, b) => {
        const dayDiff = (a.dayNumber || 0) - (b.dayNumber || 0);
        if (dayDiff !== 0) return dayDiff;
        return (a.startTime || '00:00').localeCompare(b.startTime || '00:00');
      })
      .map((item) => [item.latitude, item.longitude] as [number, number]);

    if (routeCoords.length > 1) {
      const polyline = L.polyline(routeCoords, {
        color: '#3B82F6',
        weight: 3,
        opacity: 0.5,
        smoothFactor: 1.5,
        lineJoin: 'round',
      });
      routeLayer.addLayer(polyline);

      addDirectionArrows(L, map, routeCoords, '#3B82F6', routeLayer);
    }

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
      ).bindPopup(`<b>Ville de départ</b><br/>${flightInfo.departureCity || 'Origine'}`);
      markerLayer.addLayer(originMarker);

      const firstDestItem = displayItems.find(i => i.type !== 'flight' && i.latitude && i.longitude);
      if (firstDestItem) {
        const startLat = flightInfo.departureCoords.lat;
        const startLng = flightInfo.departureCoords.lng;
        const endLat = firstDestItem.latitude;
        const endLng = firstDestItem.longitude;

        const curvePoints: [number, number][] = [];
        const numPoints = 50;
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
          dashArray: '8, 6',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, isLoaded, flightInfo, mapNumbers, filterDay]);

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
        prevEntry.marker.setIcon(createNumberedIcon(L, prevEntry.num, prevEntry.type, false));
      }
    }

    // Highlight new
    if (hoveredItemId) {
      const entry = markerMapRef.current.get(hoveredItemId);
      if (entry) {
        entry.marker.setIcon(createNumberedIcon(L, entry.num, entry.type, true));
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
              {dayNumbers.map(d => (
                <button
                  key={d}
                  onClick={() => setFilterDay(filterDay === d ? null : d)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors shadow-sm border ${
                    filterDay === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-white/90 dark:bg-card/90 text-muted-foreground border-border/50 hover:bg-white dark:hover:bg-card'
                  }`}
                >
                  J{d}
                </button>
              ))}
            </div>
          )}

          {/* Top-right: Fit all + Fullscreen */}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
            <button
              onClick={handleFitAll}
              title="Voir tout"
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
              className="w-8 h-8 bg-white dark:bg-card rounded-t-md shadow-md border border-border/50 border-b-0 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={handleZoomOut}
              title="Zoom arrière"
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
              className={`w-8 h-8 rounded-md shadow-md border border-border/50 flex items-center justify-center transition-colors ${
                showLegend ? 'bg-primary text-primary-foreground' : 'bg-white dark:bg-card text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
              </svg>
            </button>
            {showLegend && (
              <div className="absolute bottom-10 left-0 bg-white dark:bg-card rounded-lg shadow-lg border border-border/50 p-2.5 text-xs space-y-1.5 min-w-[120px]">
                {Object.entries(MARKER_COLORS)
                  .filter(([type]) => !['checkin', 'checkout'].includes(type))
                  .map(([type, colors]) => (
                    <div key={type} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors.bg }} />
                      <span className="text-muted-foreground">{TYPE_LABELS[type] || type}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
