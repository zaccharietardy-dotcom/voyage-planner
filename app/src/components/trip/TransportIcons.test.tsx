import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityCard } from './ActivityCard';
import { MobileDayList } from './MobileDayList';
import type { TripDay, TripItem, Restaurant } from '../../lib/types';

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

function makeRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'resto-1',
    name: 'Resto Test',
    address: 'Milan',
    latitude: 45.46,
    longitude: 9.19,
    rating: 4.5,
    reviewCount: 100,
    priceLevel: 2,
    cuisineTypes: ['italien'],
    dietaryOptions: ['none'],
    openingHours: {},
    ...overrides,
  };
}

function makeRestaurantItem(overrides: Partial<TripItem> = {}): TripItem {
  return {
    id: 'restaurant-1',
    dayNumber: 1,
    startTime: '12:00',
    endTime: '13:00',
    type: 'restaurant',
    title: 'Déjeuner — Resto Test',
    description: 'Repas',
    locationName: 'Milan',
    latitude: 45.46,
    longitude: 9.19,
    orderIndex: 0,
    estimatedCost: 20,
    duration: 60,
    dataReliability: 'verified',
    restaurant: makeRestaurant(),
    ...overrides,
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

  it('ActivityCard blocks non-Google restaurant hero images', () => {
    const item = makeRestaurantItem({
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
      restaurant: makeRestaurant({ photos: ['https://serpapi.com/some-image.jpg'] }),
    });
    const { container } = render(<ActivityCard item={item} />);
    expect(container.querySelector('img[src*=\"unsplash\"]')).not.toBeInTheDocument();
    expect(container.querySelector('img[src*=\"serpapi.com\"]')).not.toBeInTheDocument();
  });

  it('ActivityCard uses Google Place Photo for restaurant hero images', () => {
    const googlePhoto = '/api/place-photo?photoReference=abc123&maxwidth=800';
    const item = makeRestaurantItem({
      imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
      restaurant: makeRestaurant({ photos: [googlePhoto] }),
    });
    const { container } = render(<ActivityCard item={item} />);
    expect(container.querySelector(`img[src=\"${googlePhoto}\"]`)).toBeInTheDocument();
  });
});
