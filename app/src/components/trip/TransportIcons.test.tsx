import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityCard } from './ActivityCard';
import { MobileDayList } from './MobileDayList';
import type { TripDay, TripItem } from '../../lib/types';

function makeTransportItem(overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: 'transport-1',
    dayNumber: 1,
    startTime: '10:00',
    endTime: '11:00',
    type: 'transport',
    title: 'Trajet',
    description: 'Trajet test',
    locationName: 'Milan',
    latitude: 45.46,
    longitude: 9.19,
    orderIndex: 0,
    estimatedCost: 0,
    duration: 60,
    dataReliability: 'verified',
    ...overrides,
  };
}

function makeDay(item: TripItem): TripDay {
  return {
    dayNumber: 1,
    date: new Date('2026-02-18T00:00:00.000Z'),
    items: [item],
    isDayTrip: false,
  };
}

describe('Transport mode icons', () => {
  it('ActivityCard renders train icon for train transport item', () => {
    const item = makeTransportItem({ transportMode: 'train', title: 'Train vers Milan' });
    const { getByTestId } = render(<ActivityCard item={item} />);
    expect(getByTestId('transport-icon-train')).toBeInTheDocument();
  });

  it('ActivityCard renders bus icon for bus transport item', () => {
    const item = makeTransportItem({ transportMode: 'bus', title: 'Bus vers Milan' });
    const { getByTestId } = render(<ActivityCard item={item} />);
    expect(getByTestId('transport-icon-bus')).toBeInTheDocument();
  });

  it('MobileDayList renders train icon for train transport item', () => {
    const day = makeDay(makeTransportItem({ transportMode: 'train', title: 'Train vers Milan' }));
    const { getByTestId } = render(<MobileDayList day={day} />);
    expect(getByTestId('transport-icon-train')).toBeInTheDocument();
  });

  it('MobileDayList renders bus icon for bus transport item', () => {
    const day = makeDay(makeTransportItem({ transportMode: 'bus', title: 'Bus vers Milan' }));
    const { getByTestId } = render(<MobileDayList day={day} />);
    expect(getByTestId('transport-icon-bus')).toBeInTheDocument();
  });
});
