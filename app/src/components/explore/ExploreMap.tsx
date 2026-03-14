'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ExploreDestination } from '@/lib/services/exploreDestinations';

interface ExploreMapProps {
  destinations: ExploreDestination[];
}

export function ExploreMap({ destinations }: ExploreMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current, {
      center: [30, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 6,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(mapInstance.current);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Clear existing markers
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    // Add markers
    for (const dest of destinations) {
      const color = dest.affordable ? '#22C55E' : '#94A3B8';

      const icon = L.divIcon({
        className: 'explore-marker',
        html: `<div style="
          background: ${color};
          color: white;
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          text-align: center;
          transform: translate(-50%, -100%);
        ">${dest.dailyCost}\u20ac</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      L.marker([dest.lat, dest.lng], { icon })
        .bindPopup(`
          <div style="text-align:center; min-width: 120px;">
            <strong>${dest.city}</strong><br/>
            <small>${dest.country}</small><br/>
            <span style="font-size: 16px; font-weight: bold; color: ${color};">${dest.dailyCost}\u20ac/jour</span><br/>
            <small>~${dest.totalEstimate}\u20ac total</small>
          </div>
        `)
        .addTo(map);
    }
  }, [destinations]);

  return <div ref={mapRef} className="w-full h-[60vh]" />;
}
