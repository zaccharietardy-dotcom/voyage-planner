import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
let mockUser: { id: string } | null = { id: 'user-1' };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/components/ui/PremiumBackground', () => ({
  PremiumBackground: () => null,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onPress,
  }: {
    children: string;
    onPress: () => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepDestination', () => ({
  StepDestination: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ destination: 'Rome' })}>
        <Text>set-destination</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepOrigin', () => ({
  StepOrigin: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ origin: 'Paris' })}>
        <Text>set-origin</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepWhen', () => ({
  StepWhen: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ startDate: new Date('2026-04-10T00:00:00.000Z') })}>
        <Text>set-when</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepGroup', () => ({
  StepGroup: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ groupSize: 2, groupType: 'couple' })}>
        <Text>set-group</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepPreferences', () => ({
  StepPreferences: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ activities: ['culture'], dietary: ['none'] })}>
        <Text>set-preferences</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepBudget', () => ({
  StepBudget: ({ onChange }: { onChange: (update: object) => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={() => onChange({ budgetLevel: 'moderate', transport: 'train' })}>
        <Text>set-budget</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/StepSummary', () => ({
  StepSummary: ({
    onGenerate,
  }: {
    onGenerate: () => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable onPress={onGenerate}>
        <Text>generate-trip</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/plan/GeneratingScreen', () => ({
  GeneratingScreen: ({ error }: { error: string | null }) => {
    const { Text } = require('react-native');
    return <Text>{error ? `generation-error-${error}` : 'generating-screen'}</Text>;
  },
}));

jest.mock('@/lib/api/trips', () => ({
  checkGenerateAccess: jest.fn(),
  generateTrip: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
  api: {
    post: jest.fn(),
  },
}));

import { api } from '@/lib/api/client';
import { checkGenerateAccess, generateTrip } from '@/lib/api/trips';
import { PlanWizardScreen } from '@/components/plan/PlanWizardScreen';

const mockApi = api as jest.Mocked<typeof api>;
const mockCheckGenerateAccess = checkGenerateAccess as jest.MockedFunction<typeof checkGenerateAccess>;
const mockGenerateTrip = generateTrip as jest.MockedFunction<typeof generateTrip>;

describe('PlanWizardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockUser = { id: 'user-1' };
    mockCheckGenerateAccess.mockResolvedValue({ allowed: true });
    mockGenerateTrip.mockResolvedValue({ title: 'Rome Escape' } as any);
    mockApi.post.mockResolvedValue({ id: 'saved-trip-1' } as never);
  });

  it('routes to login from the generation gate when auth is required', async () => {
    mockCheckGenerateAccess.mockResolvedValue({
      allowed: false,
      action: 'login',
      reason: 'Connectez-vous pour générer votre voyage.',
    });

    const screen = render(<PlanWizardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Connectez-vous')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Se connecter'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(auth)/login',
      params: { redirect: '/plan' },
    });
  });

  it('routes to pricing from the generation gate when an upgrade is required', async () => {
    mockCheckGenerateAccess.mockResolvedValue({
      allowed: false,
      action: 'upgrade',
      reason: 'Passez à Pro pour continuer.',
    });

    const screen = render(<PlanWizardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Débloquez la génération')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Voir les offres'));

    expect(mockPush).toHaveBeenCalledWith('/pricing');
  });

  it('generates, saves and opens the trip detail after completing the wizard', async () => {
    const screen = render(<PlanWizardScreen />);

    fireEvent.press(screen.getByText('set-destination'));
    fireEvent.press(screen.getByText('Suivant'));

    fireEvent.press(screen.getByText('set-origin'));
    fireEvent.press(screen.getByText('Suivant'));

    fireEvent.press(screen.getByText('set-when'));
    fireEvent.press(screen.getByText('Suivant'));

    fireEvent.press(screen.getByText('set-group'));
    fireEvent.press(screen.getByText('Suivant'));

    fireEvent.press(screen.getByText('set-preferences'));
    fireEvent.press(screen.getByText('Suivant'));

    fireEvent.press(screen.getByText('set-budget'));
    fireEvent.press(screen.getByText('Récapitulatif'));

    fireEvent.press(screen.getByText('generate-trip'));

    await waitFor(() => {
      expect(mockGenerateTrip).toHaveBeenCalled();
      expect(mockApi.post).toHaveBeenCalledWith('/api/trips', expect.objectContaining({
        destination: 'Rome',
        durationDays: 3,
      }));
      expect(mockReplace).toHaveBeenCalledWith('/trip/saved-trip-1');
    });
  });
});
