import { fireEvent, render } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockUseApi = jest.fn();
const mockCacheTripLocally = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'trip-1' }),
}));

jest.mock('@/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/offline/tripCache', () => ({
  cacheTripLocally: (...args: unknown[]) => mockCacheTripLocally(...args),
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(),
      })),
    })),
  },
}));

jest.mock('@/components/ui/PremiumBackground', () => ({
  PremiumBackground: () => null,
}));

jest.mock('@/components/trip/TripHero', () => ({
  TripHero: ({ title, onBack, onShare }: { title: string; onBack: () => void; onShare: () => void }) => {
    const { View, Text, Pressable } = require('react-native');
    return (
      <View>
        <Text>{title}</Text>
        <Pressable onPress={onBack}>
          <Text>back-hero</Text>
        </Pressable>
        <Pressable onPress={onShare}>
          <Text>share-hero</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock('@/components/trip/DayHeader', () => ({
  DayHeader: ({ dayNumber }: { dayNumber: number }) => {
    const { Text } = require('react-native');
    return <Text>{`day-${dayNumber}`}</Text>;
  },
}));

jest.mock('@/components/trip/ActivityItem', () => ({
  ActivityItem: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{`activity-${item.title}`}</Text>;
  },
}));

jest.mock('@/components/trip/ActivityActions', () => ({
  ActivityActions: () => null,
}));

jest.mock('@/components/trip/ActivityDetail', () => ({
  ActivityDetail: () => {
    const { Text } = require('react-native');
    return <Text>activity-detail</Text>;
  },
}));

jest.mock('@/components/trip/TripMap', () => ({
  TripMap: () => {
    const { Text } = require('react-native');
    return <Text>trip-map</Text>;
  },
}));

jest.mock('@/components/trip/HotelSelector', () => ({
  HotelSelector: () => {
    const { Text } = require('react-native');
    return <Text>hotel-selector</Text>;
  },
}));

jest.mock('@/components/trip/TransportSelector', () => ({
  TransportSelector: () => {
    const { Text } = require('react-native');
    return <Text>transport-selector</Text>;
  },
}));

jest.mock('@/components/trip/BookingChecklist', () => ({
  BookingChecklist: () => {
    const { Text } = require('react-native');
    return <Text>booking-checklist</Text>;
  },
}));

jest.mock('@/components/trip/ChatPanel', () => ({
  ChatPanel: ({ isOpen }: { isOpen: boolean }) => {
    const { Text } = require('react-native');
    return isOpen ? <Text>chat-panel</Text> : null;
  },
}));

jest.mock('@/components/trip/SharePanel', () => ({
  SharePanel: ({ isOpen, visibility }: { isOpen: boolean; visibility: string }) => {
    const { Text } = require('react-native');
    return isOpen ? <Text>{`share-panel-${visibility}`}</Text> : null;
  },
}));

jest.mock('@/components/trip/CalendarExport', () => ({
  CalendarExport: ({ isOpen }: { isOpen: boolean }) => {
    const { Text } = require('react-native');
    return isOpen ? <Text>calendar-export</Text> : null;
  },
}));

jest.mock('@/components/ui/BottomSheet', () => ({
  BottomSheet: ({ isOpen, children }: { isOpen: boolean; children?: any }) => {
    if (!isOpen) return null;
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/components/ui/Skeleton', () => ({
  Skeleton: () => null,
}));

import TripDetailScreen from '@/app/trip/[id]';

const row = {
  id: 'trip-1',
  title: 'Rome Escape',
  destination: 'Rome',
  start_date: '2026-04-10',
  end_date: '2026-04-13',
  duration_days: 3,
  visibility: 'private' as const,
  preferences: {
    groupSize: 2,
    budgetLevel: 'moderate',
  },
  data: {
    preferences: {
      groupSize: 2,
      budgetLevel: 'moderate',
    },
    bookedItems: {},
    transportOptions: [{ id: 'transport-1' }],
    selectedTransport: { id: 'transport-1' },
    accommodationOptions: [{ id: 'hotel-1' }],
    accommodation: { id: 'hotel-1' },
    days: [
      {
        dayNumber: 1,
        date: '2026-04-10',
        theme: 'Rome antique',
        items: [
          {
            id: 'item-1',
            title: 'Colisée',
          },
        ],
      },
    ],
    costBreakdown: {
      flights: 120,
      accommodation: 140,
      food: 60,
      activities: 40,
      transport: 20,
    },
    totalEstimatedCost: 380,
    carbonFootprint: {
      total: 42,
      rating: 'modérée',
    },
    travelTips: {
      emergency: {
        police: '112',
        ambulance: '118',
        fire: '115',
        generalEmergency: '112',
      },
    },
  },
};

describe('TripDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseApi.mockReturnValue({
      data: row,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it('renders the itinerary by default and switches between trip tabs', () => {
    const screen = render(<TripDetailScreen />);

    expect(screen.getByText('Rome Escape')).toBeTruthy();
    expect(screen.getByText('transport-selector')).toBeTruthy();
    expect(screen.getByText('hotel-selector')).toBeTruthy();
    expect(screen.getByText('activity-Colisée')).toBeTruthy();

    fireEvent.press(screen.getByText('Carte'));
    expect(screen.getByText('trip-map')).toBeTruthy();

    fireEvent.press(screen.getByText('Réserver'));
    expect(screen.getByText('booking-checklist')).toBeTruthy();

    fireEvent.press(screen.getByText('Budget'));
    expect(screen.getByText('Coût estimé total')).toBeTruthy();

    fireEvent.press(screen.getByText('Infos'));
    expect(screen.getByText("Numéros d'urgence")).toBeTruthy();
  });

  it('opens the share panel and routes back from the hero actions', () => {
    const screen = render(<TripDetailScreen />);

    fireEvent.press(screen.getByText('share-hero'));
    expect(screen.getByText('share-panel-private')).toBeTruthy();

    fireEvent.press(screen.getByText('back-hero'));
    expect(mockBack).toHaveBeenCalled();
  });
});
