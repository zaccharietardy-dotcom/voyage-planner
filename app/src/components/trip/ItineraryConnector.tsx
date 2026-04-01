'use client';

import { useState } from 'react';
import { Navigation, Clock, Footprints, Car, TrainFront, Bike, ChevronRight, Map as MapIcon, MoreHorizontal, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
  DrawerHandle,
} from '@/components/ui/drawer';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';

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

const MODE_OPTIONS: { mode: TransportMode; icon: typeof Footprints; label: string; description: string }[] = [
  { mode: 'walk', icon: Footprints, label: 'À pied', description: 'Idéal pour les courtes distances' },
  { mode: 'transit', icon: TrainFront, label: 'Transports', description: 'Métro, bus et tramway' },
  { mode: 'car', icon: Car, label: 'Voiture', description: 'Trajet en voiture ou taxi' },
  { mode: 'bike', icon: Bike, label: 'Vélo', description: 'Pour explorer librement' },
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
  const [showModeDrawer, setShowModeDrawer] = useState(false);

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

  const handleModeSelect = (newMode: TransportMode) => {
    onModeChange?.(newMode);
    setShowModeDrawer(false);
    hapticImpactMedium();
  };

  return (
    <div className="relative py-0.5">
      <div className="flex items-center gap-4 ml-[11px]">
        {/* Connector Line with animated feel */}
        <div className="w-[2px] h-6 bg-gradient-to-b from-gold/40 via-gold/10 to-transparent border-l border-dashed border-gold/30" />
        
        <div className="flex-1">
          <Drawer open={showModeDrawer} onOpenChange={setShowModeDrawer}>
            <DrawerTrigger asChild>
              <button
                onClick={() => {
                  if (isEditable) {
                    hapticImpactLight();
                    setShowModeDrawer(true);
                  } else {
                    window.open(googleMapsUrl, '_blank');
                  }
                }}
                className={cn(
                  "group flex items-center gap-3 py-2 px-3 rounded-2xl bg-[#0A1628]/40 border border-white/5 backdrop-blur-md transition-all active:scale-[0.98] w-full max-w-[320px] shadow-lg",
                  isEditable ? "hover:border-gold/30" : "hover:border-white/10"
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/10 text-gold shadow-inner border border-gold/20">
                  <ModeIcon className="h-4 w-4" />
                </div>

                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-xs font-black uppercase tracking-widest text-gold/80 mb-0.5">
                    {currentOption.label}
                  </span>
                  <div className="flex items-center gap-2 text-sm font-bold text-white/90">
                    {duration && formatDuration(duration)}
                    {distance && distance > 0.1 && (
                      <span className="text-white/60 font-medium">· {formatDistance(distance)}</span>
                    )}
                  </div>
                </div>

                {transitLines && transitLines.length > 0 && (
                  <div className="flex -space-x-1.5 mr-1">
                    {transitLines.slice(0, 2).map((line, idx) => (
                      <span
                        key={idx}
                        className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-black text-white border border-[#0A1628] shadow-sm"
                        style={{ backgroundColor: line.color || '#6B7280' }}
                      >
                        {line.number}
                      </span>
                    ))}
                  </div>
                )}

                {isEditable ? (
                  <MoreHorizontal className="h-4 w-4 text-white/20 group-hover:text-gold transition-colors" />
                ) : (
                  <MapIcon className="h-4 w-4 text-white/20 group-hover:text-gold transition-colors" />
                )}
              </button>
            </DrawerTrigger>

            <DrawerContent>
              <DrawerHandle />
              <DrawerHeader>
                <DrawerTitle className="text-white">Mode de transport</DrawerTitle>
              </DrawerHeader>
              <div className="p-6 pt-0 space-y-3">
                {MODE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = opt.mode === mode || (opt.mode === 'transit' && mode === 'public');
                  return (
                    <button
                      key={opt.mode}
                      onClick={() => handleModeSelect(opt.mode)}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-2xl border transition-all active:scale-[0.95]",
                        isActive 
                          ? "bg-gold/10 border-gold/50 text-white" 
                          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                        isActive ? "bg-gold text-black shadow-[0_0_15px_rgba(197,160,89,0.3)]" : "bg-white/5 text-gold/60"
                      )}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="font-black text-base">{opt.label}</span>
                        <span className="text-xs text-white/60">{opt.description}</span>
                      </div>
                      {isActive && <Check className="h-5 w-5 text-gold ml-auto" />}
                    </button>
                  );
                })}
                
                <div className="pt-4">
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-3 h-14 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-all"
                    onClick={() => hapticImpactLight()}
                  >
                    <MapIcon className="h-5 w-5 text-gold" />
                    Ouvrir dans Google Maps
                  </a>
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </div>
  );
}
