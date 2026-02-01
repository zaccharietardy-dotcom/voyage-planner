'use client';

import { useRef, useCallback, useState } from 'react';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
import { isLockedItem } from '@/lib/services/itineraryCalculator';
import { cn } from '@/lib/utils';
import { Lock, GripHorizontal } from 'lucide-react';

interface CalendarActivityBlockProps {
  item: TripItem;
  isEditable: boolean;
  rowStart: number;
  rowSpan: number;
  column?: number;
  totalColumns?: number;
  slotHeight: number;
  onUpdate?: (item: TripItem) => void;
  onClick?: () => void;
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

export function CalendarActivityBlock({
  item,
  isEditable,
  rowStart,
  rowSpan,
  column = 0,
  totalColumns = 1,
  slotHeight,
  onUpdate,
  onClick,
}: CalendarActivityBlockProps) {
  const locked = isLockedItem(item);
  const canResize = isEditable && !locked;
  const color = TRIP_ITEM_COLORS[item.type] || '#6B7280';

  const [resizing, setResizing] = useState<'top' | 'bottom' | null>(null);
  const startYRef = useRef(0);
  const startRowRef = useRef(rowStart);
  const startSpanRef = useRef(rowSpan);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.MouseEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();
      setResizing(edge);
      startYRef.current = e.clientY;
      startRowRef.current = rowStart;
      startSpanRef.current = rowSpan;

      const handleMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startYRef.current;
        const dSlots = Math.round(dy / slotHeight);

        if (edge === 'bottom') {
          const newSpan = Math.max(1, startSpanRef.current + dSlots);
          const newDuration = newSpan * 15;
          const newEndTime = formatTime(parseMinutes(item.startTime) + newDuration);
          if (newDuration !== item.duration) {
            onUpdate?.({ ...item, duration: newDuration, endTime: newEndTime });
          }
        } else {
          // top resize: change startTime, keep endTime
          const newRowStart = Math.max(1, startRowRef.current + dSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(item.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...item,
              startTime: formatTime(newStartMinutes),
              duration: newDuration,
            });
          }
        }
      };

      const handleMouseUp = () => {
        setResizing(null);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [canResize, rowStart, rowSpan, slotHeight, item, onUpdate]
  );

  // Touch resize support
  const handleTouchResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.TouchEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();
      setResizing(edge);
      const touch = e.touches[0];
      startYRef.current = touch.clientY;
      startRowRef.current = rowStart;
      startSpanRef.current = rowSpan;

      const handleTouchMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        const dy = t.clientY - startYRef.current;
        const dSlots = Math.round(dy / slotHeight);

        if (edge === 'bottom') {
          const newSpan = Math.max(1, startSpanRef.current + dSlots);
          const newDuration = newSpan * 15;
          const newEndTime = formatTime(parseMinutes(item.startTime) + newDuration);
          if (newDuration !== item.duration) {
            onUpdate?.({ ...item, duration: newDuration, endTime: newEndTime });
          }
        } else {
          const newRowStart = Math.max(1, startRowRef.current + dSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(item.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...item,
              startTime: formatTime(newStartMinutes),
              duration: newDuration,
            });
          }
        }
      };

      const handleTouchEnd = () => {
        setResizing(null);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    },
    [canResize, rowStart, rowSpan, slotHeight, item, onUpdate]
  );

  const widthPercent = totalColumns > 1 ? `${100 / totalColumns}%` : '100%';
  const leftPercent = totalColumns > 1 ? `${(column / totalColumns) * 100}%` : '0%';

  const heightPx = rowSpan * slotHeight;
  const showDuration = heightPx >= 40;
  const showTitle = heightPx >= 24;

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute rounded-md border overflow-hidden transition-shadow select-none',
        canResize && 'cursor-pointer hover:shadow-md',
        locked && 'border-dashed opacity-80',
        resizing && 'shadow-lg ring-2 ring-primary z-50'
      )}
      style={{
        gridRow: `${rowStart} / span ${rowSpan}`,
        top: (rowStart - 1) * slotHeight,
        height: heightPx,
        left: `calc(${leftPercent} + 2px)`,
        width: `calc(${widthPercent} - 4px)`,
        backgroundColor: `${color}18`,
        borderColor: `${color}60`,
      }}
      onClick={(e) => {
        if (!resizing) {
          e.stopPropagation();
          onClick?.();
        }
      }}
    >
      {/* Color stripe left */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: color }}
      />

      {/* Content */}
      <div className="pl-2.5 pr-1 py-0.5 h-full flex flex-col justify-center overflow-hidden">
        {showTitle && (
          <div className="flex items-center gap-1">
            {locked && <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
            <span
              className="text-xs font-medium truncate"
              style={{ color }}
            >
              {item.title}
            </span>
          </div>
        )}
        {showDuration && (
          <span className="text-[10px] text-muted-foreground truncate">
            {item.startTime} – {item.endTime}
          </span>
        )}
      </div>

      {/* Resize handles */}
      {canResize && (
        <>
          <div
            className="absolute top-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
            onMouseDown={(e) => handleResizeStart('top', e)}
            onTouchStart={(e) => handleTouchResizeStart('top', e)}
          >
            <GripHorizontal className="h-2.5 w-2.5 text-muted-foreground/50" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
            onMouseDown={(e) => handleResizeStart('bottom', e)}
            onTouchStart={(e) => handleTouchResizeStart('bottom', e)}
          >
            <GripHorizontal className="h-2.5 w-2.5 text-muted-foreground/50" />
          </div>
        </>
      )}
    </div>
  );
}
