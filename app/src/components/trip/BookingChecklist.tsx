'use client';

import { Trip, TripItem, Flight, Accommodation } from '@/lib/types';
import {
  Plane,
  Bed,
  MapPin,
  ExternalLink,
  Check,
  AlertCircle,
  Calendar,
  Clock,
  Star,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface BookingChecklistProps {
  trip: Trip;
}

interface BookableItem {
  id: string;
  category: 'flight' | 'hotel' | 'activity';
  subType?: 'outbound' | 'return';
  title: string;
  subtitle?: string;
  date?: string;
  time?: string;
  price?: number;
  priceLabel?: string;
  bookingUrl?: string;
  provider?: string;
  dayNumber?: number;
}

function getProviderFromUrl(url: string): { name: string; color: string } {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('booking.com')) return { name: 'Booking.com', color: 'bg-blue-600 hover:bg-blue-700' };
  if (urlLower.includes('airbnb.com')) return { name: 'Airbnb', color: 'bg-pink-500 hover:bg-pink-600' };
  if (urlLower.includes('viator.com')) return { name: 'Viator', color: 'bg-green-600 hover:bg-green-700' };
  if (urlLower.includes('tiqets.com')) return { name: 'Tiqets', color: 'bg-orange-500 hover:bg-orange-600' };
  if (urlLower.includes('aviasales.com')) return { name: 'Aviasales', color: 'bg-orange-500 hover:bg-orange-600' };
  if (urlLower.includes('google.com/travel')) return { name: 'Google', color: 'bg-blue-500 hover:bg-blue-600' };
  return { name: 'Voir', color: 'bg-primary hover:bg-primary/90' };
}

function extractBookableItems(trip: Trip): BookableItem[] {
  const items: BookableItem[] = [];

  // Vol aller
  if (trip.outboundFlight) {
    const f = trip.outboundFlight;
    items.push({
      id: `flight-outbound-${f.id}`,
      category: 'flight',
      subType: 'outbound',
      title: `${f.departureCity} → ${f.arrivalCity}`,
      subtitle: `${f.airline} ${f.flightNumber} · ${f.stops === 0 ? 'Direct' : `${f.stops} escale${f.stops > 1 ? 's' : ''}`}`,
      date: f.departureTime ? format(new Date(f.departureTime), 'EEEE d MMMM', { locale: fr }) : undefined,
      time: f.departureTimeDisplay || f.departureTime?.split('T')[1]?.slice(0, 5),
      price: f.pricePerPerson || f.price,
      priceLabel: f.pricePerPerson ? '/pers.' : 'total',
      bookingUrl: f.bookingUrl,
    });
  }

  // Hebergement
  if (trip.accommodation) {
    const h = trip.accommodation;
    const checkInDate = trip.days[0]?.date;
    const checkOutDate = trip.days[trip.days.length - 1]?.date;
    items.push({
      id: `hotel-${h.id}`,
      category: 'hotel',
      title: h.name,
      subtitle: `${h.stars ? `${h.stars}★` : ''} ${h.rating ? `${h.rating.toFixed(1)}/10` : ''} · ${h.address && h.address !== 'Adresse non disponible' ? h.address : 'Centre-ville'}`.trim(),
      date: checkInDate ? `${format(new Date(checkInDate), 'd MMM', { locale: fr })} → ${checkOutDate ? format(new Date(checkOutDate), 'd MMM', { locale: fr }) : ''}` : undefined,
      price: h.totalPrice || (h.pricePerNight ? h.pricePerNight * (trip.preferences.durationDays - 1) : undefined),
      priceLabel: 'total',
      bookingUrl: h.bookingUrl,
    });
  }

  // Activites par jour
  for (const day of trip.days) {
    for (const item of day.items) {
      if (item.type !== 'activity' && item.type !== 'restaurant') continue;
      const url = item.bookingUrl || item.viatorUrl || item.tiqetsUrl;
      if (!url) continue;

      items.push({
        id: `activity-${item.id}`,
        category: 'activity',
        title: item.title,
        subtitle: item.locationName,
        date: day.date ? format(new Date(day.date), 'EEEE d MMMM', { locale: fr }) : undefined,
        time: item.startTime,
        price: item.estimatedCost,
        priceLabel: '/pers.',
        bookingUrl: url,
        dayNumber: day.dayNumber,
      });
    }
  }

  // Vol retour
  if (trip.returnFlight) {
    const f = trip.returnFlight;
    items.push({
      id: `flight-return-${f.id}`,
      category: 'flight',
      subType: 'return',
      title: `${f.departureCity} → ${f.arrivalCity}`,
      subtitle: `${f.airline} ${f.flightNumber} · ${f.stops === 0 ? 'Direct' : `${f.stops} escale${f.stops > 1 ? 's' : ''}`}`,
      date: f.departureTime ? format(new Date(f.departureTime), 'EEEE d MMMM', { locale: fr }) : undefined,
      time: f.departureTimeDisplay || f.departureTime?.split('T')[1]?.slice(0, 5),
      price: f.pricePerPerson || f.price,
      priceLabel: f.pricePerPerson ? '/pers.' : 'total',
      bookingUrl: f.bookingUrl,
    });
  }

  return items;
}

