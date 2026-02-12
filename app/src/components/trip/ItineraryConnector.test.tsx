import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ItineraryConnector } from './ItineraryConnector';

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  Navigation: () => <span data-testid="navigation-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  MapPin: () => <span data-testid="mappin-icon" />,
  Footprints: () => <span data-testid="footprints-icon" />,
  Car: () => <span data-testid="car-icon" />,
  TrainFront: () => <span data-testid="train-front-icon" />,
}));

describe('ItineraryConnector', () => {
  const mockFrom = {
    name: 'Sagrada Familia',
    latitude: 41.4036,
    longitude: 2.1744,
  };

  const mockTo = {
    name: 'Parc Güell',
    latitude: 41.4145,
    longitude: 2.1527,
  };

  describe('Google Maps URL generation', () => {
    it('renders a link to Google Maps with correct URL', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('google.com/maps/dir'));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('includes origin and destination in URL', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      const link = screen.getByRole('link');
      const href = link.getAttribute('href') || '';

      // Décoder l'URL pour vérifier les noms
      expect(decodeURIComponent(href)).toContain('Sagrada Familia');
      expect(decodeURIComponent(href)).toContain('Parc Güell');
    });

    it('uses walking mode by default', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=walking'));
    });

    it('supports transit mode', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="transit" />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=transit'));
    });

    it('supports public mode (maps to transit)', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="public" />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=transit'));
    });

    it('supports driving mode', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="driving" />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=driving'));
    });

    it('supports car mode (maps to driving)', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="car" />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', expect.stringContaining('travelmode=driving'));
    });
  });

  describe('destination display', () => {
    it('displays the destination name', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      expect(screen.getByText(/Parc Güell/)).toBeInTheDocument();
    });

    it('shows arrow and destination name', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      expect(screen.getByText(/→.*Parc Güell/)).toBeInTheDocument();
    });
  });

  describe('duration display', () => {
    it('does not show duration when not provided', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      expect(screen.queryByTestId('clock-icon')).not.toBeInTheDocument();
    });

    it('displays duration in minutes when under 60 min', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} duration={15} />);

      expect(screen.getByText('15 min')).toBeInTheDocument();
      expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
    });

    it('formats duration with hours when 60+ minutes', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} duration={90} />);

      expect(screen.getByText('1h30')).toBeInTheDocument();
    });

    it('formats exact hours without minutes', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} duration={120} />);

      expect(screen.getByText('2h')).toBeInTheDocument();
    });
  });

  describe('distance display', () => {
    it('does not show distance when not provided', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} />);

      expect(screen.queryByTestId('mappin-icon')).not.toBeInTheDocument();
    });

    it('displays distance in km when >= 1 km', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} distance={1.2} />);

      expect(screen.getByText('1.2 km')).toBeInTheDocument();
    });

    it('displays distance in meters when < 1 km', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} distance={0.5} />);

      expect(screen.getByText('500 m')).toBeInTheDocument();
    });

    it('rounds meters correctly', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} distance={0.234} />);

      expect(screen.getByText('234 m')).toBeInTheDocument();
    });
  });

  describe('mode icons', () => {
    it('shows Footprints icon for walk mode', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="walk" />);

      expect(screen.getByTestId('footprints-icon')).toBeInTheDocument();
    });

    it('shows TrainFront icon for transit mode', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="transit" />);

      expect(screen.getByTestId('train-front-icon')).toBeInTheDocument();
    });

    it('shows Car icon for car mode', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="car" />);

      expect(screen.getByTestId('car-icon')).toBeInTheDocument();
    });

    it('shows Car icon for taxi mode (maps to driving)', () => {
      render(<ItineraryConnector from={mockFrom} to={mockTo} mode="taxi" />);

      expect(screen.getByTestId('car-icon')).toBeInTheDocument();
    });
  });

  describe('combined duration and distance', () => {
    it('displays both duration and distance when provided', () => {
      render(
        <ItineraryConnector
          from={mockFrom}
          to={mockTo}
          duration={15}
          distance={1.2}
        />
      );

      expect(screen.getByText('15 min')).toBeInTheDocument();
      expect(screen.getByText('1.2 km')).toBeInTheDocument();
      expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
    });
  });
});
