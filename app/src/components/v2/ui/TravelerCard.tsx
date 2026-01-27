'use client';

import { motion } from 'framer-motion';
import { Star, MapPin, Calendar, Sparkles } from 'lucide-react';
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
        whileHover={{ y: -2 }}
        onClick={onClick}
        className="flex items-center gap-3 p-3 rounded-xl bg-[#0d1f35]/80 backdrop-blur-lg border border-[#1e3a5f] cursor-pointer transition-all duration-300 hover:border-[#d4a853]/30 hover:shadow-[0_0_20px_rgba(212,168,83,0.1)]"
      >
        <div className="relative">
          <img
            src={traveler.avatar}
            alt={traveler.name}
            className="w-12 h-12 rounded-full border-2 border-[#d4a853]/40"
          />
          {traveler.isOnline && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0d1f35] shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{traveler.name}</p>
          <div className="flex items-center gap-1 text-[#a8c0d8] text-sm">
            <MapPin className="w-3 h-3 text-[#d4a853]/70" />
            <span className="truncate">{traveler.location.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[#d4a853]">
          <Star className="w-4 h-4 fill-current" />
          <span className="text-sm font-medium">{traveler.rating}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="rounded-xl bg-[#0d1f35] border border-[#1e3a5f] overflow-hidden cursor-pointer transition-all duration-300 hover:border-[#d4a853]/30 hover:shadow-[0_0_25px_rgba(212,168,83,0.1)]"
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={traveler.avatar}
              alt={traveler.name}
              className="w-14 h-14 rounded-full border-2 border-[#d4a853]/50"
            />
            {traveler.isOnline && (
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#0d1f35] shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-white font-semibold">{traveler.name}</p>
            <div className="flex items-center gap-2 text-[#a8c0d8] text-sm">
              <MapPin className="w-3.5 h-3.5 text-[#d4a853]/70" />
              <span>{traveler.location.name}, {traveler.location.country}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[#a8c0d8]">
            <Calendar className="w-4 h-4 text-[#6b8aab]" />
            <span className="text-sm">{traveler.tripDates}</span>
          </div>
          <div className="flex items-center gap-1 text-[#d4a853]">
            <Star className="w-4 h-4 fill-current" />
            <span className="text-sm font-medium">{traveler.rating}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {traveler.itinerary.map((stop, index) => (
            <span
              key={index}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#d4a853]/10 text-[#e8c068] border border-[#d4a853]/20"
            >
              {stop}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
