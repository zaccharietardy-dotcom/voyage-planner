'use client';

import { motion } from 'framer-motion';
import { Heart, MessageCircle, Share2, MapPin } from 'lucide-react';

interface TripFeedCardProps {
  trip: {
    id: string;
    user: {
      name: string;
      avatar: string;
    };
    destination: string;
    image: string;
    likes: number;
    comments: number;
    timeAgo: string;
  };
  onClick?: () => void;
}

export function TripFeedCard({ trip, onClick }: TripFeedCardProps) {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="rounded-xl bg-[#0d1f35] border border-[#1e3a5f] overflow-hidden cursor-pointer transition-all duration-300 hover:border-[#d4a853]/30 hover:shadow-[0_0_25px_rgba(212,168,83,0.1)]"
    >
      {/* Image */}
      <div className="relative aspect-[4/3]">
        <img
          src={trip.image}
          alt={trip.destination}
          className="w-full h-full object-cover"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a1628] via-transparent to-transparent" />

        {/* Destination badge */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a1628]/80 backdrop-blur-sm border border-[#d4a853]/30">
            <MapPin className="w-3.5 h-3.5 text-[#d4a853]" />
            <span className="text-white font-semibold text-sm">{trip.destination}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* User info */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <img
              src={trip.user.avatar}
              alt={trip.user.name}
              className="w-8 h-8 rounded-full border-2 border-[#d4a853]/40"
            />
          </div>
          <div className="flex-1">
            <p className="text-white text-sm font-medium">{trip.user.name}</p>
            <p className="text-[#6b8aab] text-xs">{trip.timeAgo}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#1e3a5f]">
          <button className="flex items-center gap-1.5 text-[#a8c0d8] hover:text-[#d4a853] transition-colors group">
            <Heart className="w-4 h-4 group-hover:fill-[#d4a853]/20" />
            <span className="text-sm">{trip.likes}</span>
          </button>
          <button className="flex items-center gap-1.5 text-[#a8c0d8] hover:text-[#d4a853] transition-colors">
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm">{trip.comments}</span>
          </button>
          <button className="ml-auto text-[#a8c0d8] hover:text-[#d4a853] transition-colors">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
