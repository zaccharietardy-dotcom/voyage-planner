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
  const [customMode, setCustomMode] = useState(false);

  const selectedDuration = data.durationDays || 7;
  const isPreset = DURATION_OPTIONS.some(o => o.days === selectedDuration);

  return (
    <div className="space-y-12 max-w-[600px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          Quand partez-vous ?
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          Définissez la durée et vos dates de voyage.
        </p>
      </div>

      <div className="space-y-10">
        {/* Duration picker */}
        <div className="space-y-4">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Durée du séjour</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                className={`group relative rounded-[1.2rem] border p-5 text-center transition-all duration-300 ${
                  selectedDuration === opt.days && !customMode
                    ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.15)] scale-[1.02]'
                    : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
                }`}
                onClick={() => {
                  setCustomMode(false);
                  const cityPlan = data.cityPlan || [{ city: '', days: opt.days }];
                  onChange({
                    durationDays: opt.days,
                    cityPlan: cityPlan.length === 1
                      ? [{ ...cityPlan[0], days: opt.days }]
                      : cityPlan,
                  });
                }}
              >
                <p className={`text-lg font-bold transition-colors ${selectedDuration === opt.days && !customMode ? 'text-white' : 'text-white/70 group-hover:text-white/90'}`}>{opt.label}</p>
                <p className="text-[13px] font-medium text-white/40 mt-1">{opt.sub}</p>
              </button>
            ))}
          </div>

        {/* Custom day count picker inline */}
        <div
          className={`w-full rounded-[1.2rem] border border-dashed p-4 text-center transition-all mt-4 ${
            customMode || (!isPreset && selectedDuration > 0)
              ? 'border-gold bg-[#0e1220] text-gold'
              : 'border-white/[0.15] bg-transparent text-white/70 hover:text-white hover:border-white/30 hover:bg-white/[0.03]'
          }`}
          onClick={() => {
            if (!customMode) setCustomMode(true);
          }}
        >
          {customMode || (!isPreset && selectedDuration > 0) ? (
            <div className="flex items-center justify-center gap-6">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedDuration > 1) {
                    const next = selectedDuration - 1;
                    const cityPlan = data.cityPlan || [{ city: '', days: next }];
                    onChange({
                      durationDays: next,
                      cityPlan: cityPlan.length === 1 ? [{ ...cityPlan[0], days: next }] : cityPlan,
                    });
                  }
                }}
              >
                -
              </Button>
              <div className="text-center w-24">
                <span className="text-2xl font-bold text-white">{selectedDuration}</span>
                <span className="text-sm ml-1 text-white/70">jours</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.min(30, selectedDuration + 1);
                  const cityPlan = data.cityPlan || [{ city: '', days: next }];
                  onChange({
                    durationDays: next,
                    cityPlan: cityPlan.length === 1 ? [{ ...cityPlan[0], days: next }] : cityPlan,
                  });
                }}
              >
                +
              </Button>
            </div>
          ) : (
            <span className="font-medium tracking-wide">Personnaliser la durée...</span>
          )}
        </div>
        </div>

      {/* Date selection */}
      <div className="space-y-4 pt-6 border-t border-white/[0.05]">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Date de départ</p>

        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={data.startDate ? new Date(data.startDate) : undefined}
            onSelect={(date) => {
              if (date) {
                onChange({ startDate: date });
              }
            }}
            disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
            locale={fr}
            className="rounded-[1.5rem] border border-white/[0.08] bg-[#0e1220]/50 p-6 shadow-xl"
          />
        </div>

        {!data.startDate && (
          <div className="flex justify-center gap-3 pt-4">
            <button
              className="text-[13px] font-medium px-5 py-2.5 rounded-full border border-white/[0.08] bg-[#0e1220]/50 hover:bg-white/5 text-white/70 hover:text-white transition-all shadow-sm"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + ((6 - d.getDay()) % 7 || 7)); // Next Saturday
                onChange({ startDate: d });
              }}
            >
              Ce week-end
            </button>
            <button
              className="text-[13px] font-medium px-5 py-2.5 rounded-full border border-white/[0.08] bg-[#0e1220]/50 hover:bg-white/5 text-white/70 hover:text-white transition-all shadow-sm"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 14);
                onChange({ startDate: d });
              }}
            >
              Dans 2 semaines
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
