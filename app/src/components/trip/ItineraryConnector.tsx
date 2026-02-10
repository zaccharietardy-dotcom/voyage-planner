'use client';

import { Footprints, Car, TrainFront } from 'lucide-react';

interface ItineraryConnectorProps {
  from: {
    name: string;
    latitude: number;
    longitude: number;
  };
  to: {
    name: string;
    latitude: number;
    longitude: number;
  };
  duration?: number;
  distance?: number;
  mode?: 'walk' | 'transit' | 'driving' | 'car' | 'public' | 'taxi';
}

export function ItineraryConnector({
  from,
  to,
  duration,
  distance,
  mode = 'walk',
}: ItineraryConnectorProps) {
  const googleMapsMode = mode === 'walk' ? 'walking'
    : mode === 'transit' || mode === 'public' ? 'transit'
    : 'driving';

  const origin = from.name ? encodeURIComponent(from.name) : `${from.latitude},${from.longitude}`;
  const destination = to.name ? encodeURIComponent(to.name) : `${to.latitude},${to.longitude}`;
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${googleMapsMode}`;

  const ModeIcon = mode === 'walk' ? Footprints
    : mode === 'transit' || mode === 'public' ? TrainFront
    : Car;

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h${remainingMins}` : `${hours}h`;
  };

  const formatDistance = (km: number) => {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  };

  if (!duration && !distance) return null;

  return (
    <a
      href={googleMapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 py-1 px-2 my-0.5 ml-1 rounded-md text-[10px] text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/20 transition-all cursor-pointer group"
    >
      <ModeIcon className="h-3 w-3 shrink-0" />

      <span className="flex items-center gap-1.5">
        {duration && (
          <span className="tabular-nums">{formatDuration(duration)}</span>
        )}
        {distance && distance > 0.1 && (
          <span className="opacity-60">{formatDistance(distance)}</span>
        )}
      </span>

      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary/60 ml-auto text-[9px]">
        Itineraire
      </span>
    </a>
  );
}
