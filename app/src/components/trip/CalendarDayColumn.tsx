'use client';

import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { TripDay, TripItem } from '@/lib/types';
import { CalendarActivityBlock } from './CalendarActivityBlock';
import { format, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';

// 24h = 96 slots of 15min (00:00 → 23:45)
const TOTAL_SLOTS = 96;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CalendarDayColumnProps {
  day: TripDay;
  slotHeight: number;
  isEditable: boolean;
  showHeader?: boolean;
  dayColumnWidth?: number;
  onUpdateItem?: (item: TripItem) => void;
  onMoveItem?: (item: TripItem, deltaSlots: number, deltaDays: number) => void;
  onClickItem?: (item: TripItem) => void;
  onClickSlot?: (dayNumber: number, time: string) => void;
  onCreateSlotRange?: (dayNumber: number, startTime: string, endTime: string) => void;
}

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

interface LayoutItem {
  item: TripItem;
  rowStart: number;
  rowSpan: number;
  column: number;
  totalColumns: number;
}

function layoutItems(items: TripItem[]): LayoutItem[] {
  if (items.length === 0) return [];

  // Sort by startTime
  const sorted = [...items].sort(
    (a, b) => parseMinutes(a.startTime) - parseMinutes(b.startTime)
  );

  // Calculate row positions
  const positioned = sorted.map((item) => {
    const startMin = parseMinutes(item.startTime);
    const endMin = item.endTime ? parseMinutes(item.endTime) : startMin + (item.duration || 60);
    // Calculer la durée depuis startTime/endTime pour éviter les incohérences
    const dur = endMin > startMin ? endMin - startMin : (item.duration || 60);
    const rowStart = Math.floor(startMin / 15) + 1;
    const rowSpan = Math.max(1, Math.ceil(dur / 15));
    return { item, rowStart, rowSpan, startMin, endMin };
  });

  // Detect overlapping groups
  const groups: number[][] = [];
  const visited = new Set<number>();

  for (let i = 0; i < positioned.length; i++) {
    if (visited.has(i)) continue;
    const group = [i];
    visited.add(i);

    for (let j = i + 1; j < positioned.length; j++) {
      if (visited.has(j)) continue;
      // Check if j overlaps with any item already in group
      const overlaps = group.some((gi) => {
        const a = positioned[gi];
        const b = positioned[j];
        return a.startMin < b.endMin && b.startMin < a.endMin;
      });
      if (overlaps) {
        group.push(j);
        visited.add(j);
      }
    }

    groups.push(group);
  }

  // Assign columns within groups
  const result: LayoutItem[] = [];
  for (const group of groups) {
    const totalColumns = group.length;
    group.forEach((idx, col) => {
      const p = positioned[idx];
      result.push({
        item: p.item,
        rowStart: p.rowStart,
        rowSpan: p.rowSpan,
        column: col,
        totalColumns,
      });
    });
  }

  return result;
}

// ── Current time indicator (red line) ────────────────────────────────

function CurrentTimeIndicator({ slotHeight, dayDate }: { slotHeight: number; dayDate: Date }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const isToday = dayDate && isSameDay(new Date(dayDate), now);
  if (!isToday) return null;

  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = (minutes / 15) * slotHeight;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top }}
    >
      <div className="flex items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1 shrink-0" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function CalendarDayColumn({
  day,
  slotHeight,
  isEditable,
  showHeader = true,
  dayColumnWidth = 0,
  onUpdateItem,
  onMoveItem,
  onClickItem,
  onClickSlot,
  onCreateSlotRange,
}: CalendarDayColumnProps) {
  const layoutItems_ = useMemo(() => layoutItems(day.items), [day.items]);
  const lastInteractionRef = useRef(0);

  const totalHeight = TOTAL_SLOTS * slotHeight;

  // ── Drag-to-create state ─────────────────────────────────────────
  const [createDrag, setCreateDrag] = useState<{
    startSlot: number;
    currentSlot: number;
  } | null>(null);
  const createDragRef = useRef(false);

  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isEditable) return;
      // Ignore clicks within 300ms of a block interaction
      if (Date.now() - lastInteractionRef.current < 300) return;
      // Only respond to direct clicks on the grid (not on blocks)
      if ((e.target as HTMLElement).closest('.calendar-block')) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const slot = Math.floor(y / slotHeight);

      setCreateDrag({ startSlot: slot, currentSlot: slot });
      createDragRef.current = false;

      const handleMouseMove = (ev: MouseEvent) => {
        const currentY = ev.clientY - rect.top;
        const currentSlot = Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(currentY / slotHeight)));
        createDragRef.current = true;
        setCreateDrag((prev) => prev ? { ...prev, currentSlot } : null);
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        const currentY = ev.clientY - rect.top;
        const endSlot = Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(currentY / slotHeight)));

        setCreateDrag(null);

        if (createDragRef.current && Math.abs(endSlot - slot) >= 1) {
          // Drag-to-create: range selection
          const minSlot = Math.min(slot, endSlot);
          const maxSlot = Math.max(slot, endSlot) + 1;
          const startTime = formatTime(minSlot * 15);
          const endTime = formatTime(maxSlot * 15);
          onCreateSlotRange?.(day.dayNumber, startTime, endTime);
        } else {
          // Simple click — existing behavior
          const time = formatTime(slot * 15);
          onClickSlot?.(day.dayNumber, time);
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [isEditable, slotHeight, day.dayNumber, onClickSlot, onCreateSlotRange]
  );

  // Touch drag-to-create
  const handleGridTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!isEditable) return;
      if (Date.now() - lastInteractionRef.current < 300) return;
      if ((e.target as HTMLElement).closest('.calendar-block')) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const touch = e.touches[0];
      const y = touch.clientY - rect.top;
      const slot = Math.floor(y / slotHeight);

      // Long press to activate drag-to-create on touch
      let activated = false;
      const timer = setTimeout(() => {
        activated = true;
        setCreateDrag({ startSlot: slot, currentSlot: slot });
      }, 300);

      const handleTouchMove = (ev: TouchEvent) => {
        if (!activated) {
          const t = ev.touches[0];
          const dist = Math.abs(t.clientY - touch.clientY);
          if (dist > 10) {
            clearTimeout(timer);
            cleanup();
          }
          return;
        }
        ev.preventDefault();
        const t = ev.touches[0];
        const currentY = t.clientY - rect.top;
        const currentSlot = Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(currentY / slotHeight)));
        createDragRef.current = true;
        setCreateDrag((prev) => prev ? { ...prev, currentSlot } : null);
      };

      const cleanup = () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };

      const handleTouchEnd = () => {
        clearTimeout(timer);
        cleanup();

        if (!activated) {
          // Simple tap
          const time = formatTime(slot * 15);
          onClickSlot?.(day.dayNumber, time);
          setCreateDrag(null);
          return;
        }

        setCreateDrag((current) => {
          if (current && Math.abs(current.currentSlot - current.startSlot) >= 1) {
            const minSlot = Math.min(current.startSlot, current.currentSlot);
            const maxSlot = Math.max(current.startSlot, current.currentSlot) + 1;
            const startTime = formatTime(minSlot * 15);
            const endTime = formatTime(maxSlot * 15);
            onCreateSlotRange?.(day.dayNumber, startTime, endTime);
          } else {
            const time = formatTime(slot * 15);
            onClickSlot?.(day.dayNumber, time);
          }
          return null;
        });
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    },
    [isEditable, slotHeight, day.dayNumber, onClickSlot, onCreateSlotRange]
  );

  // Compute drag-to-create highlight
  const createHighlight = createDrag ? (() => {
    const minSlot = Math.min(createDrag.startSlot, createDrag.currentSlot);
    const maxSlot = Math.max(createDrag.startSlot, createDrag.currentSlot);
    return {
      top: minSlot * slotHeight,
      height: (maxSlot - minSlot + 1) * slotHeight,
    };
  })() : null;

  return (
    <div className="flex flex-col min-w-0">
      {/* Header */}
      {showHeader && (
        <div className="sticky top-0 z-10 bg-background border-b px-2 py-1.5 text-center">
          <div className="font-medium text-sm">Jour {day.dayNumber}</div>
          {day.date && (
            <div className="text-xs text-muted-foreground">
              {format(new Date(day.date), 'EEE d MMM', { locale: fr })}
            </div>
          )}
          {day.theme && (
            <div className="text-[10px] text-muted-foreground truncate">{day.theme}</div>
          )}
        </div>
      )}

      {/* Grid */}
      <div
        className="relative"
        style={{ height: totalHeight }}
        onMouseDown={isEditable ? handleGridMouseDown : undefined}
        onTouchStart={isEditable ? handleGridTouchStart : undefined}
      >
        {/* Hour lines */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-t border-border/40"
            style={{ top: hour * 4 * slotHeight }}
          />
        ))}

        {/* Half-hour lines (lighter) */}
        {HOURS.map((hour) => (
          <div
            key={`half-${hour}`}
            className="absolute left-0 right-0 border-t border-border/20"
            style={{ top: (hour * 4 + 2) * slotHeight }}
          />
        ))}

        {/* Current time indicator */}
        {day.date && (
          <CurrentTimeIndicator slotHeight={slotHeight} dayDate={new Date(day.date)} />
        )}

        {/* Drag-to-create highlight */}
        {createHighlight && (
          <div
            className="absolute left-1 right-1 bg-primary/15 border-2 border-primary/30 rounded-md z-10 pointer-events-none"
            style={{
              top: createHighlight.top,
              height: createHighlight.height,
            }}
          >
            <div className="px-2 py-0.5 text-[10px] text-primary font-medium">
              {formatTime(Math.min(createDrag!.startSlot, createDrag!.currentSlot) * 15)}
              {' – '}
              {formatTime((Math.max(createDrag!.startSlot, createDrag!.currentSlot) + 1) * 15)}
            </div>
          </div>
        )}

        {/* Activity blocks */}
        {layoutItems_.map((li) => (
          <CalendarActivityBlock
            key={li.item.id}
            item={li.item}
            isEditable={isEditable}
            rowStart={li.rowStart}
            rowSpan={li.rowSpan}
            column={li.column}
            totalColumns={li.totalColumns}
            slotHeight={slotHeight}
            dayColumnWidth={dayColumnWidth}
            onUpdate={onUpdateItem}
            onMove={onMoveItem}
            onClick={() => onClickItem?.(li.item)}
            onInteraction={() => { lastInteractionRef.current = Date.now(); }}
          />
        ))}
      </div>
    </div>
  );
}

// Time gutter component (shared, rendered once on the left)
export function TimeGutter({ slotHeight }: { slotHeight: number }) {
  return (
    <div className="flex flex-col flex-shrink-0 w-12">
      {/* Header spacer */}
      <div className="sticky top-0 z-10 bg-background border-b h-[52px]" />

      {/* Hours */}
      <div className="relative" style={{ height: TOTAL_SLOTS * slotHeight }}>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
            style={{ top: hour * 4 * slotHeight }}
          >
            {hour.toString().padStart(2, '0')}:00
          </div>
        ))}
      </div>
    </div>
  );
}
