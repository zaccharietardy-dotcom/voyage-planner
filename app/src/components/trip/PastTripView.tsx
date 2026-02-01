'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Camera,
  Share2,
  Globe,
  Lock,
  Users2,
  ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { PhotoUploader } from '@/components/photos/PhotoUploader';
import { PhotoGallery } from '@/components/photos/PhotoGallery';
import { cn } from '@/lib/utils';

type TripVisibility = 'public' | 'friends' | 'private';

const VISIBILITY_OPTIONS: { value: TripVisibility; label: string; icon: React.ReactNode }[] = [
  { value: 'public', label: 'Public', icon: <Globe className="h-4 w-4" /> },
  { value: 'friends', label: 'Amis', icon: <Users2 className="h-4 w-4" /> },
  { value: 'private', label: 'Privé', icon: <Lock className="h-4 w-4" /> },
];

interface PastTripViewProps {
  trip: any;
  isOwner: boolean;
}

export function PastTripView({ trip, isOwner }: PastTripViewProps) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<TripVisibility>(trip.visibility || 'private');
  const [photoKey, setPhotoKey] = useState(0);

  const visibilityOption = VISIBILITY_OPTIONS.find(o => o.value === visibility) || VISIBILITY_OPTIONS[2];

  const updateVisibility = async (newVisibility: TripVisibility) => {
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      if (!res.ok) throw new Error();
      setVisibility(newVisibility);
      toast.success(`Voyage maintenant ${VISIBILITY_OPTIONS.find(o => o.value === newVisibility)?.label.toLowerCase()}`);
    } catch {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const startDate = trip.start_date ? new Date(trip.start_date) : null;
  const endDate = trip.end_date ? new Date(trip.end_date) : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-3xl mx-auto px-4 py-8">
        {/* Back button */}
        <Button variant="ghost" onClick={() => router.push('/mes-voyages')} className="mb-6">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Mes voyages
        </Button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-2">
            <div>
              <Badge variant="secondary" className="mb-2">
                <Camera className="h-3 w-3 mr-1" />
                Voyage passé
              </Badge>
              <h1 className="text-2xl font-bold">{trip.title || trip.name}</h1>
            </div>

            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    {visibilityOption.icon}
                    <span className="hidden sm:inline text-xs">{visibilityOption.label}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {VISIBILITY_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => updateVisibility(option.value)}
                      className={cn(visibility === option.value && 'bg-primary/10')}
                    >
                      <span className="mr-2">{option.icon}</span>
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {trip.destination}
            </span>
            {startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(startDate, 'd MMM yyyy', { locale: fr })}
                {endDate && startDate.getTime() !== endDate.getTime() && (
                  <> — {format(endDate, 'd MMM yyyy', { locale: fr })}</>
                )}
              </span>
            )}
            {trip.duration_days && (
              <span>{trip.duration_days} jour{trip.duration_days > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {/* Photo Upload (owner only) */}
        {isOwner && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <PhotoUploader
                tripId={trip.id}
                onUploadComplete={() => setPhotoKey(k => k + 1)}
              />
            </CardContent>
          </Card>
        )}

        {/* Photo Gallery */}
        <PhotoGallery key={photoKey} tripId={trip.id} isOwner={isOwner} />
      </div>
    </div>
  );
}
