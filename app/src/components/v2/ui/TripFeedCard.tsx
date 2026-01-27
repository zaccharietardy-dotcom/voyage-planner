'use client';

import { motion } from 'framer-motion';
import { Heart, MessageCircle, Share2 } from 'lucide-react';

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
      onClick={onClick}
      className="rounded-xl bg-[#12121a] border border-[#2a2a38] overflow-hidden cursor-pointer"
    >
      {/* Image */}
      <div className="relative aspect-[4/3]">
        <img
          src={trip.image}
          alt={trip.destination}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-3">
          <p className="text-white font-bold text-lg">{trip.destination}</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* User info */}
        <div className="flex items-center gap-2">
          <img
            src={trip.user.avatar}
            alt={trip.user.name}
            className="w-8 h-8 rounded-full border border-indigo-500/50"
          />
          <div className="flex-1">
            <p className="text-white text-sm font-medium">{trip.user.name}</p>
            <p className="text-gray-500 text-xs">{trip.timeAgo}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#2a2a38]">
          <button className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 transition-colors">
            <Heart className="w-4 h-4" />
            <span className="text-sm">{trip.likes}</span>
          </button>
          <button className="flex items-center gap-1.5 text-gray-400 hover:text-indigo-400 transition-colors">
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm">{trip.comments}</span>
          </button>
          <button className="ml-auto text-gray-400 hover:text-white transition-colors">
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
