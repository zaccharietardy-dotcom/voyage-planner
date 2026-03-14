'use client';

import { useMemo } from 'react';
import { Trip, TripDay } from '@/lib/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { MapPin, ChevronRight, Banknote, Thermometer, Shield, Scale } from 'lucide-react';
import { buildTravelIntelligence } from '@/lib/services/travelIntelligence';

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
  trip?: Trip;
  onDayClick?: (dayNumber: string) => void;
}

export function TripOverviewTab({ days, trip, onDayClick }: TripOverviewTabProps) {
  const intelligence = useMemo(() => trip ? buildTravelIntelligence(trip) : null, [trip]);

  const visaInfo = trip?.travelTips?.legal?.visaInfo?.[0]?.requirement;

  const hasQuickInfo = intelligence && (
    intelligence.currency || intelligence.weatherSummary || intelligence.emergencyNumbers || visaInfo
  );

  return (
    <div className="space-y-2.5 py-1">
      {/* Quick Info Cards */}
      {hasQuickInfo && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {visaInfo && (
            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-purple-50/50 dark:bg-purple-950/20 p-2.5">
              <Scale className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Visa</p>
                <p className="text-xs text-foreground leading-snug line-clamp-2">{visaInfo}</p>
              </div>
            </div>
          )}

          {intelligence.currency && (
            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5">
              <Banknote className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Devise</p>
                <p className="text-xs font-semibold">{intelligence.currency.symbol} {intelligence.currency.code}</p>
                <p className="text-[10px] text-muted-foreground">{intelligence.currency.name}</p>
              </div>
            </div>
          )}

          {intelligence.weatherSummary && (
            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-blue-50/50 dark:bg-blue-950/20 p-2.5">
              <Thermometer className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Climat</p>
                <p className="text-xs font-semibold">{intelligence.weatherSummary.avgTempMin}° / {intelligence.weatherSummary.avgTempMax}°</p>
                <p className="text-[10px] text-muted-foreground capitalize">{intelligence.weatherSummary.mainCondition}</p>
              </div>
            </div>
          )}

          {intelligence.emergencyNumbers && (
            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-red-50/50 dark:bg-red-950/20 p-2.5">
              <Shield className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Urgences</p>
                <p className="text-xs">
                  <span className="font-semibold">{intelligence.emergencyNumbers.police}</span>
                  <span className="text-muted-foreground"> police</span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {intelligence.emergencyNumbers.ambulance} amb. / {intelligence.emergencyNumbers.fire} pomp.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

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
