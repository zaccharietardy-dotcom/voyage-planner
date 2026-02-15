'use client';

import { useState } from 'react';
import { Star, Check, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accommodation } from '@/lib/types';
import { PriceComparisonCard } from './PriceComparisonCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface HotelOptionProps {
  hotel: Accommodation;
  isSelected: boolean;
  onSelect: () => void;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
}

export function HotelOption({ hotel, isSelected, onSelect, checkIn, checkOut, adults = 2 }: HotelOptionProps) {
  const [showComparison, setShowComparison] = useState(false);

  return (
    <>
      <button
        onClick={onSelect}
        className={cn(
          'relative w-full p-3 rounded-lg border-2 text-left transition-all duration-200',
          isSelected
            ? 'border-primary bg-primary/5 ring-1 ring-primary/30 shadow-md shadow-primary/10'
            : 'border-border/50 hover:border-primary/50 opacity-95 hover:opacity-100 hover:bg-muted/50'
        )}
      >
      {/* Badge checkmark vert en haut à droite */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-20 bg-emerald-500 rounded-full p-1.5 shadow-lg">
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium truncate">{hotel.name}</h4>
            {hotel.breakfastIncluded && (
              <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0">
                Petit-déj
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            {hotel.stars && hotel.stars > 0 && (
              <span className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(hotel.stars, 5) }).map((_, i) => (
                  <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                ))}
              </span>
            )}
            {hotel.rating && hotel.rating > 0 && (
              <span className="font-medium">{hotel.rating.toFixed(1)}/10</span>
            )}
            {hotel.reviewCount && hotel.reviewCount > 0 && (
              <span>({hotel.reviewCount} avis)</span>
            )}
          </div>

          {hotel.address && hotel.address !== 'Adresse non disponible' && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {hotel.address}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <p className="font-semibold">
            {hotel.pricePerNight}€
            <span className="text-xs font-normal text-muted-foreground">/nuit</span>
          </p>
          {hotel.totalPrice && hotel.totalPrice > 0 && (
            <p className="text-xs text-muted-foreground">
              Total: {hotel.totalPrice}€
            </p>
          )}

          {/* Price comparison button */}
          {checkIn && checkOut && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowComparison(true);
              }}
              className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline mt-1"
            >
              <TrendingDown className="h-3 w-3" />
              Comparer les prix
            </button>
          )}
        </div>
      </div>
    </button>

    {/* Price comparison modal */}
    <Dialog open={showComparison} onOpenChange={setShowComparison}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{hotel.name} - Comparaison des prix</DialogTitle>
        </DialogHeader>
        <PriceComparisonCard
          type="hotel"
          params={{
            city: hotel.address?.split(',').pop()?.trim() || 'Unknown',
            checkIn: checkIn!,
            checkOut: checkOut!,
            hotelName: hotel.name,
            adults,
          }}
          currentPrice={hotel.totalPrice}
        />
      </DialogContent>
    </Dialog>
  </>
  );
}
