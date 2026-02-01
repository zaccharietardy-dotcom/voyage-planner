'use client';

import { useState, useRef } from 'react';
import { Camera, X, MapPin, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

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
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caption', caption);
      formData.append('visibility', visibility);
      if (latitude != null) formData.append('latitude', String(latitude));
      if (longitude != null) formData.append('longitude', String(longitude));
      if (locationName) formData.append('location_name', locationName);
      if (dayNumber != null) formData.append('day_number', String(dayNumber));

      const response = await fetch(`/api/trips/${tripId}/photos`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erreur upload' }));
        throw new Error(err.error || 'Erreur upload');
      }

      const photo = await response.json();
      onUploadComplete?.(photo);
      toast.success('Photo ajoutée !');

      setFile(null);
      setPreview(null);
      setCaption('');
    } catch (e: any) {
      console.error('Upload error:', e);
      toast.error(e.message || 'Erreur lors de l\'upload');
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
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
        >
          <Camera className="w-5 h-5" />
          Ajouter une photo
        </button>
      ) : (
        <div className="bg-muted rounded-xl overflow-hidden">
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
            <Input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Légende..."
            />

            {locationName && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="w-3 h-3" /> {locationName}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setVisibility(v => v === 'public' ? 'private' : 'public')}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {visibility === 'public' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {visibility === 'public' ? 'Public' : 'Privé'}
              </button>

              <Button onClick={handleUpload} disabled={uploading} size="sm">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Publier'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
