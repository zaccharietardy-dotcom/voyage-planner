'use client';

import { useEffect, useRef, useState } from 'react';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';

interface TripMapProps {
  items: TripItem[];
  center?: { lat: number; lng: number };
  selectedItemId?: string;
  onItemClick?: (item: TripItem) => void;
  // Optionnel: informations sur les vols pour afficher les escales
  flightInfo?: {
    departureCity?: string;
    departureCoords?: { lat: number; lng: number };
    arrivalCity?: string;
    arrivalCoords?: { lat: number; lng: number };
    stopoverCities?: string[];
  };
}

// Icônes par type d'item
const TYPE_ICONS: Record<string, string> = {
  activity: '🏛️',
  restaurant: '🍽️',
  hotel: '🏨',
  transport: '🚌',
  flight: '✈️',
  parking: '🅿️',
  checkin: '🔑',
  checkout: '🚪',
};

// Génère le contenu du popup avec liens Google Maps
function getPopupContent(item: TripItem): string {
  const emoji = TYPE_ICONS[item.type] || '📍';
  // PRIORITÉ: lien par nom (plus fiable que GPS)
  const googleMapsUrl = item.googleMapsPlaceUrl ||
    item.googleMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;

  let details = '';
  if (item.estimatedCost) {
    details += `<p style="margin: 2px 0; font-size: 11px;">💰 ${item.estimatedCost}€</p>`;
  }
  if (item.rating) {
    details += `<p style="margin: 2px 0; font-size: 11px;">⭐ ${item.rating.toFixed(1)}/5</p>`;
  }
  if (item.timeFromPrevious) {
    details += `<p style="margin: 2px 0; font-size: 11px;">🚶 ${item.timeFromPrevious} min depuis précédent</p>`;
  }

  return `
    <div style="min-width: 200px; max-width: 280px;">
      <div style="font-size: 14px; font-weight: bold; margin-bottom: 4px;">
        ${emoji} ${item.title}
      </div>
      <p style="margin: 4px 0; font-size: 12px; color: #666;">
        🕐 ${item.startTime} - ${item.endTime}
      </p>
      <p style="margin: 4px 0; font-size: 12px; color: #444;">
        ${item.description || ''}
      </p>
      ${details}
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
        <a href="${googleMapsUrl}" target="_blank"
           style="display: inline-flex; align-items: center; gap: 4px; color: #1a73e8; font-size: 12px; text-decoration: none;">
          🗺️ Voir sur Google Maps
        </a>
        ${item.bookingUrl ? `
          <br/>
          <a href="${item.bookingUrl}" target="_blank"
             style="display: inline-flex; align-items: center; gap: 4px; color: #34a853; font-size: 12px; text-decoration: none; margin-top: 4px;">
            🎫 Réserver
          </a>
        ` : ''}
      </div>
    </div>
  `;
}

