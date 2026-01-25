'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Trip, TripItem, TripDay } from '@/lib/types';
import { DayTimeline, CarbonFootprint, TransportOptions } from '@/components/trip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Share2,
  Users,
  Calendar,
  MapPin,
  Wallet,
  Loader2,
  RefreshCw,
  Bug,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Import map dynamically to avoid SSR issues with Leaflet
const TripMap = dynamic(
  () => import('@/components/trip/TripMap').then((mod) => mod.TripMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[400px] bg-muted animate-pulse rounded-lg flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

export default function TripPage() {
  const params = useParams();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [transportChanged, setTransportChanged] = useState(false);
  const [originalTransportId, setOriginalTransportId] = useState<string | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [activeDay, setActiveDay] = useState('1');

  useEffect(() => {
    // Load trip from localStorage (later: from Supabase)
    const stored = localStorage.getItem('currentTrip');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert date strings back to Date objects
      parsed.createdAt = new Date(parsed.createdAt);
      parsed.updatedAt = new Date(parsed.updatedAt);
      parsed.preferences.startDate = new Date(parsed.preferences.startDate);
      parsed.days = parsed.days.map((day: TripDay) => ({
        ...day,
        date: new Date(day.date),
      }));
      setTrip(parsed);
      // Sauvegarder l'ID du transport original
      setOriginalTransportId(parsed.selectedTransport?.id);
    }
    setLoading(false);
  }, [params.id]);

  // Fonction pour régénérer le voyage avec le nouveau transport
  const handleRegenerateTrip = async () => {
    if (!trip) return;

    setRegenerating(true);
    try {
      // Appeler l'API pour régénérer avec le nouveau transport
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...trip.preferences,
          transport: trip.selectedTransport?.mode,
        }),
      });

      if (!response.ok) throw new Error('Erreur régénération');

      const newTrip = await response.json();
      // Garder le transport sélectionné
      newTrip.selectedTransport = trip.selectedTransport;

      setTrip(newTrip);
      localStorage.setItem('currentTrip', JSON.stringify(newTrip));
      setTransportChanged(false);
      setOriginalTransportId(newTrip.selectedTransport?.id);
    } catch (error) {
      console.error('Erreur régénération:', error);
      alert('Erreur lors de la régénération du voyage');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSelectItem = (item: TripItem) => {
    setSelectedItemId(item.id);
  };

  const handleDeleteItem = (item: TripItem) => {
    if (!trip) return;
    if (!confirm('Supprimer cette activité ?')) return;

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.filter((i) => i.id !== item.id),
    }));

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    setTrip(updatedTrip);
    localStorage.setItem('currentTrip', JSON.stringify(updatedTrip));
  };

  const getAllItems = (): TripItem[] => {
    if (!trip) return [];
    return trip.days.flatMap((day) => day.items);
  };

  // Export du planning pour debug
  const handleExportDebug = () => {
    if (!trip) return;

    // Créer un format lisible pour Claude
    const debugExport = {
      _meta: {
        exportedAt: new Date().toISOString(),
        purpose: 'Debug export for Claude analysis',
        version: '1.0',
      },
      summary: {
        destination: trip.preferences.destination,
        origin: trip.preferences.origin,
        startDate: trip.preferences.startDate,
        durationDays: trip.preferences.durationDays,
        groupSize: trip.preferences.groupSize,
        groupType: trip.preferences.groupType,
        budgetLevel: trip.preferences.budgetLevel,
        activities: trip.preferences.activities,
        transport: trip.preferences.transport,
        totalEstimatedCost: trip.totalEstimatedCost,
      },
      selectedTransport: trip.selectedTransport,
      transportOptions: trip.transportOptions,
      outboundFlight: trip.outboundFlight,
      returnFlight: trip.returnFlight,
      accommodation: trip.accommodation,
      chronology: trip.days.map((day) => ({
        dayNumber: day.dayNumber,
        date: day.date,
        itemCount: day.items.length,
        items: day.items.map((item) => ({
          time: `${item.startTime} - ${item.endTime}`,
          type: item.type,
          title: item.title,
          description: item.description,
          location: item.locationName,
          coords: { lat: item.latitude, lng: item.longitude },
          duration: item.duration,
          estimatedCost: item.estimatedCost,
          rating: item.rating,
          // Liens
          bookingUrl: item.bookingUrl,
          googleMapsUrl: item.googleMapsUrl,
          googleMapsPlaceUrl: item.googleMapsPlaceUrl,
          // Transport vers ce point
          distanceFromPrevious: item.distanceFromPrevious,
          timeFromPrevious: item.timeFromPrevious,
          transportToPrevious: item.transportToPrevious,
          transitInfo: item.transitInfo,
          // Données enrichies
          dataReliability: item.dataReliability,
          flight: item.flight,
          restaurant: item.restaurant,
          accommodation: item.accommodation,
        })),
      })),
      carbonFootprint: trip.carbonFootprint,
      costBreakdown: trip.costBreakdown,
      // Données brutes complètes pour debug avancé
      _rawTrip: trip,
    };

    // Télécharger le fichier JSON
    const blob = new Blob([JSON.stringify(debugExport, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const timestamp = `${now.toISOString().split('T')[0]}-${now.getHours().toString().padStart(2, '0')}h${now.getMinutes().toString().padStart(2, '0')}`;
    a.download = `voyage-${trip.preferences.origin.replace(/\s+/g, '').toLowerCase()}${trip.preferences.destination.replace(/\s+/g, '').toLowerCase()}--debug-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getActiveDayItems = (): TripItem[] => {
    if (!trip) return [];
    const dayNumber = parseInt(activeDay);
    const day = trip.days.find((d) => d.dayNumber === dayNumber);
    return day?.items || [];
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Voyage non trouvé</p>
        <Button onClick={() => router.push('/plan')}>
          Créer un nouveau voyage
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/')}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-bold text-xl">
                  {trip.preferences.destination}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {format(trip.preferences.startDate, 'd MMMM yyyy', {
                    locale: fr,
                  })}{' '}
                  • {trip.preferences.durationDays} jours
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">Partager</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleExportDebug}>
                <Bug className="h-4 w-4" />
                <span className="hidden sm:inline">Export Debug</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-background">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{trip.days.length}</p>
                  <p className="text-xs text-muted-foreground">Jours</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <MapPin className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{getAllItems().length}</p>
                  <p className="text-xs text-muted-foreground">Activités</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Users className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {trip.preferences.groupSize}
                  </p>
                  <p className="text-xs text-muted-foreground">Voyageurs</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Wallet className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    ~{trip.totalEstimatedCost}€
                  </p>
                  <p className="text-xs text-muted-foreground">Budget estimé</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Timeline */}
          <div className="order-2 lg:order-1">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Itinéraire</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeDay} onValueChange={setActiveDay}>
                  <TabsList className="w-full flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
                    {trip.days.map((day) => (
                      <TabsTrigger
                        key={day.dayNumber}
                        value={day.dayNumber.toString()}
                        className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                      >
                        Jour {day.dayNumber}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {trip.days.map((day) => (
                    <TabsContent
                      key={day.dayNumber}
                      value={day.dayNumber.toString()}
                      className="mt-0"
                    >
                      <DayTimeline
                        day={day}
                        selectedItemId={selectedItemId}
                        onSelectItem={handleSelectItem}
                        onDeleteItem={handleDeleteItem}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Right: Transport, Map & Carbon */}
          <div className="order-1 lg:order-2 space-y-6">
            {/* Transport Options */}
            {trip.transportOptions && trip.transportOptions.length > 0 && (
              <>
                <TransportOptions
                  options={trip.transportOptions}
                  selectedId={trip.selectedTransport?.id}
                  onSelect={(option) => {
                    // Mettre à jour le transport sélectionné
                    const updatedTrip = {
                      ...trip,
                      selectedTransport: option,
                      updatedAt: new Date(),
                    };
                    setTrip(updatedTrip);
                    localStorage.setItem('currentTrip', JSON.stringify(updatedTrip));
                    // Marquer que le transport a changé
                    if (option.id !== originalTransportId) {
                      setTransportChanged(true);
                    } else {
                      setTransportChanged(false);
                    }
                  }}
                />

                {/* Banner de régénération si transport changé */}
                {transportChanged && (
                  <Card className="bg-amber-50 border-amber-200">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium text-amber-800">Transport modifié</p>
                          <p className="text-sm text-amber-600">
                            Régénérer le voyage pour mettre à jour les horaires et itinéraires.
                          </p>
                        </div>
                        <Button
                          onClick={handleRegenerateTrip}
                          disabled={regenerating}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          {regenerating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Régénération...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Régénérer
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Carte</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-[400px]">
                  <TripMap
                    items={getActiveDayItems()}
                    selectedItemId={selectedItemId}
                    onItemClick={handleSelectItem}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Carbon Footprint */}
            {trip.carbonFootprint && (
              <CarbonFootprint data={trip.carbonFootprint} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
