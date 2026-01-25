'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TripPreferences, TransportType, TRANSPORT_LABELS } from '@/lib/types';
import { Plane, Train, Car, Bus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepTransportProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

const TRANSPORT_ICONS: Record<TransportType, React.ReactNode> = {
  plane: <Plane className="h-8 w-8" />,
  train: <Train className="h-8 w-8" />,
  car: <Car className="h-8 w-8" />,
  bus: <Bus className="h-8 w-8" />,
};

const TRANSPORT_OPTIONS: TransportType[] = ['plane', 'train', 'car', 'bus'];

export function StepTransport({ data, onChange }: StepTransportProps) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Comment vous déplacez-vous ?</h2>
        <p className="text-muted-foreground">Choisissez votre moyen de transport principal</p>
      </div>

      {/* Moyen de transport */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Transport principal</Label>
        <div className="grid grid-cols-2 gap-4">
          {TRANSPORT_OPTIONS.map((transport) => (
            <button
              key={transport}
              type="button"
              onClick={() => onChange({ transport })}
              className={cn(
                'flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all',
                'hover:border-primary hover:bg-primary/5',
                data.transport === transport
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card'
              )}
            >
              {TRANSPORT_ICONS[transport]}
              <span className="mt-3 font-medium">{TRANSPORT_LABELS[transport]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Location de voiture */}
      <div className="flex items-center justify-between p-6 rounded-xl border bg-card">
        <div className="space-y-1">
          <Label htmlFor="car-rental" className="text-base font-medium cursor-pointer">
            Location de voiture sur place
          </Label>
          <p className="text-sm text-muted-foreground">
            Louez une voiture à destination pour plus de liberté
          </p>
        </div>
        <Switch
          id="car-rental"
          checked={data.carRental || false}
          onCheckedChange={(checked) => onChange({ carRental: checked })}
        />
      </div>
    </div>
  );
}
