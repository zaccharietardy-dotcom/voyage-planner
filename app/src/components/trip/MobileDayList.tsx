'use client';

import { TripDay, TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  MapPin,
  Utensils,
  Hotel,
  Car,
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
  transport: Car,
  flight: Plane,
  parking: ParkingCircle,
  checkin: LogIn,
  checkout: LogOut,
  luggage: Luggage,
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
      {sortedItems.map((item, idx) => {
        const color = TRIP_ITEM_COLORS[item.type] || '#6B7280';
        const Icon = TYPE_ICONS[item.type] || MapPin;
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
              <Icon className="h-4 w-4" style={{ color }} />
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
