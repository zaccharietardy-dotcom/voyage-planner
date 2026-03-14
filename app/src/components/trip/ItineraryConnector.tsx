'use client';

import { useState } from 'react';
import { Navigation, Clock, Footprints, Car, TrainFront, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TransportMode = 'walk' | 'transit' | 'driving' | 'car' | 'public' | 'taxi' | 'bike';

/** Speed estimates (km/h) per transport mode for travel time recalculation */
export const TRANSPORT_SPEEDS: Record<string, number> = {
  walk: 4.5,
  transit: 25,
  public: 25,
  bike: 15,
  car: 35,
  driving: 35,
  taxi: 30,
};

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
  mode?: TransportMode;
  transitLines?: Array<{ number: string; name?: string; mode: string; color?: string; departureStop?: string; arrivalStop?: string; numStops?: number }>;
  onModeChange?: (newMode: TransportMode) => void;
  isEditable?: boolean;
}

const MODE_OPTIONS: { mode: TransportMode; icon: typeof Footprints; label: string }[] = [
  { mode: 'walk', icon: Footprints, label: 'À pied' },
  { mode: 'transit', icon: TrainFront, label: 'Transport' },
  { mode: 'car', icon: Car, label: 'Voiture' },
  { mode: 'bike', icon: Bike, label: 'Vélo' },
];

export function ItineraryConnector({
  from,
  to,
  duration,
  distance,
  mode = 'walk',
  transitLines,
  onModeChange,
  isEditable = false,
}: ItineraryConnectorProps) {
  const [showModeSelector, setShowModeSelector] = useState(false);

  const googleMapsMode = mode === 'walk' ? 'walking'
    : mode === 'bike' ? 'bicycling'
    : mode === 'transit' || mode === 'public' ? 'transit'
    : 'driving';

  const origin = from.name ? encodeURIComponent(from.name) : `${from.latitude},${from.longitude}`;
  const destination = to.name ? encodeURIComponent(to.name) : `${to.latitude},${to.longitude}`;
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${googleMapsMode}`;

  const currentOption = MODE_OPTIONS.find(o => o.mode === mode || (o.mode === 'transit' && mode === 'public')) || MODE_OPTIONS[0];
  const ModeIcon = currentOption.icon;

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

  const handleModeClick = (e: React.MouseEvent, newMode: TransportMode) => {
    e.preventDefault();
    e.stopPropagation();
    onModeChange?.(newMode);
    setShowModeSelector(false);
  };

  const handleConnectorClick = (e: React.MouseEvent) => {
    if (isEditable && onModeChange) {
      e.preventDefault();
      setShowModeSelector(!showModeSelector);
    }
  };

  return (
    <div className="relative">
      <a
        href={isEditable ? undefined : googleMapsUrl}
        target={isEditable ? undefined : '_blank'}
        rel="noopener noreferrer"
        onClick={handleConnectorClick}
        className={cn(
          'flex items-center gap-2 py-2 px-3 my-1.5 ml-2 rounded-lg border border-dashed border-border/50 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 hover:border-primary/30 transition-all group',
          isEditable ? 'cursor-pointer' : 'cursor-pointer',
        )}
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

        {/* Transit line badges (metro M6, bus 42, etc.) */}
        {transitLines && transitLines.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            {transitLines.slice(0, 3).map((line, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white leading-none"
                style={{ backgroundColor: line.color || '#6B7280' }}
                title={[line.name, line.departureStop && `de ${line.departureStop}`, line.arrivalStop && `à ${line.arrivalStop}`, line.numStops && `${line.numStops} arrêts`].filter(Boolean).join(' · ')}
              >
                {line.mode === 'metro' ? 'M' : line.mode === 'tram' ? 'T' : ''}{line.number}
              </span>
            ))}
          </span>
        )}

        {!isEditable && (
          <Navigation className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
        )}
        {isEditable && (
          <span className="text-[10px] opacity-0 group-hover:opacity-50 transition-opacity shrink-0">changer</span>
        )}
      </a>

      {/* Mode selector popover */}
      {showModeSelector && (
        <div className="absolute left-2 top-full z-20 mt-1 flex gap-1 rounded-xl border bg-background/95 backdrop-blur-sm p-1.5 shadow-lg">
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isActive = opt.mode === mode || (opt.mode === 'transit' && mode === 'public');
            return (
              <button
                key={opt.mode}
                onClick={(e) => handleModeClick(e, opt.mode)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                )}
                title={opt.label}
              >
                <Icon className="h-4 w-4" />
                {opt.label}
              </button>
            );
          })}
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            <Navigation className="h-4 w-4" />
            Maps
          </a>
        </div>
      )}
    </div>
  );
}
