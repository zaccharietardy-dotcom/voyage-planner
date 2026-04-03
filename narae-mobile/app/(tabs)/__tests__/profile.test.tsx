import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
};

let mockAuthState: any;
let mockApiState: any;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/hooks/useApi', () => ({
  useApi: () => mockApiState,
}));

jest.mock('@/lib/api/trips', () => ({
  fetchMyTrips: jest.fn(),
}));

jest.mock('@/lib/api/account', () => ({
  deleteAccount: jest.fn(),
  exportAccountData: jest.fn(),
}));

jest.mock('@/components/ui/PremiumBackground', () => ({
  PremiumBackground: () => null,
}));

jest.mock('@/components/trip/TripCard', () => ({
  TripCard: ({ trip }: { trip: { id: string } }) => {
    const { Text } = require('react-native');
    return <Text>{`trip-card-${trip.id}`}</Text>;
  },
}));

import { deleteAccount, exportAccountData } from '@/lib/api/account';
import ProfileScreen from '@/app/(tabs)/profile';

const mockDeleteAccount = deleteAccount as jest.MockedFunction<typeof deleteAccount>;
const mockExportAccountData = exportAccountData as jest.MockedFunction<typeof exportAccountData>;

function createAuthenticatedState() {
  return {
    user: { id: 'user-1', email: 'pro@narae.app' },
    profile: {
      display_name: 'Zak',
      avatar_url: null,
      subscription_status: 'pro',
    },
    isLoading: false,
    signOut: jest.fn(),
  };
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiState = {
      data: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };
    mockAuthState = {
      user: null,
      profile: null,
      isLoading: false,
      signOut: jest.fn(),
    };
  });

  it('shows the logged-out CTA and routes to login with a profile redirect', () => {
    const screen = render(<ProfileScreen />);

    expect(screen.getByText('Connectez-vous')).toBeTruthy();

    fireEvent.press(screen.getByText('Se connecter'));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(auth)/login',
      params: { redirect: '/profile' },
    });
  });

  it('shows account actions and tab content for an authenticated user', () => {
    mockAuthState = createAuthenticatedState();
    mockApiState = {
      data: [
        {
          id: 'trip-1',
          destination: 'Rome',
          title: 'Rome',
          start_date: '2026-04-10',
          end_date: '2026-04-14',
        },
      ],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    };

    const screen = render(<ProfileScreen />);

    expect(screen.getByText('Préférences de voyage')).toBeTruthy();
    expect(screen.getByText('Exporter mes données')).toBeTruthy();
    expect(screen.getByText('Se déconnecter')).toBeTruthy();
    expect(screen.getByText('Supprimer mon compte')).toBeTruthy();
    expect(screen.getByText('trip-card-trip-1')).toBeTruthy();

    fireEvent.press(screen.getByText('Stats'));

    expect(screen.getByText('Créés')).toBeTruthy();
    expect(screen.getByText('Terminés')).toBeTruthy();
  });

  it('exports account data from the account actions block', async () => {
    mockAuthState = createAuthenticatedState();
    mockExportAccountData.mockResolvedValue(undefined);

    const screen = render(<ProfileScreen />);

    fireEvent.press(screen.getByText('Exporter mes données'));

    await waitFor(() => {
      expect(mockExportAccountData).toHaveBeenCalled();
    });
  });

  it('deletes the account, signs out and routes home after confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const signOut = jest.fn().mockResolvedValue(undefined);
    mockAuthState = {
      ...createAuthenticatedState(),
      signOut,
    };
    mockDeleteAccount.mockResolvedValue(undefined);

    const screen = render(<ProfileScreen />);

    fireEvent.press(screen.getByText('Supprimer mon compte'));

    const deleteCall = alertSpy.mock.calls.at(-1);
    const deleteAction = deleteCall?.[2]?.find((action) => action.style === 'destructive');
    await act(async () => {
      await deleteAction?.onPress?.();
    });

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalled();
      expect(signOut).toHaveBeenCalled();
      expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
    });

    alertSpy.mockRestore();
  });
});