function CategoryIcon({ category }: { category: BookableItem['category'] }) {
  switch (category) {
    case 'flight':
      return <Plane className="h-5 w-5" />;
    case 'hotel':
      return <Bed className="h-5 w-5" />;
    case 'activity':
      return <MapPin className="h-5 w-5" />;
  }
}

function categoryColor(category: BookableItem['category']): string {
  switch (category) {
    case 'flight': return '#EC4899';
    case 'hotel': return '#8B5CF6';
    case 'activity': return '#3B82F6';
  }
}

export function BookingChecklist({ trip }: BookingChecklistProps) {
  const items = extractBookableItems(trip);

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <AlertCircle className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p>Aucune reservation disponible pour ce voyage.</p>
        <p className="text-sm mt-1">Les liens de reservation apparaitront ici une fois le voyage genere.</p>
      </div>
    );
  }

  // Group items by section
  const outboundFlight = items.filter(i => i.category === 'flight' && i.subType === 'outbound');
  const hotel = items.filter(i => i.category === 'hotel');
  const activities = items.filter(i => i.category === 'activity');
  const returnFlight = items.filter(i => i.category === 'flight' && i.subType === 'return');

  // Group activities by day
  const activitiesByDay = activities.reduce<Record<number, BookableItem[]>>((acc, item) => {
    const day = item.dayNumber || 0;
    if (!acc[day]) acc[day] = [];
    acc[day].push(item);
    return acc;
  }, {});

  const totalBookable = items.length;
  const totalWithLinks = items.filter(i => i.bookingUrl).length;

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-foreground">Checklist de reservation</h3>
          <span className="text-sm text-muted-foreground">
            {totalWithLinks}/{totalBookable} liens disponibles
          </span>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${totalBookable > 0 ? (totalWithLinks / totalBookable) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Vol aller */}
      {outboundFlight.length > 0 && (
        <Section title="Vol aller" icon={<Plane className="h-4 w-4" />} color="#EC4899">
          {outboundFlight.map(item => (
            <BookingCard key={item.id} item={item} />
          ))}
        </Section>
      )}

      {/* Hebergement */}
      {hotel.length > 0 && (
        <Section title="Hebergement" icon={<Bed className="h-4 w-4" />} color="#8B5CF6">
          {hotel.map(item => (
            <BookingCard key={item.id} item={item} />
          ))}
        </Section>
      )}

      {/* Activites par jour */}
      {Object.entries(activitiesByDay)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([dayNum, dayItems]) => {
          const day = trip.days.find(d => d.dayNumber === Number(dayNum));
          const dateStr = day?.date ? format(new Date(day.date), 'EEEE d MMMM', { locale: fr }) : '';
          return (
            <Section
              key={`day-${dayNum}`}
              title={`Jour ${dayNum}${dateStr ? ` - ${dateStr}` : ''}`}
              icon={<Calendar className="h-4 w-4" />}
              color="#3B82F6"
            >
              {dayItems.map(item => (
                <BookingCard key={item.id} item={item} />
              ))}
            </Section>
          );
        })}

      {/* Vol retour */}
      {returnFlight.length > 0 && (
        <Section title="Vol retour" icon={<Plane className="h-4 w-4" />} color="#EC4899">
          {returnFlight.map(item => (
            <BookingCard key={item.id} item={item} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, color, children }: {
  title: string;
  icon: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div
          className="p-1.5 rounded-lg"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {icon}
        </div>
        <h4 className="font-semibold text-foreground text-sm">{title}</h4>
      </div>
      <div className="space-y-2 pl-1">
        {children}
      </div>
    </div>
  );
}

function BookingCard({ item }: { item: BookableItem }) {
  const color = categoryColor(item.category);
  const provider = item.bookingUrl ? getProviderFromUrl(item.bookingUrl) : null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
      {/* Status indicator */}
      <div className="flex-shrink-0">
        {item.bookingUrl ? (
          <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
            <Check className="h-4 w-4 text-green-500" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-[10px] font-medium px-1.5 py-0 rounded-full"
            style={{ backgroundColor: `${color}20`, color }}
          >
            <CategoryIcon category={item.category} />
          </span>
          <h5 className="font-medium text-foreground text-sm truncate">{item.title}</h5>
        </div>
        {item.subtitle && (
          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {item.date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {item.date}
            </span>
          )}
          {item.time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.time}
            </span>
          )}
        </div>
      </div>

      {/* Price */}
      {item.price != null && item.price > 0 && (
        <div className="flex-shrink-0 text-right">
          <span className="text-sm font-semibold text-foreground">{item.price}€</span>
          {item.priceLabel && (
            <span className="text-[10px] text-muted-foreground block">{item.priceLabel}</span>
          )}
        </div>
      )}

      {/* Booking button */}
      {item.bookingUrl && provider && (
        <a
          href={item.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white transition-colors ${provider.color}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {provider.name}
        </a>
      )}

      {!item.bookingUrl && (
        <span className="flex-shrink-0 text-xs text-muted-foreground/60 italic">
          Pas de lien
        </span>
      )}
    </div>
  );
}
