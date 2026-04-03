jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef((props: object, ref: unknown) => <View ref={ref} {...props} />);

  return {
    __esModule: true,
    default: { View: AnimatedView },
    View: AnimatedView,
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (updater: () => object) => updater(),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
    interpolate: (value: number, input: number[], output: number[]) => {
      if (value <= input[0]) return output[0];
      if (value >= input[input.length - 1]) return output[output.length - 1];
      return output[0];
    },
    Easing: {
      inOut: (value: number) => value,
      quad: 0,
      bezier: () => 0,
    },
    FadeIn: {},
    FadeInDown: {},
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/plan/GenerationMap', () => ({
  GenerationMap: ({ snapshot }: { snapshot?: { stage?: string } | null }) => {
    const { Text } = require('react-native');
    return <Text>{snapshot?.stage ? `map-${snapshot.stage}` : 'map-none'}</Text>;
  },
}));

import { render } from '@testing-library/react-native';
import { GeneratingScreen } from '@/components/plan/GeneratingScreen';

const baseProps = {
  destination: 'Rome',
  progress: {
    step: 2,
    total: 8,
    label: '2/8 — Restaurants',
  },
  error: null,
  onRetry: jest.fn(),
};

describe('GeneratingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the placeholder map state when no snapshot has arrived yet', () => {
    const screen = render(
      <GeneratingScreen {...baseProps} />,
    );

    expect(screen.getByText('map-none')).toBeTruthy();
    expect(screen.getByText(/itinéraire prend forme/i)).toBeTruthy();
  });

  it('renders a fetched snapshot state', () => {
    const screen = render(
      <GeneratingScreen
        {...baseProps}
        snapshot={{
          stage: 'fetched',
          center: { latitude: 41.9, longitude: 12.49 },
          markers: [],
        }}
      />,
    );

    expect(screen.getByText('map-fetched')).toBeTruthy();
  });

  it('renders a clustered snapshot state', () => {
    const screen = render(
      <GeneratingScreen
        {...baseProps}
        snapshot={{
          stage: 'clustered',
          center: { latitude: 41.9, longitude: 12.49 },
          markers: [],
        }}
      />,
    );

    expect(screen.getByText('map-clustered')).toBeTruthy();
  });

  it('renders the smart question card instead of the fun fact block', () => {
    const screen = render(
      <GeneratingScreen
        {...baseProps}
        question={{
          questionId: 'question-1',
          sessionId: 'session-1',
          type: 'activity_balance',
          title: 'Quel rythme ?',
          prompt: 'Préférez-vous plus de temps libre ?',
          timeoutMs: 30000,
          options: [
            { id: 'balanced', label: 'Équilibré', isDefault: true },
            { id: 'free-time', label: 'Plus de temps libre', isDefault: false },
          ],
        }}
        onAnswer={jest.fn()}
      />,
    );

    expect(screen.getByText('Quel rythme ?')).toBeTruthy();
    expect(screen.queryByText(/le saviez-vous/i)).toBeNull();
  });
});
