import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

jest.mock('@/components/ui/BottomSheet', () => ({
  BottomSheet: ({ isOpen, children }: { isOpen: boolean; children?: any }) => {
    if (!isOpen) return null;
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

import { SharePanel } from '@/components/trip/SharePanel';

describe('SharePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens the visibility sheet and sends the selected visibility', async () => {
    const onVisibilityChange = jest.fn();
    const screen = render(
      <SharePanel
        isOpen
        onClose={jest.fn()}
        tripId="trip-1"
        destination="Rome"
        visibility="private"
        onVisibilityChange={onVisibilityChange}
      />,
    );

    fireEvent.press(screen.getByText('Privé'));

    expect(screen.getByText('Visibilité du voyage')).toBeTruthy();

    fireEvent.press(screen.getByText('Public'));

    await waitFor(() => {
      expect(onVisibilityChange).toHaveBeenCalledWith('public');
    });
  });

  it('shares the trip link with the copy and native share actions', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    const screen = render(
      <SharePanel
        isOpen
        onClose={jest.fn()}
        tripId="trip-1"
        destination="Rome"
        visibility="private"
      />,
    );

    fireEvent.press(screen.getByText('Copier le lien'));
    fireEvent.press(screen.getAllByText('Partager').at(-1)!);

    await waitFor(() => {
      expect(shareSpy).toHaveBeenNthCalledWith(1, { message: 'https://naraevoyage.com/trip/trip-1' });
      expect(shareSpy).toHaveBeenNthCalledWith(
        2,
        { message: 'Découvre mon voyage à Rome sur Narae Voyage !\nhttps://naraevoyage.com/trip/trip-1' },
      );
    });
  });
});
