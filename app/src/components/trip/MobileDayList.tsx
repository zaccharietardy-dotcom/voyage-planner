'use client';

import { TripDay, TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  MapPin,
  Utensils,
  Hotel,
  Car,
  Bus,
  TrainFront,
  TramFront,
  Ship,
  Footprints,
  Plane,
  ParkingCircle,
  LogIn,
  LogOut,
  Luggage,
  Clock,
  ChevronRight,
} from 'lucide-react';

const TYPE_ICONS: Record<string, React.ElementType> = {
  activity: MapPin,
  restaurant: Utensils,
  hotel: Hotel,
  transport: TramFront,
  flight: Plane,
  parking: ParkingCircle,
  checkin: LogIn,
  checkout: LogOut,
  luggage: Luggage,
};

const TRANSPORT_UI_V2_ENABLED = !['0', 'false', 'off'].includes(
  String(process.env.NEXT_PUBLIC_PIPELINE_TRANSPORT_UI_V2 || 'true').toLowerCase()
);

const TRANSPORT_MODE_ICONS: Record<NonNullable<TripItem['transportMode']>, React.ElementType> = {
  train: TrainFront,
  bus: Bus,
  car: Car,
  ferry: Ship,
  walking: Footprints,
  transit: TramFront,
};

function normalizeTransportModeForUi(mode?: string): TripItem['transportMode'] | undefined {
  if (!mode) return undefined;
  const normalized = mode.toLowerCase();
  if (normalized === 'train' || normalized === 'bus' || normalized === 'car' || normalized === 'ferry') return normalized;
  if (normalized === 'walk' || normalized === 'walking') return 'walking';
  if (normalized === 'public' || normalized === 'metro' || normalized === 'tram' || normalized === 'subway' || normalized === 'transit' || normalized === 'combined') return 'transit';
  return undefined;
}

function getTransportModeForItem(item: TripItem): TripItem['transportMode'] {
  const explicit = normalizeTransportModeForUi(item.transportMode);
  if (explicit) return explicit;

  if (item.transitLegs && item.transitLegs.length > 0) {
    const weighted = new Map<string, number>();
    for (const leg of item.transitLegs) {
      const mode = normalizeTransportModeForUi(leg.mode);
      if (!mode) continue;
      weighted.set(mode, (weighted.get(mode) || 0) + Math.max(1, leg.duration || 1));
    }
    if (weighted.size > 0) {
      return [...weighted.entries()].sort((a, b) => b[1] - a[1])[0][0] as TripItem['transportMode'];
    }
  }

  const title = (item.title || '').toLowerCase();
  if (title.includes('train')) return 'train';
  if (title.includes('bus')) return 'bus';
  if (title.includes('ferry')) return 'ferry';
  if (title.includes('walk') || title.includes('à pied')) return 'walking';
  return 'transit';
}

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

interface MobileDayListProps {
  day: TripDay;
  onClickItem?: (item: TripItem) => void;
}

export function MobileDayList({ day, onClickItem }: MobileDayListProps) {
  const sortedItems = [...day.items].sort((a, b) => {
    const aTime = a.startTime || '00:00';
    const bTime = b.startTime || '00:00';
    return aTime.localeCompare(bTime);
  });

  if (sortedItems.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Aucune activité pour ce jour
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Weather banner */}
      {day.weatherForecast && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <span className="text-lg">{day.weatherForecast.icon}</span>
          <span className="font-medium text-foreground">
            {day.weatherForecast.tempMin}° / {day.weatherForecast.tempMax}°
          </span>
          <span className="truncate">{day.weatherForecast.condition}</span>
        </div>
      )}
      {sortedItems.map((item) => {
        const color = TRIP_ITEM_COLORS[item.type] || '#6B7280';
        const transportMode = item.type === 'transport' && TRANSPORT_UI_V2_ENABLED
          ? getTransportModeForItem(item)
          : undefined;
        const transportIconTestId = transportMode ? `transport-icon-${transportMode}` : undefined;
        const Icon = item.type === 'transport' && TRANSPORT_UI_V2_ENABLED
          ? (TRANSPORT_MODE_ICONS[transportMode || 'transit'] || TYPE_ICONS.transport)
          : (TYPE_ICONS[item.type] || MapPin);
        const durationMin = computeDuration(item.startTime, item.endTime);

        return (
          <button
            key={item.id}
            onClick={() => onClickItem?.(item)}
            className={cn(
              'w-full flex items-center gap-3 p-3 rounded-lg border bg-card',
              'hover:bg-accent/50 active:scale-[0.98] transition-all text-left'
            )}
          >
            {/* Time column */}
            <div className="flex flex-col items-center w-14 flex-shrink-0">
              <span className="text-sm font-semibold tabular-nums">{item.startTime || '--:--'}</span>
              {durationMin > 0 && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {durationMin}min
                </span>
              )}
            </div>

            {/* Color indicator + icon */}
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon
                className="h-4 w-4"
                style={{ color }}
                data-testid={transportIconTestId}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {TYPE_LABELS[item.type] || item.type}
                {item.estimatedCost ? ` · ~${item.estimatedCost}€` : ''}
                {item.rating ? ` · ${item.rating.toFixed(1)}★` : ''}
              </p>
            </div>

            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function computeDuration(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;
  return (eh * 60 + em) - (sh * 60 + sm);
}
