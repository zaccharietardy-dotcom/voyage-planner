jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef((props: object, ref: unknown) => <View ref={ref} {...props} />);
  const fade = {
    duration: () => fade,
    delay: () => fade,
  };

  return {
    __esModule: true,
    default: {
      View: AnimatedView,
      createAnimatedComponent: (Component: unknown) => Component,
    },
    View: AnimatedView,
    createAnimatedComponent: (Component: unknown) => Component,
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (updater: () => object) => updater(),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
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
    FadeIn: fade,
    FadeInDown: fade,
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children?: any }) => children,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
  },
  NotificationFeedbackType: {
    Success: 'Success',
  },
}));

jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, ...props }: { children?: any }) => <View {...props}>{children}</View>,
  };
});

jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BlurView: ({ children, ...props }: { children?: any }) => <View {...props}>{children}</View>,
  };
});

jest.mock('expo-image', () => {
  const ReactNative = require('react-native');
  return {
    Image: ReactNative.Image,
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

(global as any).__reanimatedWorkletInit = () => {};
