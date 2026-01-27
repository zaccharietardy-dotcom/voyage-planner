'use client';

import { motion } from 'framer-motion';
import { Star, MapPin, Calendar } from 'lucide-react';
import { Traveler } from '@/lib/v2/mockData';

interface TravelerCardProps {
  traveler: Traveler;
  onClick?: () => void;
  variant?: 'compact' | 'full';
}

export function TravelerCard({ traveler, onClick, variant = 'compact' }: TravelerCardProps) {
  if (variant === 'compact') {
    return (
      <motion.div
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className="flex items-center gap-3 p-3 rounded-xl bg-[#12121a]/60 backdrop-blur-lg border border-[#2a2a38] cursor-pointer"
      >
        <div className="relative">
          <img
            src={traveler.avatar}
            alt={traveler.name}
            className="w-12 h-12 rounded-full border-2 border-indigo-500/50"
          />
          {traveler.isOnline && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#12121a]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{traveler.name}</p>
          <div className="flex items-center gap-1 text-gray-400 text-sm">
            <MapPin className="w-3 h-3" />
            <span className="truncate">{traveler.location.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-amber-400">
          <Star className="w-4 h-4 fill-current" />
          <span className="text-sm font-medium">{traveler.rating}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="rounded-xl bg-[#12121a] border border-[#2a2a38] overflow-hidden cursor-pointer"
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={traveler.avatar}
              alt={traveler.name}
              className="w-14 h-14 rounded-full border-2 border-indigo-500"
            />
            {traveler.isOnline && (
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-[#12121a]" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold">{traveler.name}</p>
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <MapPin className="w-3.5 h-3.5" />
              <span>{traveler.location.name}, {traveler.location.country}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-gray-300">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="text-sm">{traveler.tripDates}</span>
          </div>
          <div className="flex items-center gap-1 text-amber-400">
            <Star className="w-4 h-4 fill-current" />
            <span className="text-sm font-medium">{traveler.rating}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {traveler.itinerary.map((stop, index) => (
            <span
              key={index}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
            >
              {stop}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
