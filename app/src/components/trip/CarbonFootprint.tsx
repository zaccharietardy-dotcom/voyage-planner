'use client';

import { Card } from '@/components/ui/card';
import { Leaf, Plane, Building2, Bus, TreeDeciduous, Car, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CarbonFootprintProps {
  data: {
    total: number;
    flights: number;
    accommodation: number;
    localTransport: number;
    rating: 'A' | 'B' | 'C' | 'D' | 'E';
    equivalents: {
      treesNeeded: number;
      carKmEquivalent: number;
    };
    tips: string[];
  };
  className?: string;
}

const RATING_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  A: { bg: 'bg-green-500', text: 'text-green-700', label: 'Excellent' },
  B: { bg: 'bg-lime-500', text: 'text-lime-700', label: 'Bon' },
  C: { bg: 'bg-yellow-500', text: 'text-yellow-700', label: 'Moyen' },
  D: { bg: 'bg-orange-500', text: 'text-orange-700', label: 'Élevé' },
  E: { bg: 'bg-red-500', text: 'text-red-700', label: 'Très élevé' },
};

export function CarbonFootprint({ data, className }: CarbonFootprintProps) {
  const ratingInfo = RATING_COLORS[data.rating];
  const totalPercent = data.total > 0 ? 100 : 0;
  const flightPercent = data.total > 0 ? (data.flights / data.total) * 100 : 0;
  const accommodationPercent = data.total > 0 ? (data.accommodation / data.total) * 100 : 0;
  const transportPercent = data.total > 0 ? (data.localTransport / data.total) * 100 : 0;

  return (
    <Card className={cn('p-4', className)}>
      {/* Header with rating */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-full bg-green-100">
            <Leaf className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold">Empreinte carbone</h3>
            <p className="text-sm text-muted-foreground">Impact environnemental</p>
          </div>
        </div>
        <div className="text-right">
          <div className={cn(
            'inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-bold text-lg',
            ratingInfo.bg
          )}>
            {data.rating}
          </div>
          <p className={cn('text-xs mt-1', ratingInfo.text)}>{ratingInfo.label}</p>
        </div>
      </div>

      {/* Total */}
      <div className="text-center py-4 border-y">
        <p className="text-3xl font-bold">{data.total} kg</p>
        <p className="text-sm text-muted-foreground">CO₂ équivalent</p>
      </div>

      {/* Breakdown */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-pink-500" />
            <span className="text-sm">Vols</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-pink-500 rounded-full"
                style={{ width: `${flightPercent}%` }}
              />
            </div>
            <span className="text-sm font-medium w-16 text-right">{data.flights} kg</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-purple-500" />
            <span className="text-sm">Hébergement</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full"
                style={{ width: `${accommodationPercent}%` }}
              />
            </div>
            <span className="text-sm font-medium w-16 text-right">{data.accommodation} kg</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bus className="h-4 w-4 text-green-500" />
            <span className="text-sm">Transports locaux</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${transportPercent}%` }}
              />
            </div>
            <span className="text-sm font-medium w-16 text-right">{data.localTransport} kg</span>
          </div>
        </div>
      </div>

      {/* Equivalents */}
      <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
          <TreeDeciduous className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">{data.equivalents.treesNeeded} arbres</p>
            <p className="text-xs text-muted-foreground">pour compenser</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
          <Car className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium">{data.equivalents.carKmEquivalent} km</p>
            <p className="text-xs text-muted-foreground">en voiture</p>
          </div>
        </div>
      </div>

      {/* Tips */}
      {data.tips.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">Conseils</span>
          </div>
          <ul className="space-y-1">
            {data.tips.slice(0, 3).map((tip, idx) => (
              <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1">
                <span className="text-green-500">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
