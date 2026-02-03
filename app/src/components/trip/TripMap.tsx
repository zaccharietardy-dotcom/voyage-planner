'use client';

import { useEffect, useRef, useState } from 'react';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';

interface TripMapProps {
  items: TripItem[];
  center?: { lat: number; lng: number };
  selectedItemId?: string;
  onItemClick?: (item: TripItem) => void;
  hoveredItemId?: string;
  flightInfo?: {
    departureCity?: string;
    departureCoords?: { lat: number; lng: number };
    arrivalCity?: string;
    arrivalCoords?: { lat: number; lng: number };
    stopoverCities?: string[];
  };
}

// Type-based colors for numbered markers
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

function getPopupContent(item: TripItem, index: number): string {
  const color = MARKER_COLORS[item.type]?.bg || '#666';
  const googleMapsUrl = item.googleMapsPlaceUrl ||
    item.googleMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;

  const imageHtml = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />`
    : '';

  let details = '';
  if (item.estimatedCost) details += `<span style="color:#666;font-size:11px;">~${item.estimatedCost}€</span>`;
  if (item.rating) details += `${details ? ' · ' : ''}<span style="color:#666;font-size:11px;">${item.rating.toFixed(1)}★</span>`;
  if (item.timeFromPrevious) details += `${details ? ' · ' : ''}<span style="color:#666;font-size:11px;">${item.timeFromPrevious}min</span>`;

  return `
    <div style="min-width:220px;max-width:280px;font-family:system-ui,-apple-system,sans-serif;">
      ${imageHtml}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div style="width:24px;height:24px;border-radius:50%;background:${color};color:white;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${index}</div>
        <div style="font-size:14px;font-weight:600;line-height:1.2;">${item.title}</div>
      </div>
      <div style="font-size:12px;color:#888;margin-bottom:4px;">${item.startTime} - ${item.endTime}</div>
      ${item.description ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.3;">${item.description.slice(0, 120)}${item.description.length > 120 ? '...' : ''}</div>` : ''}
      ${details ? `<div style="margin-bottom:6px;">${details}</div>` : ''}
      <div style="display:flex;gap:8px;padding-top:6px;border-top:1px solid #eee;">
        <a href="${googleMapsUrl}" target="_blank" style="color:#1a73e8;font-size:12px;text-decoration:none;font-weight:500;">Google Maps</a>
        ${item.bookingUrl ? `<a href="${item.bookingUrl}" target="_blank" style="color:#34a853;font-size:12px;text-decoration:none;font-weight:500;">Réserver</a>` : ''}
      </div>
    </div>
  `;
}

export function TripMap({ items, center, selectedItemId, onItemClick, hoveredItemId, flightInfo }: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const leafletRef = useRef<any>(null);
  // Store marker references by item id for hover highlighting
  const markerMapRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadLeaflet = async () => {
      try {
        const L = await import('leaflet');
        leafletRef.current = L.default;
        if (!document.getElementById('leaflet-css')) {
          const link = document.createElement('link');
          link.id = 'leaflet-css';
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);
        }
        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to load Leaflet:', error);
      }
    };
    loadLeaflet();
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;
    const L = leafletRef.current;
    if (!L) return;

    const defaultCenter = center || { lat: 48.8566, lng: 2.3522 };
    const map = L.map(mapRef.current, { zoomControl: false }).setView(
      [defaultCenter.lat, defaultCenter.lng], 13
    );

    // Zoom control in bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CartoDB Voyager: colorful, modern tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [isLoaded, center]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !isLoaded) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    markerMapRef.current.clear();

    // Remove existing polylines/layers (except tile layer)
    map.eachLayer((layer: any) => {
      if (layer._url === undefined && !layer._tiles) {
        map.removeLayer(layer);
      }
    });

    if (items.length === 0) return;

    const bounds = L.latLngBounds([]);
    let globalIndex = 1;

    // Create numbered marker
    const createNumberedIcon = (num: number, type: string, isHighlighted: boolean) => {
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
    };

    items.forEach((item) => {
      if (!item.latitude || !item.longitude) return;
      const num = globalIndex++;
      const isHovered = item.id === hoveredItemId;
      const icon = createNumberedIcon(num, item.type, isHovered);

      const marker = L.marker([item.latitude, item.longitude], { icon })
        .addTo(map)
        .bindPopup(getPopupContent(item, num), {
          maxWidth: 300,
          className: 'clean-popup',
        });

      if (onItemClick) {
        marker.on('click', () => onItemClick(item));
      }

      markersRef.current.push(marker);
      markerMapRef.current.set(item.id, { marker, num, type: item.type });
      bounds.extend([item.latitude, item.longitude]);
    });

    // Add flight departure coords to bounds before fitBounds (if present)
    if (flightInfo?.departureCoords) {
      bounds.extend([flightInfo.departureCoords.lat, flightInfo.departureCoords.lng]);
    }

    // Single fitBounds call with all points (items + flight origin)
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    // Draw solid route lines between non-flight items
    const routeCoords = items
      .filter((item) => item.latitude && item.longitude && item.type !== 'flight')
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((item) => [item.latitude, item.longitude] as [number, number]);

    if (routeCoords.length > 1) {
      L.polyline(routeCoords, {
        color: '#3B82F6',
        weight: 3,
        opacity: 0.5,
        smoothFactor: 1.5,
        lineJoin: 'round',
      }).addTo(map);
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
      ).addTo(map)
        .bindPopup(`<b>Ville de départ</b><br/>${flightInfo.departureCity || 'Origine'}`);
      markersRef.current.push(originMarker);
      // Note: bounds already extended earlier before fitBounds

      const firstDestItem = items.find(i => i.type !== 'flight' && i.latitude && i.longitude);
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

        L.polyline(curvePoints, {
          color: '#6366F1',
          weight: 2,
          opacity: 0.6,
          dashArray: '8, 6',
        }).addTo(map);

        // Airplane marker
        const planeIndex = Math.floor(numPoints * 0.6);
        const planePos = curvePoints[planeIndex];
        const nextPos = curvePoints[Math.min(planeIndex + 3, numPoints)];
        const deltaLng = nextPos[1] - planePos[1];
        const deltaLat = nextPos[0] - planePos[0];
        const angleDeg = (Math.atan2(deltaLng, deltaLat) * 180 / Math.PI);

        const planeIcon = L.divIcon({
          className: 'plane-marker',
          html: `<div style="font-size:16px;transform:rotate(${angleDeg + 90}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">✈️</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const planeMarker = L.marker(planePos, { icon: planeIcon, interactive: false }).addTo(map);
        markersRef.current.push(planeMarker);
      }
    }
  }, [items, onItemClick, isLoaded, flightInfo, hoveredItemId]);

  // Highlight hovered item
  useEffect(() => {
    if (!hoveredItemId || !mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const entry = markerMapRef.current.get(hoveredItemId);
    if (entry) {
      const icon = L.divIcon({
        className: 'numbered-marker',
        html: `<div style="
          width:32px;height:32px;border-radius:50%;
          background:${MARKER_COLORS[entry.type]?.bg || '#666'};border:2px solid white;
          color:white;font-size:13px;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          box-shadow: 0 0 0 3px ${MARKER_COLORS[entry.type]?.bg || '#666'}40, 0 2px 8px rgba(0,0,0,0.3);
          transform:scale(1.2);z-index:1000;
        ">${entry.num}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
      });
      entry.marker.setIcon(icon);
    }

    return () => {
      if (entry) {
        const normalIcon = L.divIcon({
          className: 'numbered-marker',
          html: `<div style="
            width:26px;height:26px;border-radius:50%;
            background:${MARKER_COLORS[entry.type]?.bg || '#666'};border:2px solid white;
            color:white;font-size:11px;font-weight:700;
            display:flex;align-items:center;justify-content:center;
            box-shadow: 0 1px 4px rgba(0,0,0,0.25);
          ">${entry.num}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -13],
        });
        entry.marker.setIcon(normalIcon);
      }
    };
  }, [hoveredItemId]);

  // Pan to selected item with smart zoom
  useEffect(() => {
    if (!selectedItemId || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const item = items.find((i) => i.id === selectedItemId);
    if (item?.latitude && item?.longitude) {
      // Keep current zoom if already zoomed in enough, otherwise zoom to 15
      const currentZoom = map.getZoom();
      const targetZoom = Math.max(currentZoom, 15);
      map.setView([item.latitude, item.longitude], targetZoom, { animate: true });

      // Open popup for the selected marker
      const entry = markerMapRef.current.get(selectedItemId);
      if (entry?.marker) {
        entry.marker.openPopup();
      }
    }
  }, [selectedItemId, items]);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="text-muted-foreground text-sm">Chargement de la carte...</div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
}
