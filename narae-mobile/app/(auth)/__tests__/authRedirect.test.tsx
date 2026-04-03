import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: { redirect?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 'FULL_NAME',
    EMAIL: 'EMAIL',
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn(() => 'narae://auth/callback'),
}));

jest.mock('@/components/ui/PremiumBackground', () => ({
  PremiumBackground: () => null,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, onPress }: { children: string; onPress: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signInWithIdToken: jest.fn(),
      signInWithOAuth: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

import { supabase } from '@/lib/supabase/client';
import LoginScreen from '@/app/(auth)/login';
import RegisterScreen from '@/app/(auth)/register';

const mockSupabase = supabase as unknown as {
  auth: {
    signInWithPassword: jest.Mock;
    signUp: jest.Mock;
    signInWithIdToken: jest.Mock;
    signInWithOAuth: jest.Mock;
    setSession: jest.Mock;
  };
};

describe('auth redirect screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    global.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true }) as jest.Mock;
  });

  it('redirects to the requested path after email login', async () => {
    mockParams = { redirect: '/plan' };
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ error: null });

    const screen = render(<LoginScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('votre@email.com'), 'rome@narae.app');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'Password1!');
    fireEvent.press(screen.getByText('Se connecter'));

    await waitFor(() => {
      expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'rome@narae.app',
        password: 'Password1!',
      });
      expect(mockReplace).toHaveBeenCalledWith('/plan');
    });
  });

  it('keeps the redirect when navigating back to login from register', () => {
    mockParams = { redirect: '/profile' };

    const screen = render(<RegisterScreen />);

    fireEvent.press(screen.getByText('Se connecter'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(auth)/login',
      params: { redirect: '/profile' },
    });
  });
});
