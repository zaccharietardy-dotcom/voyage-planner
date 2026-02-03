'use client';

import { Hotel, Search, ExternalLink, Star, Check, ChevronDown, Bed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accommodation } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HotelSearchLinks {
  googleHotels: string;
  booking: string;
}

interface HotelSelectorProps {
  hotels: Accommodation[];
  selectedId: string;
  onSelect: (hotelId: string) => void;
  searchLinks: HotelSearchLinks;
  nights: number;
}

/**
 * Compact hotel selector that shows as an inline button + dialog.
 * Designed to be embedded in the planning timeline near checkin/checkout items.
 */
export function HotelSelector({
  hotels,
  selectedId,
  onSelect,
  searchLinks,
  nights,
}: HotelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectedHotel = hotels.find(h => h.id === selectedId) || hotels[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bed className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedHotel?.name || 'Choisir un hébergement'}</p>
            <p className="text-xs text-muted-foreground">
              {selectedHotel?.pricePerNight}€/nuit · {nights} nuit{nights > 1 ? 's' : ''} · Total {selectedHotel?.totalPrice || (selectedHotel?.pricePerNight || 0) * nights}€
              {selectedHotel?.stars ? ` · ${'★'.repeat(selectedHotel.stars)}` : ''}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hotel className="h-5 w-5" />
            Hébergement
            <span className="text-sm font-normal text-muted-foreground">
              ({nights} nuit{nights > 1 ? 's' : ''})
            </span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 pb-4">
            {hotels.map(hotel => {
              const isSelected = hotel.id === selectedId;
              return (
                <button
                  key={hotel.id}
                  onClick={() => {
                    onSelect(hotel.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full p-3 rounded-lg border text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm truncate">{hotel.name}</h4>
                        {hotel.breakfastIncluded && (
                          <span className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 rounded">
                            Petit-déj
                          </span>
                        )}
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {hotel.stars && hotel.stars > 0 && (
                          <span className="flex items-center gap-0.5">
                            {Array.from({ length: Math.min(hotel.stars, 5) }).map((_, i) => (
                              <Star key={i} className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
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
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm">
                        {hotel.pricePerNight}€<span className="text-[10px] font-normal text-muted-foreground">/nuit</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Total: {hotel.totalPrice || hotel.pricePerNight * nights}€
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t">
          <Button variant="outline" size="sm" className="gap-1 text-xs flex-1" asChild>
            <a href={searchLinks.googleHotels} target="_blank" rel="noopener noreferrer">
              <Search className="h-3 w-3" />
              Google Hotels
            </a>
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-xs flex-1" asChild>
            <a href={searchLinks.booking} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
              Booking.com
            </a>
          </Button>
          {selectedHotel?.bookingUrl && (
            <Button size="sm" className="gap-1 text-xs flex-1" asChild>
              <a href={selectedHotel.bookingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                Réserver
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
