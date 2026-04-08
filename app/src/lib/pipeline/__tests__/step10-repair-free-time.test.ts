import type { TripDay } from '../../types/trip';
import { fillLargeGapsWithFreeTime } from '../step10-repair';

function makeBaseDay(): TripDay {
  return {
    dayNumber: 1,
    date: new Date('2026-04-21T00:00:00.000Z'),
    theme: 'Test',
    dayNarrative: 'Test',
    items: [
      {
        id: 'a1',
        dayNumber: 1,
        type: 'activity',
        title: 'Morning Activity',
        startTime: '09:00',
        endTime: '10:00',
        duration: 60,
        latitude: 48.8566,
        longitude: 2.3522,
        orderIndex: 0,
      } as any,
      {
        id: 'a2',
        dayNumber: 1,
        type: 'activity',
        title: 'Late Activity',
        startTime: '17:00',
        endTime: '18:00',
        duration: 60,
        latitude: 48.858,
        longitude: 2.35,
        orderIndex: 1,
      } as any,
    ],
  };
}

describe('step10 repair free-time fallback', () => {
  it('caps fallback free_time duration to 120 minutes', () => {
    const day = makeBaseDay();
    day.items.push({
      id: 't1',
      dayNumber: 1,
      type: 'transport',
      title: 'Transit',
      startTime: '10:20',
      endTime: '10:50',
      duration: 30,
      latitude: 48.857,
      longitude: 2.351,
      orderIndex: 2,
    } as any);
    const days = [day];
    fillLargeGapsWithFreeTime(days, [], '2026-04-21', [], 'spread');

    const freeBlocks = days[0].items.filter((item) => item.type === 'free_time');
    expect(freeBlocks.length).toBeGreaterThan(0);
    expect((freeBlocks[0].duration || 0)).toBeLessThanOrEqual(120);
  });

  it('inserts at most one fallback free_time block per day', () => {
    const day = makeBaseDay();
    day.items.push({
      id: 'a3',
      dayNumber: 1,
      type: 'activity',
      title: 'Night Activity',
      startTime: '21:00',
      endTime: '22:00',
      duration: 60,
      latitude: 48.86,
      longitude: 2.36,
      orderIndex: 2,
    } as any);

    const days = [day];
    fillLargeGapsWithFreeTime(days, [], '2026-04-21', [], 'spread');

    const freeBlocks = days[0].items.filter((item) => item.type === 'free_time');
    expect(freeBlocks.length).toBeLessThanOrEqual(1);
  });

  it('does not inject free_time on under-populated days', () => {
    const days = [makeBaseDay()];
    fillLargeGapsWithFreeTime(days, [], '2026-04-21', [], 'spread');

    const freeBlocks = days[0].items.filter((item) => item.type === 'free_time');
    expect(freeBlocks.length).toBe(0);
  });
});
