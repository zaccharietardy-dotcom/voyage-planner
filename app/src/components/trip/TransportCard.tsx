'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Train,
  Bus,
  Footprints,
  Car,
  Clock,
  MapPin,
  ExternalLink,
  TrendingUp,
  Zap,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Euro,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MultiModalDirections, TransitLine } from '@/lib/services/directions';
import { formatRidePrice } from '@/lib/services/transitEnricher';

interface TransportCardProps {
  fromTitle: string;
  toTitle: string;
  transportOptions: MultiModalDirections;
  compact?: boolean;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Carte de transport affichant les options entre deux activités
 * Tabs: Transit / Marche / VTC (Uber)
 */
export function TransportCard({
  fromTitle,
  toTitle,
  transportOptions,
  compact = false,
  defaultExpanded = false,
  className,
}: TransportCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasTransit = !!transportOptions.transit;
  const hasWalking = !!transportOptions.walking;
  const hasRide = !!transportOptions.rideHailing;

  // Déterminer l'onglet par défaut
  const defaultTab = transportOptions.recommendWalking
    ? 'walking'
    : hasTransit
      ? 'transit'
      : hasWalking
        ? 'walking'
        : 'ride';

  if (compact && !expanded) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border border-border cursor-pointer hover:bg-muted transition-colors',
          className
        )}
        onClick={() => setExpanded(true)}
      >
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground flex-1">
          {fromTitle} → {toTitle}
        </span>
        {transportOptions.recommendWalking && (
          <Badge variant="secondary" className="text-xs">
            <Footprints className="h-3 w-3 mr-1" />
            {transportOptions.walking?.duration} min
          </Badge>
        )}
        {hasTransit && !transportOptions.recommendWalking && (
          <Badge variant="secondary" className="text-xs">
            <Train className="h-3 w-3 mr-1" />
            {transportOptions.transit?.duration} min
          </Badge>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className={cn('p-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <MapPin className="h-4 w-4" />
            <span className="font-medium">{fromTitle}</span>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span className="font-medium">{toTitle}</span>
          </div>
        </div>

        {compact && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="transit" disabled={!hasTransit}>
            <Train className="h-4 w-4 mr-1.5" />
            Transit
          </TabsTrigger>
          <TabsTrigger value="walking" disabled={!hasWalking}>
            <Footprints className="h-4 w-4 mr-1.5" />
            Marche
          </TabsTrigger>
          <TabsTrigger value="ride" disabled={!hasRide}>
            <Car className="h-4 w-4 mr-1.5" />
            VTC
          </TabsTrigger>
        </TabsList>

        {/* Transit Tab */}
        {hasTransit && (
          <TabsContent value="transit" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">
                  {transportOptions.transit!.duration} min
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {transportOptions.transit!.distance.toFixed(1)} km
              </div>
            </div>

            {/* Transit Lines */}
            {transportOptions.transit!.transitLines.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Lignes
                </div>
                <div className="flex flex-wrap gap-2">
                  {transportOptions.transit!.transitLines.map((line, idx) => (
                    <TransitLineBadge key={idx} line={line} />
                  ))}
                </div>

                {/* Stops info */}
                {transportOptions.transit!.transitLines.some(
                  (l) => l.departureStop || l.arrivalStop
                ) && (
                  <div className="text-xs space-y-1 mt-3 pl-4 border-l-2 border-muted">
                    {transportOptions.transit!.transitLines.map((line, idx) => (
                      <div key={idx} className="space-y-0.5">
                        {line.departureStop && (
                          <div className="text-muted-foreground">
                            Départ: <span className="text-foreground">{line.departureStop}</span>
                          </div>
                        )}
                        {line.arrivalStop && (
                          <div className="text-muted-foreground">
                            Arrivée: <span className="text-foreground">{line.arrivalStop}</span>
                          </div>
                        )}
                        {line.numStops && (
                          <div className="text-muted-foreground">
                            {line.numStops} arrêt{line.numStops > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Source indicator */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                {transportOptions.transit!.source === 'google' && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    Horaires en temps réel
                  </span>
                )}
                {transportOptions.transit!.source === 'estimated' && (
                  <span>Estimation</span>
                )}
              </div>
              <a
                href={transportOptions.transit!.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Voir sur Google Maps
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </TabsContent>
        )}

        {/* Walking Tab */}
        {hasWalking && (
          <TabsContent value="walking" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">
                  {transportOptions.walking!.duration} min
                </span>
                {transportOptions.recommendWalking && (
                  <Badge variant="default" className="ml-2">
                    Recommandé
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {transportOptions.walking!.distance.toFixed(2)} km
              </div>
            </div>

            {/* Walking benefits */}
            {transportOptions.recommendWalking && (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="text-xs text-green-700 dark:text-green-300">
                    <div className="font-medium mb-1">
                      Trajet court et agréable
                    </div>
                    <div>
                      La marche est idéale pour découvrir la ville et profiter
                      de l&apos;atmosphère locale.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-muted-foreground">Gratuit</div>
              <a
                href={transportOptions.walking!.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Voir l&apos;itinéraire
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </TabsContent>
        )}

        {/* Ride Tab */}
        {hasRide && (
          <TabsContent value="ride" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">
                  ~{transportOptions.rideHailing!.duration} min
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                {transportOptions.rideHailing!.distance.toFixed(1)} km
              </div>
            </div>

            {/* Price */}
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Prix estimé
                </div>
                <div className="flex items-center gap-1 font-semibold text-lg">
                  <Euro className="h-4 w-4" />
                  {formatRidePrice(
                    transportOptions.rideHailing!.priceMin,
                    transportOptions.rideHailing!.priceMax,
                    transportOptions.rideHailing!.currency
                  )}
                </div>
              </div>
              {transportOptions.rideHailing!.estimatedWaitTime && (
                <div className="text-xs text-muted-foreground mt-2">
                  Attente moyenne:{' '}
                  {transportOptions.rideHailing!.estimatedWaitTime} min
                </div>
              )}
            </div>

            {/* Services disponibles */}
            <div className="text-xs text-muted-foreground">
              Services: Uber, Bolt, ou taxi local
            </div>

            <div className="pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                Prix estimé selon tarifs moyens de la ville
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </Card>
  );
}

/**
 * Badge pour une ligne de transport
 */
function TransitLineBadge({ line }: { line: TransitLine }) {
  const icons = {
    metro: <Train className="h-3 w-3" />,
    bus: <Bus className="h-3 w-3" />,
    tram: <Train className="h-3 w-3" />,
    train: <Train className="h-3 w-3" />,
    ferry: <Car className="h-3 w-3" />,
  };

  const bgColor = line.color
    ? `#${line.color}`
    : line.mode === 'metro'
      ? '#0066cc'
      : line.mode === 'bus'
        ? '#ff6600'
        : line.mode === 'tram'
          ? '#009933'
          : '#666666';

  // Déterminer si la couleur est claire ou foncée pour le texte
  const isLight = line.color
    ? parseInt(line.color.slice(0, 2), 16) +
        parseInt(line.color.slice(2, 4), 16) +
        parseInt(line.color.slice(4, 6), 16) >
      380
    : false;

  const textColor = isLight ? '#000000' : '#ffffff';

  return (
    <Badge
      style={{
        backgroundColor: bgColor,
        color: textColor,
      }}
      className="gap-1.5 font-semibold"
    >
      {icons[line.mode]}
      <span>{line.number}</span>
      {line.name && <span className="text-xs opacity-90">· {line.name}</span>}
    </Badge>
  );
}
