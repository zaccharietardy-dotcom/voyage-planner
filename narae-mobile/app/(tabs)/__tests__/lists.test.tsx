import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = {
  push: jest.fn(),
};

let mockAuthState: any;
let mockApiState: any;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/hooks/useApi', () => ({
  useApi: () => mockApiState,
}));

jest.mock('@/hooks/useRefreshOnFocus', () => ({
  useRefreshOnFocus: jest.fn(),
}));

jest.mock('@/lib/api/trips', () => ({
  fetchMyTrips: jest.fn(),
  deleteTrip: jest.fn(),
}));

jest.mock('@/lib/api/feed', () => ({
  fetchFeed: jest.fn(),
  likeTrip: jest.fn(),
  unlikeTrip: jest.fn(),
  cloneTrip: jest.fn(),
}));

jest.mock('@/components/ui/PremiumBackground', () => ({
  PremiumBackground: () => null,
}));

jest.mock('@/components/trip/TripCard', () => ({
  TripCard: () => null,
}));

jest.mock('@/components/explore/FeedCard', () => ({
  FeedCard: () => null,
}));

import TripsScreen from '@/app/(tabs)/trips';
import ExploreScreen from '@/app/(tabs)/explore';

describe('TripsScreen and ExploreScreen empty states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = { user: { id: 'user-1' } };
    mockApiState = {
      data: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
  });

  it('shows the trips empty state and routes to plan', () => {
    const screen = render(<TripsScreen />);

    expect(screen.getByText('Aucun voyage')).toBeTruthy();

    fireEvent.press(screen.getByText('Créer un voyage'));

    expect(mockRouter.push).toHaveBeenCalledWith('/plan');
  });

  it('shows the explore empty state when there are no public trips', () => {
    mockAuthState = { user: null };

    const screen = render(<ExploreScreen />);

    expect(screen.getByText('Aucun voyage public')).toBeTruthy();
    expect(screen.getByText('Soyez le premier à partager un voyage.')).toBeTruthy();
  });
});
