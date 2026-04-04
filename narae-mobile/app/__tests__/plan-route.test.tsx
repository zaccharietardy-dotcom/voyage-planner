import { render } from '@testing-library/react-native';

jest.mock('@/components/plan/PlanWizardScreen', () => ({
  PlanWizardScreen: () => {
    const { Text } = require('react-native');
    return <Text>plan-wizard-screen</Text>;
  },
}));

import PlanScreen from '@/app/(tabs)/plan';

describe('plan route smoke', () => {
  it('renders the plan wizard tab route', () => {
    const screen = render(<PlanScreen />);

    expect(screen.getByText('plan-wizard-screen')).toBeTruthy();
  });
});
