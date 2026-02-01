'use client';

import { useState, useEffect } from 'react';
import { MapPin, Eye, EyeOff, X } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';

interface Photo {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  day_number: number | null;
  visibility: 'public' | 'private';
  media_type: string;
  created_at: string;
}

interface PhotoGalleryProps {
  tripId: string;
  isOwner?: boolean;
}

export function PhotoGallery({ tripId, isOwner = false }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    fetchPhotos();
  }, [tripId]);

  const fetchPhotos = async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}/photos`);
      if (response.ok) {
        setPhotos(await response.json());
      }
    } catch (e) {
      console.error('Error fetching photos:', e);
    } finally {
      setLoading(false);
    }
  };

  const getPhotoUrl = (path: string) => {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage.from('trip-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  const toggleVisibility = async (photo: Photo) => {
    const newVisibility = photo.visibility === 'public' ? 'private' : 'public';
    try {
      await fetch(`/api/trips/${tripId}/photos/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      setPhotos(prev => prev.map(p =>
        p.id === photo.id ? { ...p, visibility: newVisibility } : p
      ));
    } catch (e) {
      console.error('Error updating visibility:', e);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="aspect-square bg-[#1a1a24] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) return null;

  // Group by day
  const byDay = photos.reduce<Record<number, Photo[]>>((acc, p) => {
    const day = p.day_number || 0;
    if (!acc[day]) acc[day] = [];
    acc[day].push(p);
    return acc;
  }, {});

  return (
    <>
      <div className="space-y-4">
        {Object.entries(byDay).map(([day, dayPhotos]) => (
          <div key={day}>
            {parseInt(day) > 0 && (
              <p className="text-xs text-gray-500 mb-2 font-medium">Jour {day}</p>
            )}
            <div className="grid grid-cols-3 gap-1">
              {dayPhotos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setSelectedPhoto(photo)}
                  className="relative aspect-square rounded-lg overflow-hidden group"
                >
                  <img
                    src={getPhotoUrl(photo.thumbnail_path || photo.storage_path)}
                    alt={photo.caption || ''}
                    className="w-full h-full object-cover"
                  />
                  {photo.visibility === 'private' && (
                    <div className="absolute top-1 right-1 p-0.5 rounded bg-black/50">
                      <EyeOff className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Full-screen viewer */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col"
          >
            <div className="flex items-center justify-between p-4">
              <button onClick={() => setSelectedPhoto(null)} className="p-2">
                <X className="w-6 h-6 text-white" />
              </button>
              {isOwner && (
                <button
                  onClick={() => toggleVisibility(selectedPhoto)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm"
                >
                  {selectedPhoto.visibility === 'public' ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  {selectedPhoto.visibility === 'public' ? 'Public' : 'Privé'}
                </button>
              )}
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
              <img
                src={getPhotoUrl(selectedPhoto.storage_path)}
                alt={selectedPhoto.caption || ''}
                className="max-w-full max-h-full object-contain"
              />
            </div>

            <div className="p-4">
              {selectedPhoto.caption && (
                <p className="text-white text-sm mb-1">{selectedPhoto.caption}</p>
              )}
              {selectedPhoto.location_name && (
                <p className="text-gray-400 text-xs flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {selectedPhoto.location_name}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
