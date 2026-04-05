'use client';

import { Card } from '@/components/ui/card';
import { Leaf, Plane, Building2, Bus, TreeDeciduous, Car, AlertCircle, UtensilsCrossed, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

interface CarbonFootprintProps {
  data: {
    total: number;
    flights: number;
    accommodation: number;
    localTransport: number;
    food?: number;
    activities?: number;
    rating: 'A' | 'B' | 'C' | 'D' | 'E';
    equivalents: {
      treesNeeded: number;
      carKmEquivalent: number;
    };
    tips: string[];
  };
  className?: string;
}

const RATING_COLORS = {
  A: { bg: 'bg-green-500', text: 'text-green-700', labelKey: 'carbon.rating.excellent' as const },
  B: { bg: 'bg-lime-500', text: 'text-lime-700', labelKey: 'carbon.rating.good' as const },
  C: { bg: 'bg-yellow-500', text: 'text-yellow-700', labelKey: 'carbon.rating.average' as const },
  D: { bg: 'bg-orange-500', text: 'text-orange-700', labelKey: 'carbon.rating.high' as const },
  E: { bg: 'bg-red-500', text: 'text-red-700', labelKey: 'carbon.rating.veryHigh' as const },
} as const;

const SECTORS = [
  { key: 'flights', labelKey: 'carbon.sector.transport' as const, icon: Plane, color: 'bg-pink-500', iconColor: 'text-pink-500' },
  { key: 'accommodation', labelKey: 'carbon.sector.accommodation' as const, icon: Building2, color: 'bg-purple-500', iconColor: 'text-purple-500' },
  { key: 'food', labelKey: 'carbon.sector.food' as const, icon: UtensilsCrossed, color: 'bg-orange-500', iconColor: 'text-orange-500' },
  { key: 'activities', labelKey: 'carbon.sector.activities' as const, icon: Ticket, color: 'bg-blue-500', iconColor: 'text-blue-500' },
  { key: 'localTransport', labelKey: 'carbon.sector.localTransport' as const, icon: Bus, color: 'bg-green-500', iconColor: 'text-green-500' },
] as const;

export function CarbonFootprint({ data, className }: CarbonFootprintProps) {
  const { t } = useTranslation();
  const ratingInfo = RATING_COLORS[data.rating];
  const food = data.food ?? 0;
  const activities = data.activities ?? 0;

  const sectorValues: Record<string, number> = {
    flights: data.flights,
    accommodation: data.accommodation,
    food,
    activities,
    localTransport: data.localTransport,
  };

  return (
    <Card className={cn('p-4', className)}>
      {/* Header avec note */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-full bg-green-100">
            <Leaf className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold">{t('carbon.title')}</h3>
            <p className="text-sm text-muted-foreground">ADEME Base Carbone 2023</p>
          </div>
        </div>
        <div className="text-right">
          <div className={cn(
            'inline-flex items-center justify-center w-10 h-10 rounded-full text-white font-bold text-lg',
            ratingInfo.bg
          )}>
            {data.rating}
          </div>
          <p className={cn('text-xs mt-1', ratingInfo.text)}>{t(ratingInfo.labelKey)}</p>
        </div>
      </div>

      {/* Total */}
      <div className="text-center py-4 border-y">
        <p className="text-3xl font-bold">{data.total} kg</p>
        <p className="text-sm text-muted-foreground">{t('carbon.co2')}</p>
      </div>

      {/* Détail par secteur */}
      <div className="mt-4 space-y-3">
        {SECTORS.map(({ key, labelKey, icon: Icon, color, iconColor }) => {
          const value = sectorValues[key];
          const percent = data.total > 0 ? (value / data.total) * 100 : 0;
          return (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4', iconColor)} />
                <span className="text-sm">{t(labelKey)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', color)} style={{ width: `${percent}%` }} />
                </div>
                <span className="text-sm font-medium w-16 text-right">{value} kg</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Équivalences */}
      <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg">
          <TreeDeciduous className="h-5 w-5 text-green-600" />
          <div>
            <p className="text-sm font-medium">{data.equivalents.treesNeeded} {t('carbon.trees')}</p>
            <p className="text-xs text-muted-foreground">{t('carbon.toOffset')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
          <Car className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium">{data.equivalents.carKmEquivalent} km</p>
            <p className="text-xs text-muted-foreground">{t('carbon.byCar')}</p>
          </div>
        </div>
      </div>

      {/* Conseils */}
      {data.tips.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">{t('carbon.tips')}</span>
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
