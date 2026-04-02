import { fireEvent, render } from '@testing-library/react-native';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders its label and triggers onPress', () => {
    const onPress = jest.fn();
    const screen = render(
      <Button onPress={onPress}>Continuer</Button>,
    );

    fireEvent.press(screen.getByText('Continuer'));

    expect(screen.getByText('Continuer')).toBeTruthy();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disables presses while loading', () => {
    const screen = render(
      <Button onPress={() => {}} isLoading>
        Continuer
      </Button>,
    );

    expect(screen.queryByText('Continuer')).toBeNull();
  });
});
