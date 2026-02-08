'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
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
  dayColumnWidth?: number;
  onUpdate?: (item: TripItem) => void;
  onMove?: (item: TripItem, deltaSlots: number, deltaDays: number) => void;
  onClick?: () => void;
  onInteraction?: () => void;
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

const MOVE_ACTIVATION_DISTANCE = 5;

export function CalendarActivityBlock({
  item,
  isEditable,
  rowStart,
  rowSpan,
  column = 0,
  totalColumns = 1,
  slotHeight,
  dayColumnWidth = 0,
  onUpdate,
  onMove,
  onClick,
  onInteraction,
}: CalendarActivityBlockProps) {
  const locked = isLockedItem(item);
  const canResize = isEditable && !locked;
  const canMove = isEditable && !locked;
  const color = TRIP_ITEM_COLORS[item.type] || '#6B7280';

  // Dark mode detection for better contrast
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // ── Resize state ─────────────────────────────────────────────────
  const [dragState, setDragState] = useState<{
    edge: 'top' | 'bottom';
    deltaSlots: number;
  } | null>(null);

  // ── Move state ───────────────────────────────────────────────────
  const [moveState, setMoveState] = useState<{
    deltaSlots: number;
    deltaDays: number;
    isDragging: boolean;
  } | null>(null);

  // Shared refs
  const dragItemRef = useRef(item);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const slotHeightRef = useRef(slotHeight);
  const rowStartRef = useRef(rowStart);
  const rowSpanRef = useRef(rowSpan);
  const dayColumnWidthRef = useRef(dayColumnWidth);
  const didDragRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    dayColumnWidthRef.current = dayColumnWidth;
  }, [dayColumnWidth]);

  // ── Resize handlers (unchanged logic) ────────────────────────────

  const handleResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.MouseEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();

      didDragRef.current = true;
      dragItemRef.current = item;
      startYRef.current = e.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;
      setDragState({ edge, deltaSlots: 0 });

      const handleMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        setDragState({ edge, deltaSlots });
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        const dy = ev.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        const snap = dragItemRef.current;

        if (edge === 'bottom') {
          const newSpan = Math.max(1, rowSpanRef.current + deltaSlots);
          const newDuration = newSpan * 15;
          const startMin = parseMinutes(snap.startTime);
          const newEndTime = formatTime(startMin + newDuration);
          onUpdate?.({ ...snap, duration: newDuration, endTime: newEndTime });
        } else {
          const newRowStart = Math.max(1, rowStartRef.current + deltaSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(snap.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...snap,
              startTime: formatTime(newStartMinutes),
              endTime: snap.endTime,
              duration: newDuration,
            });
          }
        }

        setDragState(null);
        onInteraction?.();
        requestAnimationFrame(() => { didDragRef.current = false; });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [canResize, item, slotHeight, rowStart, rowSpan, onUpdate, onInteraction]
  );

  const handleTouchResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.TouchEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();

      const touch = e.touches[0];
      didDragRef.current = true;
      dragItemRef.current = item;
      startYRef.current = touch.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;
      setDragState({ edge, deltaSlots: 0 });

      const handleTouchMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        const dy = t.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        setDragState({ edge, deltaSlots });
      };

      const handleTouchEnd = (ev: TouchEvent) => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);

        const t = ev.changedTouches[0];
        const dy = t.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        const snap = dragItemRef.current;

        if (edge === 'bottom') {
          const newSpan = Math.max(1, rowSpanRef.current + deltaSlots);
          const newDuration = newSpan * 15;
          const startMin = parseMinutes(snap.startTime);
          const newEndTime = formatTime(startMin + newDuration);
          onUpdate?.({ ...snap, duration: newDuration, endTime: newEndTime });
        } else {
          const newRowStart = Math.max(1, rowStartRef.current + deltaSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(snap.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...snap,
              startTime: formatTime(newStartMinutes),
              endTime: snap.endTime,
              duration: newDuration,
            });
          }
        }

        setDragState(null);
        onInteraction?.();
        requestAnimationFrame(() => { didDragRef.current = false; });
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    },
    [canResize, item, slotHeight, rowStart, rowSpan, onUpdate, onInteraction]
  );

  // ── Move handlers (drag-to-move block) ───────────────────────────

  const handleMoveStart = useCallback(
    (e: React.MouseEvent) => {
      if (!canMove) return;
      // Don't interfere with resize handles
      if ((e.target as HTMLElement).closest('.resize-handle')) return;
      e.preventDefault();
      e.stopPropagation();

      dragItemRef.current = item;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;
      setMoveState({ deltaSlots: 0, deltaDays: 0, isDragging: false });

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startXRef.current;
        const dy = ev.clientY - startYRef.current;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > MOVE_ACTIVATION_DISTANCE) {
          didDragRef.current = true;
          const deltaSlots = Math.round(dy / slotHeightRef.current);
          const deltaDays = dayColumnWidthRef.current > 0
            ? Math.round(dx / dayColumnWidthRef.current)
            : 0;
          setMoveState({ deltaSlots, deltaDays, isDragging: true });
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        const dx = ev.clientX - startXRef.current;
        const dy = ev.clientY - startYRef.current;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > MOVE_ACTIVATION_DISTANCE) {
          const deltaSlots = Math.round(dy / slotHeightRef.current);
          const deltaDays = dayColumnWidthRef.current > 0
            ? Math.round(dx / dayColumnWidthRef.current)
            : 0;

          if (deltaSlots !== 0 || deltaDays !== 0) {
            onMove?.(dragItemRef.current, deltaSlots, deltaDays);
          }
        }

        setMoveState(null);
        onInteraction?.();
        requestAnimationFrame(() => { didDragRef.current = false; });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [canMove, item, slotHeight, rowStart, rowSpan, onMove, onInteraction]
  );

  const handleTouchMoveStart = useCallback(
    (e: React.TouchEvent) => {
      if (!canMove) return;
      if ((e.target as HTMLElement).closest('.resize-handle')) return;

      const touch = e.touches[0];
      dragItemRef.current = item;
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;

      // Use a long-press timer for touch — 200ms hold to activate move
      let activated = false;
      const longPressTimer = setTimeout(() => {
        activated = true;
        setMoveState({ deltaSlots: 0, deltaDays: 0, isDragging: false });
      }, 200);

      const handleTouchMove = (ev: TouchEvent) => {
        if (!activated) {
          // Check if movement is too large before activation — cancel
          const t = ev.touches[0];
          const dist = Math.sqrt(
            (t.clientX - startXRef.current) ** 2 +
            (t.clientY - startYRef.current) ** 2
          );
          if (dist > 10) {
            clearTimeout(longPressTimer);
            cleanup();
            return;
          }
          return;
        }

        ev.preventDefault();
        const t = ev.touches[0];
        const dx = t.clientX - startXRef.current;
        const dy = t.clientY - startYRef.current;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > MOVE_ACTIVATION_DISTANCE) {
          didDragRef.current = true;
          const deltaSlots = Math.round(dy / slotHeightRef.current);
          const deltaDays = dayColumnWidthRef.current > 0
            ? Math.round(dx / dayColumnWidthRef.current)
            : 0;
          setMoveState({ deltaSlots, deltaDays, isDragging: true });
        }
      };

      const cleanup = () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };

      const handleTouchEnd = (ev: TouchEvent) => {
        clearTimeout(longPressTimer);
        cleanup();

        if (!activated) {
          setMoveState(null);
          return;
        }

        const t = ev.changedTouches[0];
        const dx = t.clientX - startXRef.current;
        const dy = t.clientY - startYRef.current;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > MOVE_ACTIVATION_DISTANCE) {
          const deltaSlots = Math.round(dy / slotHeightRef.current);
          const deltaDays = dayColumnWidthRef.current > 0
            ? Math.round(dx / dayColumnWidthRef.current)
            : 0;

          if (deltaSlots !== 0 || deltaDays !== 0) {
            onMove?.(dragItemRef.current, deltaSlots, deltaDays);
          }
        }

        setMoveState(null);
        onInteraction?.();
        requestAnimationFrame(() => { didDragRef.current = false; });
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    },
    [canMove, item, slotHeight, rowStart, rowSpan, onMove, onInteraction]
  );

  // ── Visual position computation ──────────────────────────────────

  // Resize visuals
  const resizeRowStart = dragState?.edge === 'top'
    ? Math.max(1, rowStart + dragState.deltaSlots)
    : rowStart;
  const resizeRowSpan = dragState?.edge === 'bottom'
    ? Math.max(1, rowSpan + dragState.deltaSlots)
    : dragState?.edge === 'top'
      ? Math.max(1, rowSpan - dragState.deltaSlots)
      : rowSpan;

  // Move visuals — during move, shift the entire block
  const moveOffsetY = moveState?.isDragging ? moveState.deltaSlots * slotHeight : 0;
  const moveOffsetX = moveState?.isDragging ? moveState.deltaDays * dayColumnWidth : 0;

  const visualRowStart = dragState ? resizeRowStart : rowStart;
  const visualRowSpan = dragState ? resizeRowSpan : rowSpan;

  const widthPercent = totalColumns > 1 ? `${100 / totalColumns}%` : '100%';
  const leftPercent = totalColumns > 1 ? `${(column / totalColumns) * 100}%` : '0%';

  const visualTop = (visualRowStart - 1) * slotHeight;
  const visualHeight = visualRowSpan * slotHeight;
  const showDuration = visualHeight >= 40;
  const showTitle = visualHeight >= 24;

  const isActive = !!dragState || (moveState?.isDragging ?? false);

  // Compute displayed times during drag/move
  const displayStartTime = dragState?.edge === 'top'
    ? formatTime(Math.max(0, (visualRowStart - 1) * 15))
    : moveState?.isDragging
      ? formatTime(Math.max(0, (rowStart - 1 + moveState.deltaSlots) * 15))
      : item.startTime;
  const displayEndTime = dragState?.edge === 'bottom'
    ? formatTime((rowStart - 1) * 15 + visualRowSpan * 15)
    : moveState?.isDragging
      ? formatTime(Math.max(0, (rowStart - 1 + moveState.deltaSlots + rowSpan) * 15))
      : item.endTime;

  return (
    <div
      className={cn(
        'absolute rounded-md border overflow-hidden select-none',
        canMove && 'cursor-grab',
        canMove && isActive && 'cursor-grabbing',
        locked && 'border-dashed opacity-80',
        isActive && 'shadow-lg ring-2 ring-primary z-50',
        isActive && 'transition-none'
      )}
      style={{
        top: visualTop,
        height: visualHeight,
        left: `calc(${leftPercent} + 2px)`,
        width: `calc(${widthPercent} - 4px)`,
        backgroundColor: `${color}${isDark ? '28' : '18'}`,
        borderColor: `${color}${isDark ? '80' : '60'}`,
        transform: moveState?.isDragging
          ? `translate(${moveOffsetX}px, ${moveOffsetY}px)`
          : undefined,
        zIndex: isActive ? 50 : undefined,
      }}
      onMouseDown={handleMoveStart}
      onTouchStart={handleTouchMoveStart}
      onClick={(e) => {
        e.stopPropagation();
        onInteraction?.();
        if (!didDragRef.current) {
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
            {displayStartTime} – {displayEndTime}
          </span>
        )}
      </div>

      {/* Resize handles */}
      {canResize && (
        <>
          <div
            className="resize-handle absolute top-0 left-0 right-0 h-2 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
            onMouseDown={(e) => handleResizeStart('top', e)}
            onTouchStart={(e) => handleTouchResizeStart('top', e)}
          >
            <GripHorizontal className="h-2.5 w-2.5 text-muted-foreground/50" />
          </div>
          <div
            className="resize-handle absolute bottom-0 left-0 right-0 h-2 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
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
