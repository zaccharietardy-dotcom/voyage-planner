'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MapPin, Calendar, Loader2, Camera } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';

export default function NewPastTripPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [destination, setDestination] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    router.push('/login?redirect=/journal/new');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!destination.trim()) {
      toast.error('Veuillez entrer une destination');
      return;
    }
    if (!tripDate) {
      toast.error('Veuillez entrer une date');
      return;
    }

    setIsSubmitting(true);

    try {
      // Geocode the destination
      let destinationCoords = null;
      setIsGeocoding(true);
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination.trim())}&limit=1`,
          { headers: { 'User-Agent': 'VoyageApp/1.0' } }
        );
        const geoData = await geoRes.json();
        if (geoData.length > 0) {
          destinationCoords = {
            lat: parseFloat(geoData[0].lat),
            lng: parseFloat(geoData[0].lon),
          };
        }
      } catch {
        // Geocoding failed, continue without coords
      }
      setIsGeocoding(false);

      const res = await fetch('/api/trips/past', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim(),
          destinationCoords,
          startDate: tripDate,
          endDate: tripDate,
          title: title.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur lors de la création');
      }

      const trip = await res.json();
      toast.success('Voyage créé ! Ajoutez vos photos.');
      router.push(`/trip/${trip.id}`);
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors de la création du voyage');
    } finally {
      setIsSubmitting(false);
      setIsGeocoding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-lg mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-6">
          <Link href="/mes-voyages">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Ajouter un voyage passé
            </CardTitle>
            <CardDescription>
              Enregistrez un voyage que vous avez déjà fait. Vous pourrez ajouter vos photos ensuite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="destination">
                  <MapPin className="inline h-3.5 w-3.5 mr-1" />
                  Destination
                </Label>
                <Input
                  id="destination"
                  placeholder="ex: Tokyo, Japon"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Titre (optionnel)</Label>
                <Input
                  id="title"
                  placeholder="ex: Road trip au Japon"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tripDate">
                  <Calendar className="inline h-3.5 w-3.5 mr-1" />
                  Date du voyage
                </Label>
                <Input
                  id="tripDate"
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isGeocoding ? 'Géolocalisation...' : 'Création...'}
                  </>
                ) : (
                  'Créer le voyage'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
