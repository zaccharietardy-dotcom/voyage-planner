'use client';

import { TripDay } from '@/lib/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { MapPin, ChevronRight } from 'lucide-react';

const DAY_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-teal-500',
];

interface TripOverviewTabProps {
  days: TripDay[];
  onDayClick?: (dayNumber: string) => void;
}

export function TripOverviewTab({ days, onDayClick }: TripOverviewTabProps) {
  return (
    <div className="space-y-2.5 py-1">
      {days.map((day) => {
        const activities = day.items.filter(
          (item) => item.type === 'activity' || item.type === 'restaurant'
        );
        const mainActivities = day.items.filter(
          (item) => item.type === 'activity'
        );
        const colorClass = DAY_COLORS[(day.dayNumber - 1) % DAY_COLORS.length];
        const dateStr = day.date
          ? format(new Date(day.date), 'EEE d MMM', { locale: fr })
          : '';

        return (
          <button
            key={day.dayNumber}
            className="group flex w-full items-stretch gap-3 rounded-2xl border border-border/60 bg-card/80 p-3 text-left transition-all active:scale-[0.98] hover:border-primary/30 hover:shadow-soft"
            onClick={() => onDayClick?.(day.dayNumber.toString())}
          >
            {/* Color band */}
            <div className={`w-1 shrink-0 rounded-full ${colorClass}`} />

            <div className="min-w-0 flex-1">
              {/* Day header */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold">
                    Jour {day.dayNumber}
                  </span>
                  {dateStr && (
                    <span className="ml-2 text-xs text-muted-foreground capitalize">
                      {dateStr}
                    </span>
                  )}
                  {day.isDayTrip && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Day Trip
                    </span>
                  )}
                  {day.weatherForecast && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {day.weatherForecast.icon} {day.weatherForecast.tempMin}°/{day.weatherForecast.tempMax}°
                    </span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>

              {/* Activity summary */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {mainActivities.length > 0 ? (
                  mainActivities.map((item, idx) => (
                    <span key={item.id} className="flex items-center text-xs text-muted-foreground">
                      {idx > 0 && (
                        <span className="mx-1 text-muted-foreground/30">&rarr;</span>
                      )}
                      <span className="truncate max-w-[140px]">{item.title}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground/60 italic">
                    Aucune activité
                  </span>
                )}
              </div>

              {/* Stats row */}
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/70">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {activities.length} {activities.length > 1 ? 'étapes' : 'étape'}
                </span>
                {day.theme && (
                  <span className="truncate">{day.theme}</span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
