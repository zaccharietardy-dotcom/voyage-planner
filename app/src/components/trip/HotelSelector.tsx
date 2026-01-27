'use client';

import { Hotel, Search, ExternalLink, AlertTriangle, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accommodation } from '@/lib/types';
import { HotelOption } from './HotelOption';

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

export function HotelSelector({
  hotels,
  selectedId,
  onSelect,
  searchLinks,
  nights,
}: HotelSelectorProps) {
  const selectedHotel = hotels.find(h => h.id === selectedId) || hotels[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Hotel className="h-5 w-5" />
          Hébergement
          <span className="text-sm font-normal text-muted-foreground">
            ({nights} nuit{nights > 1 ? 's' : ''})
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Info box */}
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-blue-800">
              Sélectionnez un hôtel ci-dessous ou recherchez d'autres options.
            </p>
            <p className="text-blue-700 text-xs mt-1">
              Les prix sont indicatifs. Vérifiez la disponibilité avant de réserver.
            </p>
          </div>
        </div>

        {/* Hotel list */}
        <div className="space-y-2">
          {hotels.map(hotel => (
            <HotelOption
              key={hotel.id}
              hotel={hotel}
              isSelected={hotel.id === selectedId}
              onSelect={() => onSelect(hotel.id)}
            />
          ))}
        </div>

        {/* Search links */}
        <div className="pt-3 border-t">
          <p className="text-sm text-muted-foreground mb-2">
            Chercher d'autres hôtels :
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={searchLinks.googleHotels}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1"
              >
                <Search className="h-4 w-4" />
                Google Hotels
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href={searchLinks.booking}
                target="_blank"
                rel="noopener noreferrer"
                className="gap-1"
              >
                <ExternalLink className="h-4 w-4" />
                Booking.com
              </a>
            </Button>
          </div>
        </div>

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-amber-800">
            La disponibilité peut varier. Vérifiez sur le site de réservation avant de confirmer.
          </p>
        </div>

        {/* Selected hotel summary with booking link */}
        {selectedHotel && (
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-muted-foreground">Hôtel sélectionné :</p>
                <p className="font-medium">{selectedHotel.name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total hébergement</p>
                <p className="text-lg font-bold">
                  {selectedHotel.totalPrice || selectedHotel.pricePerNight * nights}€
                </p>
              </div>
            </div>
            {/* Booking button for selected hotel */}
            {selectedHotel.bookingUrl && (
              <Button className="w-full gap-2" asChild>
                <a
                  href={selectedHotel.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Réserver {selectedHotel.name}
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
