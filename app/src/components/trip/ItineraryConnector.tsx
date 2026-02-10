'use client';

import { Navigation, Clock, MapPin, Footprints, Car, TrainFront } from 'lucide-react';

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
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  };

  return (
    <a
      href={googleMapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 py-1.5 px-3 my-1 ml-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer group"
    >
      <ModeIcon className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-80 transition-opacity" />

      <span className="truncate">
        → {to.name}
      </span>

      {(duration || distance) && (
        <span className="flex items-center gap-2 shrink-0 ml-auto opacity-60 group-hover:opacity-100 transition-opacity">
          {duration && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatDuration(duration)}
            </span>
          )}
          {distance && distance > 0.1 && (
            <span>{formatDistance(distance)}</span>
          )}
        </span>
      )}

      <Navigation className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
    </a>
  );
}
