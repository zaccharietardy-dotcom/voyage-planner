'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Wallet,
  Plane,
  Hotel,
  Utensils,
  Camera,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Star,
  Navigation,
  Share2,
} from 'lucide-react';
import type { Trip, TripDay, TripItem } from '@/lib/types';

const ITEM_TYPE_ICONS: Record<string, any> = {
  activity: Camera,
  restaurant: Utensils,
  hotel: Hotel,
  transport: Navigation,
  flight: Plane,
  parking: MapPin,
  checkin: Hotel,
  checkout: Hotel,
  luggage: MapPin,
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  activity: 'bg-blue-500',
  restaurant: 'bg-orange-500',
  hotel: 'bg-purple-500',
  transport: 'bg-green-500',
  flight: 'bg-pink-500',
  parking: 'bg-gray-500',
  checkin: 'bg-purple-500',
  checkout: 'bg-purple-500',
  luggage: 'bg-amber-500',
};

export default function TripPage() {
  const params = useParams();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<number | null>(1);

  useEffect(() => {
    // Charger le voyage depuis localStorage
    const storedTrip = localStorage.getItem('currentTrip');
    if (storedTrip) {
      try {
        const parsedTrip = JSON.parse(storedTrip);
        // Vérifier que c'est le bon voyage
        if (parsedTrip.id === params.id) {
          setTrip(parsedTrip);
        }
      } catch (e) {
        console.error('Erreur parsing trip:', e);
      }
    }
    setLoading(false);
  }, [params.id]);

  if (loading) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Chargement du voyage...</p>
          </div>
        </div>
      </V2Layout>
    );
  }

  if (!trip) {
    return (
      <V2Layout>
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
          <div className="text-center">
            <MapPin className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Voyage introuvable</h2>
            <p className="text-gray-400 mb-6">Ce voyage n'existe pas ou a expiré.</p>
            <button
              onClick={() => router.push('/v2/create')}
              className="px-6 py-3 rounded-xl bg-indigo-500 text-white font-medium"
            >
              Créer un nouveau voyage
            </button>
          </div>
        </div>
      </V2Layout>
    );
  }

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(price);
  };

  return (
    <V2Layout>
      <div className="min-h-screen pb-24">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-6 px-4">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => router.push('/v2')}
              className="p-2 rounded-full bg-white/20 backdrop-blur-sm"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white">
                {trip.preferences.origin} → {trip.preferences.destination}
              </h1>
              <p className="text-white/70 text-sm">
                {trip.days?.length || trip.preferences.durationDays} jours de voyage
              </p>
            </div>
            <button className="p-2 rounded-full bg-white/20 backdrop-blur-sm">
              <Share2 className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Trip summary */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <Calendar className="w-4 h-4 text-white/70 mx-auto mb-1" />
              <p className="text-white text-xs font-medium">
                {formatDate(trip.preferences.startDate)}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <Users className="w-4 h-4 text-white/70 mx-auto mb-1" />
              <p className="text-white text-xs font-medium">
                {trip.preferences.groupSize} pers.
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <Wallet className="w-4 h-4 text-white/70 mx-auto mb-1" />
              <p className="text-white text-xs font-medium capitalize">
                {trip.preferences.budgetLevel}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2 text-center">
              <Star className="w-4 h-4 text-white/70 mx-auto mb-1" />
              <p className="text-white text-xs font-medium">
                {formatPrice(trip.totalEstimatedCost || 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 -mt-3 relative z-10">
          {/* Flights section */}
          {(trip.outboundFlight || trip.returnFlight) && (
            <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Plane className="w-5 h-5 text-pink-400" />
                <h3 className="font-medium text-white">Vols</h3>
              </div>
              <div className="space-y-3">
                {trip.outboundFlight && (
                  <FlightCard flight={trip.outboundFlight} type="Aller" />
                )}
                {trip.returnFlight && (
                  <FlightCard flight={trip.returnFlight} type="Retour" />
                )}
              </div>
            </div>
          )}

          {/* Accommodation section */}
          {trip.accommodation && (
            <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Hotel className="w-5 h-5 text-purple-400" />
                <h3 className="font-medium text-white">Hébergement</h3>
              </div>
              <AccommodationCard accommodation={trip.accommodation} />
            </div>
          )}

          {/* Daily itinerary */}
          <div className="space-y-3">
            <h3 className="font-medium text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-400" />
              Itinéraire jour par jour
            </h3>

            {trip.days?.map((day) => (
              <DayCard
                key={day.dayNumber}
                day={day}
                isExpanded={expandedDay === day.dayNumber}
                onToggle={() => setExpandedDay(
                  expandedDay === day.dayNumber ? null : day.dayNumber
                )}
                startDate={trip.preferences.startDate}
              />
            ))}
          </div>

          {/* Cost breakdown */}
          {trip.costBreakdown && (
            <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-5 h-5 text-green-400" />
                <h3 className="font-medium text-white">Budget estimé</h3>
              </div>
              <div className="space-y-2">
                {trip.costBreakdown.flights > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Vols</span>
                    <span className="text-white">{formatPrice(trip.costBreakdown.flights)}</span>
                  </div>
                )}
                {trip.costBreakdown.accommodation > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Hébergement</span>
                    <span className="text-white">{formatPrice(trip.costBreakdown.accommodation)}</span>
                  </div>
                )}
                {trip.costBreakdown.food > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Restauration</span>
                    <span className="text-white">{formatPrice(trip.costBreakdown.food)}</span>
                  </div>
                )}
                {trip.costBreakdown.activities > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Activités</span>
                    <span className="text-white">{formatPrice(trip.costBreakdown.activities)}</span>
                  </div>
                )}
                <div className="border-t border-[#2a2a38] pt-2 mt-2 flex justify-between">
                  <span className="text-white font-medium">Total</span>
                  <span className="text-indigo-400 font-semibold">
                    {formatPrice(trip.totalEstimatedCost || 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </V2Layout>
  );
}

// Flight card component
function FlightCard({ flight, type }: { flight: any; type: string }) {
  return (
    <div className="bg-[#1a1a24] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-indigo-400 font-medium">{type}</span>
        <span className="text-xs text-gray-500">{flight.flightNumber}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-center">
          <p className="text-white font-semibold">{flight.departureTimeDisplay || flight.departureTime?.split('T')[1]?.slice(0,5)}</p>
          <p className="text-xs text-gray-500">{flight.departureAirportCode}</p>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-px bg-[#2a2a38]" />
          <Plane className="w-4 h-4 text-gray-500" />
          <div className="flex-1 h-px bg-[#2a2a38]" />
        </div>
        <div className="text-center">
          <p className="text-white font-semibold">{flight.arrivalTimeDisplay || flight.arrivalTime?.split('T')[1]?.slice(0,5)}</p>
          <p className="text-xs text-gray-500">{flight.arrivalAirportCode}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">
          {Math.floor(flight.duration / 60)}h{flight.duration % 60 > 0 ? `${flight.duration % 60}min` : ''}
          {flight.stops > 0 && ` • ${flight.stops} escale${flight.stops > 1 ? 's' : ''}`}
        </span>
        {flight.bookingUrl && (
          <a
            href={flight.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 flex items-center gap-1"
          >
            Réserver <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// Accommodation card component
function AccommodationCard({ accommodation }: { accommodation: any }) {
  return (
    <div className="bg-[#1a1a24] rounded-xl p-3">
      <div className="flex items-start gap-3">
        {accommodation.photos?.[0] && (
          <img
            src={accommodation.photos[0]}
            alt={accommodation.name}
            className="w-16 h-16 rounded-lg object-cover"
          />
        )}
        <div className="flex-1">
          <h4 className="text-white font-medium">{accommodation.name}</h4>
          <div className="flex items-center gap-2 mt-1">
            {accommodation.stars && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: accommodation.stars }).map((_, i) => (
                  <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />
                ))}
              </div>
            )}
            {accommodation.rating && (
              <span className="text-xs text-gray-400">{accommodation.rating}/10</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 line-clamp-1">{accommodation.address}</p>
        </div>
        <div className="text-right">
          <p className="text-indigo-400 font-semibold">{accommodation.pricePerNight}€</p>
          <p className="text-xs text-gray-500">/nuit</p>
        </div>
      </div>
      {accommodation.bookingUrl && (
        <a
          href={accommodation.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-indigo-500/20 text-indigo-400 text-sm"
        >
          Voir disponibilités <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// Day card component
function DayCard({
  day,
  isExpanded,
  onToggle,
  startDate,
}: {
  day: TripDay;
  isExpanded: boolean;
  onToggle: () => void;
  startDate: Date | string;
}) {
  const dayDate = new Date(startDate);
  dayDate.setDate(dayDate.getDate() + day.dayNumber - 1);

  const formatDayDate = () => {
    return dayDate.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  return (
    <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <span className="text-indigo-400 font-semibold">{day.dayNumber}</span>
          </div>
          <div className="text-left">
            <p className="text-white font-medium">Jour {day.dayNumber}</p>
            <p className="text-xs text-gray-500 capitalize">{formatDayDate()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {day.totalCost && (
            <span className="text-xs text-gray-400">{day.totalCost}€</span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {day.items?.map((item, index) => (
                <TripItemCard key={item.id || index} item={item} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Trip item card component
function TripItemCard({ item }: { item: TripItem }) {
  const Icon = ITEM_TYPE_ICONS[item.type] || Camera;
  const colorClass = ITEM_TYPE_COLORS[item.type] || 'bg-gray-500';

  return (
    <div className="flex gap-3">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="w-0.5 flex-1 bg-[#2a2a38] mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white font-medium">{item.title}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3" />
              {item.startTime} - {item.endTime}
            </p>
          </div>
          {item.estimatedCost !== undefined && item.estimatedCost > 0 && (
            <span className="text-xs text-indigo-400">{item.estimatedCost}€</span>
          )}
        </div>

        {item.description && (
          <p className="text-sm text-gray-400 mt-1 line-clamp-2">{item.description}</p>
        )}

        {item.locationName && (
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {item.locationName}
          </p>
        )}

        {(item.bookingUrl || item.googleMapsPlaceUrl) && (
          <div className="flex gap-2 mt-2">
            {item.googleMapsPlaceUrl && (
              <a
                href={item.googleMapsPlaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 flex items-center gap-1 hover:text-white"
              >
                <Navigation className="w-3 h-3" /> Maps
              </a>
            )}
            {item.bookingUrl && (
              <a
                href={item.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Réserver
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
