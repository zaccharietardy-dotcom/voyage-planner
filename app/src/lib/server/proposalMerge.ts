import type { ProposedChange } from '@/lib/types/collaboration';

interface MutableTripItem {
  id?: string;
  dayNumber?: number;
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
}

interface MutableTripDay {
  dayNumber?: number;
  items?: MutableTripItem[];
  [key: string]: unknown;
}

interface MutableTripData {
  days?: MutableTripDay[];
  [key: string]: unknown;
}

function toMutableTripData(tripData: unknown): MutableTripData {
  if (!tripData || typeof tripData !== 'object' || Array.isArray(tripData)) {
    return { days: [] };
  }

  return structuredClone(tripData) as MutableTripData;
}

function ensureItems(day: MutableTripDay): MutableTripItem[] {
  if (!Array.isArray(day.items)) {
    day.items = [];
  }

  return day.items;
}

function findDayIndex(days: MutableTripDay[], dayNumber: number): number {
  return days.findIndex((day) => day.dayNumber === dayNumber);
}

function applyChange(days: MutableTripDay[], change: ProposedChange): void {
  const dayIndex = findDayIndex(days, change.dayNumber);
  if (dayIndex < 0) {
    return;
  }

  const day = days[dayIndex];
  const dayItems = ensureItems(day);

  switch (change.type) {
    case 'add_activity': {
      if (!change.data.activity) {
        return;
      }

      dayItems.push({
        id: crypto.randomUUID(),
        ...change.data.activity,
        dayNumber: change.dayNumber,
      } as MutableTripItem);
      break;
    }

    case 'remove_activity': {
      if (!change.targetId) {
        return;
      }

      day.items = dayItems.filter((item) => item.id !== change.targetId);
      break;
    }

    case 'move_activity': {
      const fromDay = change.data.fromDay;
      const toDay = change.data.toDay;

      if (typeof fromDay !== 'number' || typeof toDay !== 'number') {
        return;
      }

      const fromDayIndex = findDayIndex(days, fromDay);
      const toDayIndex = findDayIndex(days, toDay);

      if (fromDayIndex < 0 || toDayIndex < 0) {
        return;
      }

      const sourceItems = ensureItems(days[fromDayIndex]);
      const destinationItems = ensureItems(days[toDayIndex]);

      const fromIndex = Math.max(0, Math.min(change.data.fromIndex ?? 0, sourceItems.length - 1));
      const [movedItem] = sourceItems.splice(fromIndex, 1);

      if (!movedItem) {
        return;
      }

      movedItem.dayNumber = toDay;

      const targetIndex = Math.max(0, Math.min(change.data.toIndex ?? destinationItems.length, destinationItems.length));
      destinationItems.splice(targetIndex, 0, movedItem);
      break;
    }

    case 'modify_activity': {
      if (!change.targetId || !change.data.activity) {
        return;
      }

      const itemIndex = dayItems.findIndex((item) => item.id === change.targetId);
      if (itemIndex < 0) {
        return;
      }

      dayItems[itemIndex] = {
        ...dayItems[itemIndex],
        ...change.data.activity,
      };
      break;
    }

    case 'change_time': {
      if (!change.targetId) {
        return;
      }

      const itemIndex = dayItems.findIndex((item) => item.id === change.targetId);
      if (itemIndex < 0) {
        return;
      }

      if (change.data.newStartTime) {
        dayItems[itemIndex].startTime = change.data.newStartTime;
      }

      if (change.data.newEndTime) {
        dayItems[itemIndex].endTime = change.data.newEndTime;
      }
      break;
    }

    default:
      break;
  }
}

export function mergeProposalChangesIntoTripData(
  tripData: unknown,
  changes: ProposedChange[]
): MutableTripData {
  const mutableTripData = toMutableTripData(tripData);
  const days = Array.isArray(mutableTripData.days) ? mutableTripData.days : [];

  for (const change of changes) {
    applyChange(days, change);
  }

  mutableTripData.days = days;
  return mutableTripData;
}
