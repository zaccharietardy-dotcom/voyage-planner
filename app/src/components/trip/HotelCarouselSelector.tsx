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
  };
}

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

  // S'assurer que l'hôtel sélectionné est visible en premier
  const selectedHotel = visibleHotels.find(h => h.id === selectedId);
  const otherHotels = visibleHotels.filter(h => h.id !== selectedId);
  const sortedHotels = selectedHotel ? [selectedHotel, ...otherHotels] : visibleHotels;

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

  return (
    <div className="space-y-4">
      {/* Header avec titre et navigation */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Choisir votre hôtel</h3>
          <p className="text-sm text-gray-500">{visibleHotels.length} hôtels disponibles pour {nights} nuit{nights > 1 ? 's' : ''}</p>
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
              Plus sur Booking <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {/* Boutons de navigation */}
          <button
            onClick={() => scroll('left')}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Défiler à gauche"
          >
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
            aria-label="Défiler à droite"
          >
            <ChevronRight className="h-5 w-5 text-gray-600" />
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
              rounded-xl border-2 transition-all cursor-pointer
              hover:shadow-lg
              ${selectedId === hotel.id
                ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50'
                : 'border-gray-200 hover:border-gray-300 bg-white'}
            `}
            onClick={() => onSelect(hotel.id)}
          >
            {/* Badge sélectionné */}
            {selectedId === hotel.id && (
              <div className="absolute -top-2 -right-2 z-10 bg-blue-500 text-white rounded-full p-1.5 shadow-md">
                <Check className="h-4 w-4" />
              </div>
            )}

            {/* Badge position (si premier = recommandé) */}
            {index === 0 && selectedId !== hotel.id && (
              <div className="absolute -top-2 -left-2 z-10 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full shadow-md">
                Recommandé
              </div>
            )}

            {/* Bouton archiver */}
            <button
              onClick={(e) => handleArchive(e, hotel.id)}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-white/90 hover:bg-white shadow-sm transition-colors z-10"
              title="Masquer cet hôtel"
            >
              <Archive className="h-4 w-4 text-gray-400 hover:text-gray-600" />
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
              <h4 className="font-semibold text-gray-900 truncate pr-8" title={hotel.name}>
                {hotel.name}
              </h4>

              {/* Étoiles et note */}
              <div className="flex items-center gap-2 mt-1.5">
                {renderStars(hotel.stars)}
                {hotel.rating && (
                  <span className="text-sm text-gray-600 font-medium">
                    {hotel.rating.toFixed(1)}/10
                  </span>
                )}
                {hotel.reviewCount && hotel.reviewCount > 0 && (
                  <span className="text-xs text-gray-400">
                    ({hotel.reviewCount} avis)
                  </span>
                )}
              </div>

              {/* Adresse */}
              <div className="flex items-start gap-1 mt-2">
                <MapPin className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 line-clamp-2">
                  {hotel.address && hotel.address !== 'Adresse non disponible'
                    ? hotel.address
                    : 'Centre-ville'}
                </p>
              </div>

              {/* Petit-déjeuner */}
              {hotel.breakfastIncluded && (
                <div className="mt-2">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    Petit-déj inclus
                  </span>
                </div>
              )}

              {/* Prix */}
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-end">
                <div>
                  <span className="text-xl font-bold text-gray-900">{formatPrice(hotel.pricePerNight)}</span>
                  <span className="text-sm text-gray-500">/nuit</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-700">
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
                  className="mt-3 block w-full text-center bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Voir sur Booking
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Compteur d'hôtels supplémentaires */}
      {visibleHotels.length > 10 && (
        <p className="text-sm text-gray-500 text-center">
          +{visibleHotels.length - 10} autres hôtels disponibles
        </p>
      )}

      {/* Hôtels archivés */}
      {archivedIds.size > 0 && (
        <div className="text-center">
          <button
            onClick={() => setArchivedIds(new Set())}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Afficher les {archivedIds.size} hôtel{archivedIds.size > 1 ? 's' : ''} masqué{archivedIds.size > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
