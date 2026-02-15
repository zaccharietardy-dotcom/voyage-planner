'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingDown,
  ExternalLink,
  Tag,
  Loader2,
  AlertCircle,
  DollarSign,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HotelPriceComparison, FlightPriceComparison, ActivityPriceComparison, PriceSource } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';

type PriceComparison = HotelPriceComparison | FlightPriceComparison | ActivityPriceComparison;

interface PriceComparisonCardProps {
  type: 'hotel' | 'flight' | 'activity';
  params: any;
  currentPrice?: number;
}

const PLATFORM_LOGOS: Record<string, string> = {
  booking: '🏨',
  airbnb: '🏠',
  expedia: '✈️',
  kayak: '🦆',
  viator: '🎫',
  tiqets: '🎟️',
  getyourguide: '🗺️',
  google_flights: '✈️',
  aviasales: '🛫',
  omio: '🚄',
  direct: '🔗',
};

const PLATFORM_NAMES: Record<string, string> = {
  booking: 'Booking.com',
  airbnb: 'Airbnb',
  expedia: 'Expedia',
  kayak: 'Kayak',
  viator: 'Viator',
  tiqets: 'Tiqets',
  getyourguide: 'GetYourGuide',
  google_flights: 'Google Flights',
  aviasales: 'Aviasales',
  omio: 'Omio',
  direct: 'Site officiel',
};

export function PriceComparisonCard({ type, params, currentPrice }: PriceComparisonCardProps) {
  const [comparison, setComparison] = useState<PriceComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadComparison();
  }, [type, JSON.stringify(params)]);

  const loadComparison = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/compare-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la comparaison des prix');
      }

      const { data } = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        setComparison(data[0]);
      } else {
        setComparison(data);
      }
    } catch (err) {
      console.error('Error loading price comparison:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Comparaison des prix...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 border-destructive/50">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      </Card>
    );
  }

  if (!comparison) {
    return null;
  }

  const { prices, bestPrice } = comparison;
  const averagePrice = 'averagePrice' in comparison ? comparison.averagePrice : 0;
  const savingsPercent = 'savingsPercent' in comparison ? comparison.savingsPercent : undefined;
  const savings = currentPrice && bestPrice ? currentPrice - bestPrice.price : 0;
  const hasSavings = savings > 0 || (savingsPercent && savingsPercent > 0);

  const getPriceTrend = (price: number): 'cheapest' | 'average' | 'expensive' => {
    if (price === bestPrice.price) return 'cheapest';
    if (averagePrice && price <= averagePrice) return 'average';
    return 'expensive';
  };

  const freeAlternative = 'freeAlternative' in comparison ? comparison.freeAlternative : undefined;

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-primary/5 to-primary/10 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Comparaison des prix</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {'hotelName' in comparison && comparison.hotelName}
              {'airline' in comparison && `${comparison.airline} - ${comparison.route}`}
              {'activityName' in comparison && comparison.activityName}
            </p>
          </div>

          {hasSavings && (
            <Badge className="bg-emerald-500 text-white">
              <TrendingDown className="h-3 w-3 mr-1" />
              Économisez {savings > 0 ? `${savings}€` : `${savingsPercent}%`}
            </Badge>
          )}
        </div>

        {/* Free alternative alert */}
        {freeAlternative && (
          <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <Tag className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{freeAlternative}</span>
            </div>
          </div>
        )}
      </div>

      {/* Price list */}
      <div className="p-4 space-y-2">
        {prices.slice(0, expanded ? undefined : 3).map((source, idx) => (
          <PriceSourceRow
            key={`${source.platform}-${idx}`}
            source={source}
            trend={getPriceTrend(source.price)}
            isBest={source.platform === bestPrice.platform && source.price === bestPrice.price}
            isCurrentPlatform={currentPrice === source.price}
          />
        ))}

        {/* Expand button */}
        {prices.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Voir moins
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Voir {prices.length - 3} autres plateformes
              </>
            )}
          </Button>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Prix moyen: {averagePrice}€</span>
          <span className="flex items-center gap-1">
            {prices.some((p) => p.isEstimate) && (
              <>
                <AlertCircle className="h-3 w-3" />
                Prix estimés
              </>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}

function PriceSourceRow({
  source,
  trend,
  isBest,
  isCurrentPlatform,
}: {
  source: PriceSource;
  trend: 'cheapest' | 'average' | 'expensive';
  isBest: boolean;
  isCurrentPlatform: boolean;
}) {
  const trendColors = {
    cheapest: 'text-emerald-600 dark:text-emerald-400',
    average: 'text-blue-600 dark:text-blue-400',
    expensive: 'text-orange-600 dark:text-orange-400',
  };

  const platformName = PLATFORM_NAMES[source.platform] || source.platform;
  const platformLogo = PLATFORM_LOGOS[source.platform] || '🔗';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-center justify-between p-3 rounded-lg border transition-all',
        isBest && 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/20',
        !isBest && 'border-border hover:border-primary/30',
        isCurrentPlatform && 'bg-primary/5'
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-2xl">{platformLogo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{platformName}</span>
            {isBest && (
              <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0">
                Meilleur prix
              </Badge>
            )}
            {isCurrentPlatform && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Actuel
              </Badge>
            )}
          </div>
          {source.isEstimate && (
            <span className="text-[10px] text-muted-foreground">Prix estimé</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className={cn('font-semibold text-sm', trendColors[trend])}>
            {source.price}€
          </div>
          <div className="text-[10px] text-muted-foreground">{source.currency}</div>
        </div>

        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </a>
        )}
      </div>
    </motion.div>
  );
}
