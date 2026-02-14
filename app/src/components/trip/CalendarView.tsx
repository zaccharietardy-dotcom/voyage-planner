'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { TripDay, TripItem } from '@/lib/types';
import { CalendarDayColumn, TimeGutter } from './CalendarDayColumn';
import { MobileDayList } from './MobileDayList';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  CalendarDays,
  List,
  Grid3X3,
  MoveHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';

function parseMinutes(time: string | undefined | null): number {
  if (!time) return 9 * 60;
  const [h, m] = time.split(':').map(Number);
  return (isNaN(h) ? 9 : h) * 60 + (isNaN(m!) ? 0 : m!);
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

interface CalendarViewProps {
  days: TripDay[];
  isEditable: boolean;
  onUpdateItem?: (item: TripItem) => void;
  onClickItem?: (item: TripItem) => void;
  onClickSlot?: (dayNumber: number, time: string) => void;
  onCreateSlotRange?: (dayNumber: number, startTime: string, endTime: string) => void;
  onMoveItemCrossDay?: (item: TripItem, fromDayNumber: number, toDayNumber: number, newStartTime: string) => void;
}

export function CalendarView({
  days,
  isEditable,
  onUpdateItem,
  onClickItem,
  onClickSlot,
  onCreateSlotRange,
  onMoveItemCrossDay,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<'day' | 'trip'>('trip');
  const [selectedDay, setSelectedDay] = useState(0);
  const [mobileSubView, setMobileSubView] = useState<'grid' | 'list'>('grid');
  const scrollRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef(1); // 1 = forward, -1 = backward
  const pillsRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);

  // Measure day column width for cross-day drag
  const [dayColumnWidth, setDayColumnWidth] = useState(0);
  const dayColumnMeasureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode !== 'trip' || !dayColumnMeasureRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDayColumnWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(dayColumnMeasureRef.current);
    return () => observer.disconnect();
  }, [viewMode, days.length]);

  // Responsive slot height + mobile detection
  const [slotHeight, setSlotHeight] = useState(16);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    setSlotHeight(mql.matches ? 16 : 20);
    setIsMobile(!mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      setSlotHeight(e.matches ? 16 : 20);
      setIsMobile(!e.matches);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Auto-scroll to ~8h on mount
  useEffect(() => {
    if (scrollRef.current && mobileSubView === 'grid') {
      const eightAM = 8 * 4 * slotHeight;
      scrollRef.current.scrollTop = eightAM - 40;
    }
  }, [slotHeight, viewMode, mobileSubView]);

  // Auto switch to day view on mobile
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    if (!mql.matches && days.length > 2) {
      setViewMode('day');
    }
  }, [days.length]);

  // Show swipe hint on first mobile use
  useEffect(() => {
    if (isMobile && viewMode === 'day') {
      const seen = localStorage.getItem('voyage-calendar-swipe-hint-seen');
      if (!seen) {
        setShowSwipeHint(true);
        const timer = setTimeout(() => {
          setShowSwipeHint(false);
          localStorage.setItem('voyage-calendar-swipe-hint-seen', 'true');
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isMobile, viewMode]);

  // Auto-scroll pills to keep active day visible
  useEffect(() => {
    if (pillsRef.current) {
      const activeEl = pillsRef.current.children[selectedDay] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [selectedDay]);

  const currentDay = days[selectedDay];

  const handlePrevDay = () => {
    directionRef.current = -1;
    setSelectedDay((d) => Math.max(0, d - 1));
  };
  const handleNextDay = () => {
    directionRef.current = 1;
    setSelectedDay((d) => Math.min(days.length - 1, d + 1));
  };

  // Swipe gesture handling for day view
  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const threshold = 50;
    if (info.offset.x < -threshold && selectedDay < days.length - 1) {
      directionRef.current = 1;
      setSelectedDay((s) => s + 1);
      dismissSwipeHint();
    } else if (info.offset.x > threshold && selectedDay > 0) {
      directionRef.current = -1;
      setSelectedDay((s) => s - 1);
      dismissSwipeHint();
    }
  };

  const dismissSwipeHint = () => {
    if (showSwipeHint) {
      setShowSwipeHint(false);
      localStorage.setItem('voyage-calendar-swipe-hint-seen', 'true');
    }
  };

  // Handle move from CalendarActivityBlock
  const handleMoveItem = useCallback(
    (item: TripItem, deltaSlots: number, deltaDays: number) => {
      const startMin = parseMinutes(item.startTime);
      const duration = item.duration || (parseMinutes(item.endTime) - startMin) || 60;
      const newStartMin = Math.max(0, Math.min(23 * 60 + 45, startMin + deltaSlots * 15));
      const newStartTime = formatTime(newStartMin);
      const newEndTime = formatTime(newStartMin + duration);

      if (deltaDays === 0) {
        // Same-day move: just update start/end times
        onUpdateItem?.({
          ...item,
          startTime: newStartTime,
          endTime: newEndTime,
        });
      } else {
        // Cross-day move
        const currentDayIndex = days.findIndex((d) => d.dayNumber === item.dayNumber);
        const targetDayIndex = currentDayIndex + deltaDays;
        if (targetDayIndex >= 0 && targetDayIndex < days.length) {
          const targetDay = days[targetDayIndex];
          onMoveItemCrossDay?.(item, item.dayNumber, targetDay.dayNumber, newStartTime);
        }
      }
    },
    [days, onUpdateItem, onMoveItemCrossDay]
  );

  // In day view, deltaDays is always 0
  const handleMoveItemDayView = useCallback(
    (item: TripItem, deltaSlots: number, _deltaDays: number) => {
      handleMoveItem(item, deltaSlots, 0);
    },
    [handleMoveItem]
  );

  // Slide animation variants for day transitions
  const daySlideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '40%' : '-40%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-40%' : '40%',
      opacity: 0,
    }),
  };

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

        {/* Day selector + sub-view toggle (day view only) */}
        {viewMode === 'day' && (
          <div className="flex items-center gap-2">
            {/* Sub-view toggle: grid / list (mobile only) */}
            {isMobile && (
              <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
                <Button
                  variant={mobileSubView === 'grid' ? 'default' : 'ghost'}
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setMobileSubView('grid')}
                >
                  <Grid3X3 className="h-3 w-3" />
                </Button>
                <Button
                  variant={mobileSubView === 'list' ? 'default' : 'ghost'}
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setMobileSubView('list')}
                >
                  <List className="h-3 w-3" />
                </Button>
              </div>
            )}

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
              {currentDay?.weatherForecast && (
                <span className="ml-1.5 text-muted-foreground font-normal" title={currentDay.weatherForecast.condition}>
                  {currentDay.weatherForecast.icon} {currentDay.weatherForecast.tempMin}°/{currentDay.weatherForecast.tempMax}°
                </span>
              )}
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

        {/* Day pills for quick jump (day view) — always shown */}
        {viewMode === 'day' && days.length > 1 && (
          <div
            ref={pillsRef}
            className="flex gap-1.5 overflow-x-auto max-w-full pb-0.5 scroll-smooth"
            style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
          >
            {days.map((day, idx) => (
              <Badge
                key={day.dayNumber}
                variant={idx === selectedDay ? 'default' : 'outline'}
                className={cn(
                  'cursor-pointer text-xs flex-shrink-0 transition-all',
                  idx === selectedDay && 'ring-2 ring-primary/30 scale-105',
                )}
                style={{ scrollSnapAlign: 'center' }}
                onClick={() => {
                  directionRef.current = idx > selectedDay ? 1 : -1;
                  setSelectedDay(idx);
                }}
              >
                J{day.dayNumber}
                {day.theme && (
                  <span className="ml-1 hidden sm:inline opacity-70">{day.theme.slice(0, 12)}</span>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Swipe hint overlay */}
      <AnimatePresence>
        {showSwipeHint && viewMode === 'day' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
          >
            <MoveHorizontal className="h-3.5 w-3.5" />
            Glissez pour changer de jour
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content area */}
      {viewMode === 'day' && isMobile && mobileSubView === 'list' ? (
        /* Mobile list view */
        <div className="flex-1 overflow-auto relative">
          <AnimatePresence mode="wait" custom={directionRef.current}>
            <motion.div
              key={selectedDay}
              custom={directionRef.current}
              variants={daySlideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.15}
              onDragEnd={handleDragEnd}
            >
              {currentDay && (
                <MobileDayList day={currentDay} onClickItem={onClickItem} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        /* Calendar grid view */
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto border rounded-lg bg-background"
        >
          <div className="flex min-h-0">
            {/* Time gutter */}
            <TimeGutter slotHeight={slotHeight} />

            {/* Day columns */}
            {viewMode === 'day' ? (
              <div className="flex-1 border-l relative overflow-hidden">
                <AnimatePresence mode="wait" custom={directionRef.current}>
                  <motion.div
                    key={selectedDay}
                    custom={directionRef.current}
                    variants={daySlideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                    drag={isMobile ? 'x' : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.15}
                    onDragEnd={isMobile ? handleDragEnd : undefined}
                    className="h-full"
                  >
                    {currentDay && (
                      <CalendarDayColumn
                        day={currentDay}
                        slotHeight={slotHeight}
                        isEditable={isEditable}
                        onUpdateItem={onUpdateItem}
                        onMoveItem={handleMoveItemDayView}
                        onClickItem={onClickItem}
                        onClickSlot={onClickSlot}
                        onCreateSlotRange={onCreateSlotRange}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            ) : (
              days.map((day, idx) => (
                <div
                  key={day.dayNumber}
                  ref={idx === 0 ? dayColumnMeasureRef : undefined}
                  className="flex-1 border-l min-w-[120px]"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <CalendarDayColumn
                    day={day}
                    slotHeight={slotHeight}
                    isEditable={isEditable}
                    dayColumnWidth={dayColumnWidth}
                    onUpdateItem={onUpdateItem}
                    onMoveItem={handleMoveItem}
                    onClickItem={onClickItem}
                    onClickSlot={onClickSlot}
                    onCreateSlotRange={onCreateSlotRange}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
