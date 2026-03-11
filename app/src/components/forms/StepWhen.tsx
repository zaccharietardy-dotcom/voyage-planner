'use client';

import { TripPreferences } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { fr } from 'date-fns/locale';

interface StepWhenProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

const DURATION_OPTIONS = [
  { days: 2, label: 'Week-end', sub: '2 jours' },
  { days: 3, label: 'Court séjour', sub: '3 jours' },
  { days: 5, label: 'Semaine', sub: '5 jours' },
  { days: 7, label: 'Semaine+', sub: '7 jours' },
  { days: 10, label: 'Long séjour', sub: '10 jours' },
  { days: 14, label: '2 semaines', sub: '14 jours' },
];

export function StepWhen({ data, onChange }: StepWhenProps) {
  const [showCalendar, setShowCalendar] = useState(false);

  const selectedDuration = data.durationDays || 7;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-serif font-bold mb-1">Quand partez-vous ?</h2>
        <p className="text-sm text-muted-foreground">Choisissez la durée et les dates</p>
      </div>

      {/* Duration picker */}
      <div>
        <p className="text-sm font-medium mb-3">Durée du séjour</p>
        <div className="grid grid-cols-3 gap-2">
          {DURATION_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              className={`rounded-xl border p-3 text-center transition-all ${
                selectedDuration === opt.days
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                  : 'border-border/60 bg-card hover:border-primary/30'
              }`}
              onClick={() => {
                const cityPlan = data.cityPlan || [{ city: '', days: opt.days }];
                onChange({
                  durationDays: opt.days,
                  cityPlan: cityPlan.length === 1
                    ? [{ ...cityPlan[0], days: opt.days }]
                    : cityPlan,
                });
              }}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Date selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Date de départ</p>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-primary h-7"
            onClick={() => setShowCalendar(!showCalendar)}
          >
            {showCalendar ? 'Masquer le calendrier' : 'Choisir une date'}
          </Button>
        </div>

        {data.startDate && (
          <p className="text-sm text-muted-foreground mb-2">
            {format(new Date(data.startDate), "EEEE d MMMM yyyy", { locale: fr })}
            {data.durationDays && ` — ${format(addDays(new Date(data.startDate), data.durationDays - 1), "d MMM", { locale: fr })}`}
          </p>
        )}

        {showCalendar && (
          <div className="rounded-xl border border-border/60 bg-card p-3 inline-block">
            <Calendar
              mode="single"
              selected={data.startDate ? new Date(data.startDate) : undefined}
              onSelect={(date) => {
                if (date) {
                  onChange({ startDate: date });
                }
              }}
              disabled={(date) => date < new Date()}
              locale={fr}
            />
          </div>
        )}

        {!data.startDate && !showCalendar && (
          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded-xl border border-border/60 bg-card p-3 text-left hover:border-primary/30 transition-colors"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + ((6 - d.getDay()) % 7 || 7)); // Next Saturday
                onChange({ startDate: d });
              }}
            >
              <p className="text-sm font-medium">Ce week-end</p>
              <p className="text-xs text-muted-foreground">
                {format((() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay()) % 7 || 7)); return d; })(), 'd MMM', { locale: fr })}
              </p>
            </button>
            <button
              className="rounded-xl border border-border/60 bg-card p-3 text-left hover:border-primary/30 transition-colors"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 14);
                onChange({ startDate: d });
              }}
            >
              <p className="text-sm font-medium">Dans 2 semaines</p>
              <p className="text-xs text-muted-foreground">
                {format(addDays(new Date(), 14), 'd MMM', { locale: fr })}
              </p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
