'use client';

import { useState, useRef } from 'react';
import { Camera, X, MapPin, Loader2, Eye, EyeOff } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';

interface PhotoUploaderProps {
  tripId: string;
  dayNumber?: number;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  onUploadComplete?: (photo: any) => void;
}

export function PhotoUploader({
  tripId,
  dayNumber,
  locationName,
  latitude,
  longitude,
  onUploadComplete,
}: PhotoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    try {
      const supabase = getSupabaseClient();
      const ext = file.name.split('.').pop();
      const path = `${tripId}/${Date.now()}.${ext}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('trip-photos')
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('trip-photos')
        .getPublicUrl(path);

      // Extract EXIF geolocation if available
      let photoLat = latitude;
      let photoLng = longitude;

      // Save metadata
      const response = await fetch(`/api/trips/${tripId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storage_path: path,
          caption,
          latitude: photoLat,
          longitude: photoLng,
          location_name: locationName,
          day_number: dayNumber,
          visibility,
          media_type: file.type.startsWith('video/') ? 'video' : 'image',
          file_size: file.size,
        }),
      });

      if (!response.ok) throw new Error('Erreur sauvegarde');

      const photo = await response.json();
      onUploadComplete?.(photo);

      // Reset
      setFile(null);
      setPreview(null);
      setCaption('');
    } catch (e) {
      console.error('Upload error:', e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!preview ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[#2a2a38] text-gray-400 hover:border-indigo-500/50 hover:text-indigo-400 transition-colors"
        >
          <Camera className="w-5 h-5" />
          Ajouter une photo
        </button>
      ) : (
        <div className="bg-[#1a1a24] rounded-xl overflow-hidden">
          <div className="relative">
            <img src={preview} alt="Preview" className="w-full max-h-48 object-cover" />
            <button
              onClick={() => { setFile(null); setPreview(null); }}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <div className="p-3 space-y-3">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Légende..."
              className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none"
            />

            {locationName && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin className="w-3 h-3" /> {locationName}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setVisibility(v => v === 'public' ? 'private' : 'public')}
                className="flex items-center gap-1.5 text-xs text-gray-400"
              >
                {visibility === 'public' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {visibility === 'public' ? 'Public' : 'Privé'}
              </button>

              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