export function TripMap({ items, center, selectedItemId, onItemClick, flightInfo }: TripMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const leafletRef = useRef<any>(null);

  // Load Leaflet dynamically (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadLeaflet = async () => {
      try {
        // Import Leaflet library
        const L = await import('leaflet');
        leafletRef.current = L.default;

        // Load CSS via link element
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

  // Initialize map
  useEffect(() => {
    if (!isLoaded || !mapRef.current || mapInstanceRef.current) return;

    const L = leafletRef.current;
    if (!L) return;

    const defaultCenter = center || { lat: 48.8566, lng: 2.3522 };
    const map = L.map(mapRef.current).setView(
      [defaultCenter.lat, defaultCenter.lng],
      13
    );

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [isLoaded, center]);

  // Update markers when items change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L || !isLoaded) return;

    // Remove existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (items.length === 0) return;

    // Create icon function
    const createIcon = (color: string, emoji?: string) => {
      return L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="
            background-color: ${color};
            width: ${emoji ? '32px' : '24px'};
            height: ${emoji ? '32px' : '24px'};
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${emoji ? '16px' : '12px'};
          ">${emoji || ''}</div>
        `,
        iconSize: [emoji ? 32 : 24, emoji ? 32 : 24],
        iconAnchor: [emoji ? 16 : 12, emoji ? 16 : 12],
        popupAnchor: [0, emoji ? -16 : -12],
      });
    };

    // Add new markers
    const bounds = L.latLngBounds([]);

    items.forEach((item) => {
      if (!item.latitude || !item.longitude) return;

      const color = TRIP_ITEM_COLORS[item.type];
      const emoji = TYPE_ICONS[item.type];
      const icon = createIcon(color, emoji);

      const marker = L.marker([item.latitude, item.longitude], { icon })
        .addTo(map)
        .bindPopup(getPopupContent(item));

      if (onItemClick) {
        marker.on('click', () => onItemClick(item));
      }

      markersRef.current.push(marker);
      bounds.extend([item.latitude, item.longitude]);
    });

    // Fit map to show all markers
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    // Draw route line between points (for walking/transit in destination city)
    const routeCoords = items
      .filter((item) => item.latitude && item.longitude && item.type !== 'flight')
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((item) => [item.latitude, item.longitude] as [number, number]);

    if (routeCoords.length > 1) {
      L.polyline(routeCoords, {
        color: '#3B82F6',
        weight: 3,
        opacity: 0.6,
        dashArray: '10, 10',
      }).addTo(map);
    }

    // Draw flight path as curved dashed line (if we have flight items)
    const flightItems = items.filter(item => item.type === 'flight');
    flightItems.forEach(flightItem => {
      if (flightItem.flight) {
        // Add departure airport marker if different from other items
        const flight = flightItem.flight;

        // Try to find coordinates for stopovers
        if (flight.stops > 0 && flight.stopCities && flight.stopCities.length > 0) {
          // Add stopover markers with special styling
          flight.stopCities.forEach((stopCity, idx) => {
            // Create a special marker for stopovers (we don't have exact coords, so show as info)
            const stopoverIcon = L.divIcon({
              className: 'stopover-marker',
              html: `
                <div style="
                  background: linear-gradient(135deg, #F59E0B, #D97706);
                  color: white;
                  padding: 4px 8px;
                  border-radius: 12px;
                  font-size: 11px;
                  font-weight: 600;
                  white-space: nowrap;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                  border: 2px solid white;
                ">
                  ✈️ Escale: ${stopCity}
                </div>
              `,
              iconSize: [100, 24],
              iconAnchor: [50, 12],
            });

            // Position the stopover label near the flight marker
            if (flightItem.latitude && flightItem.longitude) {
              const offsetLat = flightItem.latitude + (idx + 1) * 0.02;
              const stopMarker = L.marker([offsetLat, flightItem.longitude], { icon: stopoverIcon })
                .addTo(map);
              markersRef.current.push(stopMarker);
            }
          });
        }
      }
    });

    // Add origin city marker if provided in flightInfo
    if (flightInfo?.departureCoords) {
      const originIcon = L.divIcon({
        className: 'origin-marker',
        html: `
          <div style="
            background: linear-gradient(135deg, #10B981, #059669);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          ">🏠</div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18],
      });

      const originMarker = L.marker(
        [flightInfo.departureCoords.lat, flightInfo.departureCoords.lng],
        { icon: originIcon }
      )
        .addTo(map)
        .bindPopup(`<b>🏠 Ville de départ</b><br/>${flightInfo.departureCity || 'Origine'}`);
      markersRef.current.push(originMarker);
      bounds.extend([flightInfo.departureCoords.lat, flightInfo.departureCoords.lng]);

      // Draw flight arc from origin to destination
      if (items.length > 0) {
        const firstDestItem = items.find(i => i.type !== 'flight' && i.latitude && i.longitude);
        if (firstDestItem) {
          // Create curved flight path
          const midLat = (flightInfo.departureCoords.lat + firstDestItem.latitude) / 2;
          const midLng = (flightInfo.departureCoords.lng + firstDestItem.longitude) / 2;
          // Add curvature based on distance
          const curvature = Math.abs(flightInfo.departureCoords.lng - firstDestItem.longitude) * 0.1;

          L.polyline([
            [flightInfo.departureCoords.lat, flightInfo.departureCoords.lng],
            [midLat + curvature, midLng],
            [firstDestItem.latitude, firstDestItem.longitude]
          ], {
            color: '#EC4899',
            weight: 2,
            opacity: 0.7,
            dashArray: '8, 8',
          }).addTo(map);
        }
      }

      // Re-fit bounds to include origin
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [items, onItemClick, isLoaded, flightInfo]);

  // Highlight selected item
  useEffect(() => {
    if (!selectedItemId || !mapInstanceRef.current) return;

    const item = items.find((i) => i.id === selectedItemId);
    if (item && item.latitude && item.longitude) {
      mapInstanceRef.current.setView([item.latitude, item.longitude], 15);
    }
  }, [selectedItemId, items]);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="text-gray-500">Chargement de la carte...</div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-lg p-3 shadow-lg z-[1000]">
        <p className="text-xs font-medium mb-2">Légende</p>
        <div className="space-y-1">
          {([
            { type: 'activity' as const, label: 'Activité', icon: '🏛️' },
            { type: 'restaurant' as const, label: 'Restaurant', icon: '🍽️' },
            { type: 'hotel' as const, label: 'Hébergement', icon: '🏨' },
            { type: 'flight' as const, label: 'Vol', icon: '✈️' },
          ]).map(({ type, label, icon }) => (
            <div key={type} className="flex items-center gap-2 text-xs">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                style={{ backgroundColor: TRIP_ITEM_COLORS[type] }}
              >
                {icon}
              </div>
              <span>{label}</span>
            </div>
          ))}
          {/* Special markers */}
          {flightInfo?.departureCoords && (
            <div className="flex items-center gap-2 text-xs">
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-green-500">
                🏠
              </div>
              <span>Départ</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
