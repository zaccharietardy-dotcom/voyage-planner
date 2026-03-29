'use client';

import { useState, useMemo } from 'react';
import { Trip, TripDay } from '@/lib/types';
import { Attraction } from '@/lib/services/attractions';
import { Search, Plus, Star, Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActivityPoolProps {
  trip: Trip;
  onAddToDay: (attraction: Attraction, dayNumber: number) => void;
  className?: string;
}

export function ActivityPool({ trip, onAddToDay, className }: ActivityPoolProps) {
  const [search, setSearch] = useState('');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Get unused attractions from the pool
  const unusedAttractions = useMemo(() => {
    if (!trip.attractionPool?.length) return [];
    const usedTitles = new Set(
      trip.days.flatMap((d) => d.items.map((i) => i.title.toLowerCase()))
    );
    return trip.attractionPool.filter(
      (a) => !usedTitles.has(a.name.toLowerCase())
    );
  }, [trip.attractionPool, trip.days]);

  const filtered = useMemo(() => {
    if (!search.trim()) return unusedAttractions;
    const q = search.toLowerCase();
    return unusedAttractions.filter(
      (a) => a.name.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
    );
  }, [unusedAttractions, search]);

  if (!trip.attractionPool?.length) {
    return (
      <div className={cn("flex items-center justify-center py-8 text-white/50 text-sm", className)}>
        Aucune activité dans le pool
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
        <input
          type="text"
          placeholder="Rechercher une activité..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#c5a059]/50"
        />
      </div>

      {/* Results count */}
      <p className="text-xs text-white/50">
        {filtered.length} activité{filtered.length !== 1 ? 's' : ''} disponible{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* Attraction list */}
      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
        {filtered.map((attraction) => (
          <div
            key={attraction.name}
            className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/10 hover:border-[#c5a059]/30 transition-colors"
          >
            {/* Image */}
            {attraction.imageUrl && (
              <img
                src={attraction.imageUrl}
                alt={attraction.name}
                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
              />
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-white truncate">{attraction.name}</h4>

              <div className="flex items-center gap-3 mt-1 text-xs text-white/60">
                {attraction.rating > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Star className="h-3 w-3 text-[#c5a059]" />
                    {attraction.rating.toFixed(1)}
                  </span>
                )}
                {attraction.duration > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {attraction.duration}min
                  </span>
                )}
                {attraction.type && (
                  <span className="flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" />
                    {attraction.type}
                  </span>
                )}
              </div>

              {/* Day selector + add button */}
              <div className="flex items-center gap-2 mt-2">
                <select
                  value={selectedDay ?? ''}
                  onChange={(e) => setSelectedDay(e.target.value ? Number(e.target.value) : null)}
                  className="text-xs bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-white focus:outline-none"
                >
                  <option value="">Jour...</option>
                  {trip.days.map((day) => (
                    <option key={day.dayNumber} value={day.dayNumber}>
                      Jour {day.dayNumber}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (selectedDay != null) {
                      onAddToDay(attraction, selectedDay);
                    }
                  }}
                  disabled={selectedDay == null}
                  className="flex items-center gap-1 text-xs font-medium text-[#c5a059] hover:text-[#d4af6a] disabled:text-white/30 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-center text-white/60 text-sm py-4">
            Aucun résultat pour &ldquo;{search}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
