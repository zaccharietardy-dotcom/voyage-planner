'use client';

import { Star, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Accommodation } from '@/lib/types';

interface HotelOptionProps {
  hotel: Accommodation;
  isSelected: boolean;
  onSelect: () => void;
}

export function HotelOption({ hotel, isSelected, onSelect }: HotelOptionProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full p-3 rounded-lg border-2 text-left transition-all',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
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
          {isSelected && (
            <span className="flex items-center gap-1 text-xs text-primary font-medium">
              <Check className="h-3 w-3" />
              Sélectionné
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
