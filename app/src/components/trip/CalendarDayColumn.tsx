'use client';

import { useMemo, useCallback } from 'react';
import { TripDay, TripItem } from '@/lib/types';
import { CalendarActivityBlock } from './CalendarActivityBlock';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// 24h = 96 slots of 15min (00:00 → 23:45)
const TOTAL_SLOTS = 96;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CalendarDayColumnProps {
  day: TripDay;
  slotHeight: number;
  isEditable: boolean;
  showHeader?: boolean;
  onUpdateItem?: (item: TripItem) => void;
  onClickItem?: (item: TripItem) => void;
  onClickSlot?: (dayNumber: number, time: string) => void;
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
    const dur = item.duration || 60;
    const rowStart = Math.floor(startMin / 15) + 1;
    const rowSpan = Math.max(1, Math.ceil(dur / 15));
    return { item, rowStart, rowSpan, startMin, endMin: startMin + dur };
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

export function CalendarDayColumn({
  day,
  slotHeight,
  isEditable,
  showHeader = true,
  onUpdateItem,
  onClickItem,
  onClickSlot,
}: CalendarDayColumnProps) {
  const layoutItems_ = useMemo(() => layoutItems(day.items), [day.items]);

  const totalHeight = TOTAL_SLOTS * slotHeight;

  const handleSlotClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onClickSlot) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const slot = Math.floor(y / slotHeight);
      const minutes = slot * 15;
      const time = formatTime(minutes);
      onClickSlot(day.dayNumber, time);
    },
    [onClickSlot, day.dayNumber, slotHeight]
  );

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
        onClick={isEditable ? handleSlotClick : undefined}
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
            onUpdate={onUpdateItem}
            onClick={() => onClickItem?.(li.item)}
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
