'use client';

import { Accommodation } from '@/lib/types';
import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Check, Archive, Star, ExternalLink, MapPin } from 'lucide-react';

interface HotelCarouselSelectorProps {
  hotels: Accommodation[];
  selectedId: string;
  onSelect: (hotelId: string) => void;
  onArchive?: (hotelId: string) => void;
  nights: number;
  searchLinks?: {
    googleHotels?: string;
    booking?: string;
    airbnb?: string;
  };
}

const TIER_CONFIG: Record<string, { label: string; className: string }> = {
  central: { label: 'Central', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
  comfortable: { label: 'Confort', className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30' },
  value: { label: 'Bon plan', className: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
};

export function HotelCarouselSelector({
  hotels,
  selectedId,
  onSelect,
  onArchive,
  nights,
  searchLinks,
}: HotelCarouselSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  // Filtrer les hôtels archivés
  const visibleHotels = hotels.filter(h => !archivedIds.has(h.id));

  // NE PAS réordonner les hôtels quand on clique (comportement contre-intuitif)
  // Garder l'ordre original (généralement par prix ou recommandation)
  const sortedHotels = visibleHotels;

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  const handleArchive = (e: React.MouseEvent, hotelId: string) => {
    e.stopPropagation();
    setArchivedIds(prev => new Set([...prev, hotelId]));
    onArchive?.(hotelId);
  };

  const formatPrice = (price: number | undefined) => {
    if (!price) return '---';
    return `${price}€`;
  };

  const renderStars = (stars: number | undefined) => {
    const count = stars || 3;
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: count }).map((_, i) => (
          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
        ))}
      </div>
    );
  };

  const getProviderLabel = (bookingUrl?: string): string => {
    const lower = bookingUrl?.toLowerCase() || '';
    if (lower.includes('airbnb.com')) return 'Airbnb';
    if (lower.includes('booking.com')) return 'Booking';
    return 'Réserver';
  };

  return (
    <div className="space-y-4">
      {/* Header avec titre et navigation */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Choisir votre hôtel</h3>
          <p className="text-sm text-muted-foreground">{visibleHotels.length} hôtels disponibles pour {nights} nuit{nights > 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Liens de recherche externe */}
          {searchLinks?.booking && (
            <a
              href={searchLinks.booking}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Recherche Booking <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {searchLinks?.airbnb && (
            <a
              href={searchLinks.airbnb}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-rose-500 hover:text-rose-700 flex items-center gap-1"
            >
              Recherche Airbnb <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {/* Boutons de navigation */}
          <button
            onClick={() => scroll('left')}
            className="p-2 rounded-full hover:bg-muted transition-colors"
            aria-label="Défiler à gauche"
          >
            <ChevronLeft className="h-5 w-5 text-muted-foreground" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-2 rounded-full hover:bg-muted transition-colors"
            aria-label="Défiler à droite"
          >
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Carousel d'hôtels */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {sortedHotels.slice(0, 10).map((hotel, index) => (
          <div
            key={hotel.id}
            className={`
              flex-shrink-0 w-72 snap-start relative
              rounded-xl border-2 transition-all duration-200 cursor-pointer
              hover:shadow-lg
              ${selectedId === hotel.id
                ? 'border-primary ring-2 ring-primary/40 shadow-lg shadow-primary/15'
                : 'border-border/50 hover:border-primary/30 opacity-95 hover:opacity-100 bg-card'}
            `}
            onClick={() => onSelect(hotel.id)}
          >
            {/* Badge sélectionné */}
            {selectedId === hotel.id && (
              <div className="absolute top-2 right-2 z-10 bg-emerald-500 rounded-full p-1.5 shadow-lg">
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              </div>
            )}

            {/* Badge tier (si disponible) */}
            {hotel.distanceTier && TIER_CONFIG[hotel.distanceTier] && (
              <div className={`absolute -top-2 -left-2 z-10 text-xs px-2 py-0.5 rounded-full shadow-md font-medium ${TIER_CONFIG[hotel.distanceTier].className}`}>
                {TIER_CONFIG[hotel.distanceTier].label}
              </div>
            )}
            {/* Fallback: Recommandé si pas de tier */}
            {!hotel.distanceTier && index === 0 && selectedId !== hotel.id && (
              <div className="absolute -top-2 -left-2 z-10 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full shadow-md">
                Recommandé
              </div>
            )}

            {/* Bouton archiver */}
            <button
              onClick={(e) => handleArchive(e, hotel.id)}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-card/90 hover:bg-card shadow-sm transition-colors z-10"
              title="Masquer cet hôtel"
            >
              <Archive className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>

            {/* Image de l'hôtel (si disponible) */}
            {hotel.photos && hotel.photos.length > 0 && (
              <div className="h-32 overflow-hidden rounded-t-xl">
                <img
                  src={hotel.photos[0]}
                  alt={hotel.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Contenu de la carte */}
            <div className="p-4">
              {/* Nom de l'hôtel */}
              <h4 className="font-semibold text-foreground truncate pr-8" title={hotel.name}>
                {hotel.name}
              </h4>

              {/* Étoiles et note */}
              <div className="flex items-center gap-2 mt-1.5">
                {renderStars(hotel.stars)}
                {hotel.rating && (
                  <span className="text-sm text-muted-foreground font-medium">
                    {hotel.rating.toFixed(1)}/10
                  </span>
                )}
                {hotel.reviewCount && hotel.reviewCount > 0 && (
                  <span className="text-xs text-muted-foreground/60">
                    ({hotel.reviewCount} avis)
                  </span>
                )}
              </div>

              {/* Adresse */}
              <div className="flex items-start gap-1 mt-2">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {hotel.address && hotel.address !== 'Adresse non disponible'
                    ? hotel.address
                    : 'Centre-ville'}
                </p>
              </div>

              {/* Distance au centre */}
              {hotel.distanceToCenter != null && hotel.distanceToCenter > 0 && (
                <p className="text-xs text-muted-foreground/70 mt-1 ml-4">
                  {hotel.distanceToCenter < 1
                    ? `${Math.round(hotel.distanceToCenter * 1000)}m du centre`
                    : `${hotel.distanceToCenter.toFixed(1)} km du centre`
                  }
                </p>
              )}

              {/* Petit-déjeuner */}
              {hotel.breakfastIncluded && (
                <div className="mt-2">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    Petit-déj inclus
                  </span>
                </div>
              )}

              {/* Prix */}
              <div className="mt-3 pt-3 border-t border-border flex justify-between items-end">
                <div>
                  <span className="text-xl font-bold text-foreground">{formatPrice(hotel.pricePerNight)}</span>
                  <span className="text-sm text-muted-foreground">/nuit</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-foreground/80">
                    Total: {formatPrice((hotel.pricePerNight || 0) * nights)}
                  </span>
                </div>
              </div>

              {/* Lien Booking */}
              {hotel.bookingUrl && (
                <a
                  href={hotel.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-3 block w-full text-center bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  {getProviderLabel(hotel.bookingUrl)}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Compteur d'hôtels supplémentaires */}
      {visibleHotels.length > 10 && (
        <p className="text-sm text-muted-foreground text-center">
          +{visibleHotels.length - 10} autres hôtels disponibles
        </p>
      )}

      {/* Hôtels archivés */}
      {archivedIds.size > 0 && (
        <div className="text-center">
          <button
            onClick={() => setArchivedIds(new Set())}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Afficher les {archivedIds.size} hôtel{archivedIds.size > 1 ? 's' : ''} masqué{archivedIds.size > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
