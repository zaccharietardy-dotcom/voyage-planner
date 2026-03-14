'use client';

import { useMemo, useState } from 'react';
import { generateFlightPriceMatrix, type FlightPriceDay } from '@/lib/services/flightPriceCalendar';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plane } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FlightDatePickerProps {
  origin: string;
  destination: string;
  selectedDate: Date;
  basePrice?: number;
  onDateSelect?: (date: string) => void;
  className?: string;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const TIER_COLORS: Record<string, string> = {
  cheap: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  expensive: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

export function FlightDatePicker({
  origin,
  destination,
  selectedDate,
  basePrice = 150,
  onDateSelect,
  className,
}: FlightDatePickerProps) {
  const [monthOffset, setMonthOffset] = useState(0);

  const viewDate = useMemo(() => {
    const d = new Date(selectedDate);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [selectedDate, monthOffset]);

  const matrix = useMemo(
    () => generateFlightPriceMatrix(origin, destination, viewDate, 6, basePrice),
    [origin, destination, viewDate, basePrice]
  );

  // Group days by month for calendar display
  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7; // Monday-based

  const monthDays: (FlightPriceDay | null)[] = [];
  // Pad start
  for (let i = 0; i < firstDayOfMonth; i++) monthDays.push(null);
  // Fill days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const priceDay = matrix.days.find(pd => pd.date === dateStr);
    monthDays.push(priceDay || { date: dateStr, price: null, tier: null });
  }

  const monthName = viewDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const selectedDateStr = selectedDate.toISOString().split('T')[0];

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plane className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{origin} &rarr; {destination}</span>
        </div>
        {matrix.cheapestPrice && (
          <span className="text-xs text-green-600 font-medium">
            Meilleur prix: {matrix.cheapestPrice}&euro;
          </span>
        )}
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonthOffset(o => o - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium capitalize">{monthName}</span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonthOffset(o => o + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Weekday headers */}
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
        ))}

        {/* Day cells */}
        {monthDays.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} />;
          const dayNum = parseInt(day.date.split('-')[2]);
          const isSelected = day.date === selectedDateStr;
          const isCheapest = day.date === matrix.cheapestDate;

          return (
            <button
              key={day.date}
              onClick={() => onDateSelect?.(day.date)}
              className={cn(
                'rounded-lg p-1 text-center transition-all hover:ring-2 hover:ring-primary/40',
                day.tier ? TIER_COLORS[day.tier] : 'bg-muted/30 text-muted-foreground',
                isSelected && 'ring-2 ring-primary font-bold',
                isCheapest && 'ring-2 ring-green-500',
              )}
            >
              <div className="text-[11px] font-medium">{dayNum}</div>
              {day.price !== null && (
                <div className="text-[9px] font-medium">{day.price}&euro;</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 text-[10px]">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/40" /> Bon prix</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 dark:bg-amber-900/30" /> Moyen</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30" /> Cher</span>
      </div>
    </div>
  );
}
