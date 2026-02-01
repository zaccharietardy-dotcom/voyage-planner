'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { TripDay, TripItem } from '@/lib/types';
import { CalendarDayColumn, TimeGutter } from './CalendarDayColumn';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalendarViewProps {
  days: TripDay[];
  isEditable: boolean;
  onUpdateItem?: (item: TripItem) => void;
  onClickItem?: (item: TripItem) => void;
  onClickSlot?: (dayNumber: number, time: string) => void;
}

export function CalendarView({
  days,
  isEditable,
  onUpdateItem,
  onClickItem,
  onClickSlot,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<'day' | 'trip'>('trip');
  const [selectedDay, setSelectedDay] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Responsive slot height
  const [slotHeight, setSlotHeight] = useState(16);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    setSlotHeight(mql.matches ? 16 : 20);
    const handler = (e: MediaQueryListEvent) => setSlotHeight(e.matches ? 16 : 20);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Auto-scroll to ~8h on mount
  useEffect(() => {
    if (scrollRef.current) {
      const eightAM = 8 * 4 * slotHeight;
      scrollRef.current.scrollTop = eightAM - 40;
    }
  }, [slotHeight, viewMode]);

  // Auto switch to day view on mobile
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    if (!mql.matches && days.length > 2) {
      setViewMode('day');
    }
  }, [days.length]);

  const currentDay = days[selectedDay];

  const handlePrevDay = () => setSelectedDay((d) => Math.max(0, d - 1));
  const handleNextDay = () => setSelectedDay((d) => Math.min(days.length - 1, d + 1));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 pb-3 flex-wrap">
        {/* View toggle */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <Button
            variant={viewMode === 'day' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setViewMode('day')}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Jour
          </Button>
          <Button
            variant={viewMode === 'trip' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setViewMode('trip')}
          >
            <Columns3 className="h-3.5 w-3.5" />
            Séjour
          </Button>
        </div>

        {/* Day selector (day view only) */}
        {viewMode === 'day' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={handlePrevDay}
              disabled={selectedDay === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[80px] text-center">
              Jour {currentDay?.dayNumber || 1}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={handleNextDay}
              disabled={selectedDay === days.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Day pills for quick jump (day view) */}
        {viewMode === 'day' && days.length > 3 && (
          <div className="flex gap-1 overflow-x-auto max-w-full">
            {days.map((day, idx) => (
              <Badge
                key={day.dayNumber}
                variant={idx === selectedDay ? 'default' : 'outline'}
                className="cursor-pointer text-xs flex-shrink-0"
                onClick={() => setSelectedDay(idx)}
              >
                J{day.dayNumber}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto border rounded-lg bg-background"
      >
        <div className="flex min-h-0">
          {/* Time gutter */}
          <TimeGutter slotHeight={slotHeight} />

          {/* Day columns */}
          {viewMode === 'day' ? (
            currentDay && (
              <div className="flex-1 border-l">
                <CalendarDayColumn
                  day={currentDay}
                  slotHeight={slotHeight}
                  isEditable={isEditable}
                  onUpdateItem={onUpdateItem}
                  onClickItem={onClickItem}
                  onClickSlot={onClickSlot}
                />
              </div>
            )
          ) : (
            days.map((day) => (
              <div key={day.dayNumber} className="flex-1 border-l min-w-[120px]">
                <CalendarDayColumn
                  day={day}
                  slotHeight={slotHeight}
                  isEditable={isEditable}
                  onUpdateItem={onUpdateItem}
                  onClickItem={onClickItem}
                  onClickSlot={onClickSlot}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
