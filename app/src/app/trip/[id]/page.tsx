'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Trip, TripItem, TripDay, Accommodation } from '@/lib/types';
import { DayTimeline, CarbonFootprint, TransportOptions } from '@/components/trip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
  GitPullRequest,
  GripVertical,
  Receipt,
  Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { HotelSelector } from '@/components/trip/HotelSelector';
import { generateHotelSearchLinks } from '@/lib/services/linkGenerator';
import { useAuth } from '@/components/auth';
import { useRealtimeTrip } from '@/hooks/useRealtimeTrip';
import { SharePanel } from '@/components/trip/SharePanel';
import { ProposalsList } from '@/components/trip/ProposalsList';
import { CreateProposalDialog } from '@/components/trip/CreateProposalDialog';
import { DraggableTimeline } from '@/components/trip/DraggableTimeline';
import { ShareTripDialog } from '@/components/trip/ShareTripDialog';
import { TripVisibilitySelector, VisibilityBadge } from '@/components/trip/TripVisibilitySelector';
import { CloneTripModal } from '@/components/social/CloneTripModal';
import { ActivityEditModal } from '@/components/trip/ActivityEditModal';
import { ExpensesPanel } from '@/components/trip/expenses/ExpensesPanel';
import { TravelTips } from '@/components/trip/TravelTips';
import { PhotoGallery } from '@/components/photos/PhotoGallery';
import { PhotoUploader } from '@/components/photos/PhotoUploader';
import { ProposedChange, createMoveActivityChange } from '@/lib/types/collaboration';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

/**
 * Met à jour le planning quand l'hôtel change
 */
function updateTripWithNewHotel(trip: Trip, newHotel: Accommodation): Trip {
  const oldHotelName = trip.accommodation?.name || '';
  const newHotelName = newHotel.name;

  const updatedDays = trip.days.map(day => ({
    ...day,
    items: day.items.map(item => {
      const isHotelItem = item.type === 'checkin' || item.type === 'checkout' || item.type === 'hotel';
      const titleContainsHotel = item.title?.toLowerCase().includes('check-in') ||
                                  item.title?.toLowerCase().includes('check-out') ||
                                  item.title?.toLowerCase().includes('hébergement');

      if (isHotelItem || titleContainsHotel) {
        let newTitle = item.title;
        if (oldHotelName && item.title?.includes(oldHotelName)) {
          newTitle = item.title.replace(oldHotelName, newHotelName);
        } else if (item.title?.includes('Check-in ')) {
          newTitle = `Check-in ${newHotelName}`;
        } else if (item.title?.includes('Check-out ')) {
          newTitle = `Check-out ${newHotelName}`;
        }

        let newDescription = item.description;
        if (newDescription && oldHotelName) {
          newDescription = newDescription.replace(oldHotelName, newHotelName);
        }

        return {
          ...item,
          title: newTitle,
          description: newDescription,
          locationName: newHotelName,
          latitude: newHotel.latitude,
          longitude: newHotel.longitude,
          accommodation: item.accommodation ? {
            ...item.accommodation,
            name: newHotelName,
            address: newHotel.address,
            latitude: newHotel.latitude,
            longitude: newHotel.longitude,
            pricePerNight: newHotel.pricePerNight,
            totalPrice: newHotel.totalPrice,
            rating: newHotel.rating,
            stars: newHotel.stars,
            bookingUrl: newHotel.bookingUrl,
          } : undefined,
        };
      }
      return item;
    }),
  }));

  const oldHotelPrice = trip.accommodation?.totalPrice || 0;
  const nights = trip.preferences.durationDays - 1;
  const newHotelPrice = newHotel.totalPrice || (newHotel.pricePerNight * nights);
  const priceDiff = newHotelPrice - oldHotelPrice;

  const updatedCostBreakdown = trip.costBreakdown ? {
    ...trip.costBreakdown,
    accommodation: newHotelPrice,
  } : undefined;

  return {
    ...trip,
    days: updatedDays,
    accommodation: newHotel,
    costBreakdown: updatedCostBreakdown,
    totalEstimatedCost: Math.round((trip.totalEstimatedCost || 0) + priceDiff),
  };
}

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
  const tripId = params.id as string;
  const { user } = useAuth();

  // Mode collaboratif (Supabase) ou local (localStorage)
  const [useCollaborativeMode, setUseCollaborativeMode] = useState(false);

  // État pour le mode localStorage
  const [localTrip, setLocalTrip] = useState<Trip | null>(null);
  const [localLoading, setLocalLoading] = useState(true);

  // Hook pour le mode collaboratif
  const {
    trip: collaborativeTrip,
    isLoading: collaborativeLoading,
    error: collaborativeError,
    updateDays,
    createProposal,
    vote,
    refetch,
  } = useRealtimeTrip(tripId, user?.id);

  // États UI
  const [regenerating, setRegenerating] = useState(false);
  const [transportChanged, setTransportChanged] = useState(false);
  const [originalTransportId, setOriginalTransportId] = useState<string | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [activeDay, setActiveDay] = useState('1');
  const [selectedHotelId, setSelectedHotelId] = useState<string | undefined>();
  const [editMode, setEditMode] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<ProposedChange[]>([]);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [showExpensesPanel, setShowExpensesPanel] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [mainTab, setMainTab] = useState('planning');
  const [editingItem, setEditingItem] = useState<TripItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);

  // Track viewport to avoid mounting two DndContext instances
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Déterminer quel trip utiliser
  const trip = useCollaborativeMode ? collaborativeTrip?.data : localTrip;
  const loading = useCollaborativeMode ? collaborativeLoading : localLoading;

  // Données collaboratives
  const members = collaborativeTrip?.members || [];
  const proposals = collaborativeTrip?.proposals || [];
  const userRole = collaborativeTrip?.userRole;
  const shareCode = collaborativeTrip?.shareCode || '';
  const isOwner = userRole === 'owner';
  const canEdit = userRole === 'owner' || userRole === 'editor';

  // Charger le trip depuis localStorage ou API
  useEffect(() => {
    const stored = localStorage.getItem('currentTrip');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.id === tripId) {
          parsed.createdAt = new Date(parsed.createdAt);
          parsed.updatedAt = new Date(parsed.updatedAt);
          parsed.preferences.startDate = new Date(parsed.preferences.startDate);
          parsed.days = parsed.days.map((day: TripDay) => ({
            ...day,
            date: new Date(day.date),
          }));
          setLocalTrip(parsed);
          setOriginalTransportId(parsed.selectedTransport?.id);
          setSelectedHotelId(parsed.accommodation?.id);
          setLocalLoading(false);
          return;
        }
      } catch (e) {
        console.error('Error parsing localStorage trip:', e);
      }
    }

    // Fallback: fetch from API if not in localStorage
    fetch(`/api/trips/${tripId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.data) {
          const tripData = data.data;
          if (tripData.createdAt) tripData.createdAt = new Date(tripData.createdAt);
          if (tripData.updatedAt) tripData.updatedAt = new Date(tripData.updatedAt);
          if (tripData.preferences?.startDate) tripData.preferences.startDate = new Date(tripData.preferences.startDate);
          if (tripData.days) {
            tripData.days = tripData.days.map((day: TripDay) => ({
              ...day,
              date: day.date ? new Date(day.date) : new Date(),
            }));
          }
          tripData.id = tripId;
          setLocalTrip(tripData);
          // Also cache in localStorage for next time
          localStorage.setItem('currentTrip', JSON.stringify(tripData));
        }
      })
      .catch(e => console.error('Error fetching trip from API:', e))
      .finally(() => setLocalLoading(false));
  }, [tripId]);

  // Vérifier si on peut utiliser le mode collaboratif
  useEffect(() => {
    if (user && collaborativeTrip && !collaborativeError) {
      setUseCollaborativeMode(true);
    }
  }, [user, collaborativeTrip, collaborativeError]);

  // Fonction de sauvegarde unifiée
  const saveTrip = useCallback((updatedTrip: Trip) => {
    if (useCollaborativeMode) {
      updateDays(updatedTrip.days);
    } else {
      setLocalTrip(updatedTrip);
      localStorage.setItem('currentTrip', JSON.stringify(updatedTrip));
    }
  }, [useCollaborativeMode, updateDays]);

  // Gestion du drag-and-drop
  const handleDirectUpdate = useCallback((updatedDays: TripDay[]) => {
    if (!trip) return;
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
  }, [trip, saveTrip]);

  const handleProposalFromDrag = useCallback((change: ProposedChange) => {
    setPendingChanges((prev) => [...prev, change]);
    setShowProposalDialog(true);
  }, []);

  // Créer une proposition
  const handleCreateProposal = useCallback(async (title: string, description: string, changes: ProposedChange[]) => {
    if (useCollaborativeMode) {
      await createProposal(title, description, changes);
    }
    setPendingChanges([]);
  }, [useCollaborativeMode, createProposal]);

  // Voter sur une proposition
  const handleVote = useCallback(async (proposalId: string, voteValue: boolean) => {
    if (useCollaborativeMode) {
      await vote(proposalId, voteValue);
    }
  }, [useCollaborativeMode, vote]);

  // Régénérer le voyage
  const handleRegenerateTrip = async () => {
    if (!trip) return;
    setRegenerating(true);
    try {
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
      newTrip.selectedTransport = trip.selectedTransport;
      saveTrip(newTrip);
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

  const handleEditItem = (item: TripItem) => {
    setEditingItem(item);
    setShowEditModal(true);
  };

  const handleSaveItem = (updatedItem: TripItem) => {
    if (!trip) return;

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
    }));

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité modifiée');
  };

  const handleDeleteItem = (item: TripItem) => {
    if (!trip) return;
    if (!confirm('Supprimer cette activité ?')) return;

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.filter((i) => i.id !== item.id),
    }));

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité supprimée');
  };

  // Helper function for sorting times with after-midnight handling
  const timeToSortableMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    // Hours 00:00-05:59 are considered "after midnight" and sort after normal hours
    return hours < 6 ? totalMinutes + 1440 : totalMinutes;
  };

  const handleMoveItem = (item: TripItem, direction: 'up' | 'down') => {
    if (!trip) return;

    const dayIndex = trip.days.findIndex((d) =>
      d.items.some((i) => i.id === item.id)
    );
    if (dayIndex === -1) return;

    const day = trip.days[dayIndex];

    // Work with sorted items (same as DayTimeline does) excluding transport
    // Use special sorting for after-midnight times
    const sortedItems = [...day.items]
      .filter((i) => i.type !== 'transport')
      .sort((a, b) => timeToSortableMinutes(a.startTime) - timeToSortableMinutes(b.startTime));

    const currentIndex = sortedItems.findIndex((i) => i.id === item.id);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) return;

    // Get the two items to swap (BEFORE modifying anything)
    const currentItem = sortedItems[currentIndex];
    const targetItem = sortedItems[targetIndex];

    // Save the times we need to swap
    const currentStartTime = currentItem.startTime;
    const currentEndTime = currentItem.endTime;
    const targetStartTime = targetItem.startTime;
    const targetEndTime = targetItem.endTime;

    // Create new items array with swapped times
    const newItems = day.items.map((i) => {
      if (i.id === currentItem.id) {
        return { ...i, startTime: targetStartTime, endTime: targetEndTime };
      }
      if (i.id === targetItem.id) {
        return { ...i, startTime: currentStartTime, endTime: currentEndTime };
      }
      return i;
    });

    const updatedDays = trip.days.map((d, idx) =>
      idx === dayIndex ? { ...d, items: newItems } : d
    );

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité déplacée');
  };

  const handleRegenerateDay = async (dayNumber: number) => {
    if (!trip) return;
    setRegenerating(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...trip.preferences,
          regenerateDay: dayNumber,
        }),
      });

      if (!response.ok) throw new Error('Erreur régénération');

      const newTrip = await response.json();
      // Only update the specific day
      const updatedDays = trip.days.map((day) =>
        day.dayNumber === dayNumber
          ? newTrip.days.find((d: TripDay) => d.dayNumber === dayNumber) || day
          : day
      );

      const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
      saveTrip(updatedTrip);
      toast.success(`Jour ${dayNumber} régénéré`);
    } catch (error) {
      console.error('Erreur régénération jour:', error);
      toast.error('Erreur lors de la régénération');
    } finally {
      setRegenerating(false);
    }
  };

  const handleRegenerateRestaurants = async () => {
    if (!trip) return;
    setRegenerating(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...trip.preferences,
          regenerateRestaurants: true,
        }),
      });

      if (!response.ok) throw new Error('Erreur régénération');

      const newTrip = await response.json();
      // Only update restaurant items
      const updatedDays = trip.days.map((day, dayIdx) => ({
        ...day,
        items: day.items.map((item) => {
          if (item.type === 'restaurant') {
            const newDayItems = newTrip.days[dayIdx]?.items || [];
            const newRestaurant = newDayItems.find(
              (ni: TripItem) => ni.type === 'restaurant' && ni.startTime === item.startTime
            );
            return newRestaurant || item;
          }
          return item;
        }),
      }));

      const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
      saveTrip(updatedTrip);
      toast.success('Restaurants régénérés');
    } catch (error) {
      console.error('Erreur régénération restaurants:', error);
      toast.error('Erreur lors de la régénération');
    } finally {
      setRegenerating(false);
    }
  };

  const getAllItems = (): TripItem[] => {
    if (!trip) return [];
    return trip.days.flatMap((day) => day.items);
  };

  const getActiveDayItems = (): TripItem[] => {
    if (!trip) return [];
    const dayNumber = parseInt(activeDay);
    const day = trip.days.find((d) => d.dayNumber === dayNumber);
    return day?.items || [];
  };

  // Export debug
  const handleExportDebug = () => {
    if (!trip) return;
    const debugExport = {
      _meta: { exportedAt: new Date().toISOString(), purpose: 'Debug export' },
      summary: {
        destination: trip.preferences.destination,
        origin: trip.preferences.origin,
        startDate: trip.preferences.startDate,
        durationDays: trip.preferences.durationDays,
        groupSize: trip.preferences.groupSize,
        totalEstimatedCost: trip.totalEstimatedCost,
      },
      days: trip.days,
      _rawTrip: trip,
    };

    const blob = new Blob([JSON.stringify(debugExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voyage-debug-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
              <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="font-bold text-xl">
                  {trip.preferences.origin && <span className="text-muted-foreground">{trip.preferences.origin} → </span>}
                  {trip.preferences.destination}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(trip.preferences.startDate), 'd MMMM yyyy', { locale: fr })} • {trip.preferences.durationDays} jours
                  {trip.preferences.groupSize && ` • ${trip.preferences.groupSize} pers.`}
                  {trip.preferences.budgetLevel && ` • ${trip.preferences.budgetLevel === 'economic' ? 'Éco' : trip.preferences.budgetLevel === 'moderate' ? 'Modéré' : trip.preferences.budgetLevel === 'comfort' ? 'Confort' : 'Luxe'}`}
                  {trip.preferences.transport && trip.preferences.transport !== 'optimal' && ` • ${trip.preferences.transport === 'plane' ? 'Avion' : trip.preferences.transport === 'train' ? 'Train' : trip.preferences.transport === 'car' ? 'Voiture' : 'Bus'}`}
                  {trip.preferences.groupType && ` • ${trip.preferences.groupType === 'solo' ? 'Solo' : trip.preferences.groupType === 'couple' ? 'Couple' : trip.preferences.groupType === 'friends' ? 'Amis' : trip.preferences.groupType === 'family_with_kids' ? 'Famille (enfants)' : 'Famille'}`}
                </p>
                {trip.preferences.activities && trip.preferences.activities.length > 0 && (
                  <p className="text-xs text-muted-foreground/70">
                    {trip.preferences.activities.map((a: string) => {
                      const labels: Record<string, string> = { beach: 'Plage', nature: 'Nature', culture: 'Culture', gastronomy: 'Gastronomie', nightlife: 'Vie nocturne', shopping: 'Shopping', adventure: 'Aventure', wellness: 'Bien-être' };
                      return labels[a] || a;
                    }).join(', ')}
                    {trip.budgetStrategy && ` • ${trip.budgetStrategy.accommodationType === 'airbnb_with_kitchen' ? 'Airbnb + cuisine' : trip.budgetStrategy.accommodationType === 'hostel' ? 'Auberge' : 'Hôtel'}`}
                    {trip.budgetStrategy?.groceryShoppingNeeded && ' + courses'}
                  </p>
                )}
                {trip.budgetStatus && (
                  <p className={`text-xs ${trip.budgetStatus.isOverBudget ? 'text-red-500' : 'text-green-600'}`}>
                    Budget cible: {trip.budgetStatus.target}€ • Estimé: {trip.budgetStatus.estimated}€
                    {trip.budgetStatus.isOverBudget ? ` (+${Math.abs(trip.budgetStatus.difference)}€)` : ` (${trip.budgetStatus.difference}€ restants)`}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Visibilité */}
              {useCollaborativeMode && isOwner && collaborativeTrip && (
                <TripVisibilitySelector
                  tripId={tripId}
                  currentVisibility={collaborativeTrip.visibility || 'private'}
                />
              )}
              {useCollaborativeMode && !isOwner && collaborativeTrip && (
                <VisibilityBadge visibility={collaborativeTrip.visibility || 'private'} />
              )}

              {/* Bouton régénérer - owner/editor only */}
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={regenerating}
                    >
                      {regenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="hidden sm:inline">R\u00e9g\u00e9n\u00e9rer</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleRegenerateTrip}>
                      Tout r\u00e9g\u00e9n\u00e9rer
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {trip.days.map((day) => (
                      <DropdownMenuItem
                        key={day.dayNumber}
                        onClick={() => handleRegenerateDay(day.dayNumber)}
                      >
                        Jour {day.dayNumber}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleRegenerateRestaurants}>
                      Restaurants uniquement
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Bouton mode édition */}
              {canEdit && (
                <Button
                  variant={editMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditMode(!editMode)}
                  className="gap-2"
                >
                  <GripVertical className="h-4 w-4" />
                  {editMode ? 'Terminer' : 'Éditer'}
                </Button>
              )}

              {/* Bouton propositions (mode collaboratif) */}
              {useCollaborativeMode && (
                <Sheet open={showCollabPanel} onOpenChange={setShowCollabPanel}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 relative">
                      <GitPullRequest className="h-4 w-4" />
                      <span className="hidden sm:inline">Propositions</span>
                      {proposals.filter(p => p.status === 'pending').length > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                          {proposals.filter(p => p.status === 'pending').length}
                        </span>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Collaboration</SheetTitle>
                    </SheetHeader>
                    <div className="mt-6 space-y-6">
                      <SharePanel
                        tripId={tripId}
                        shareCode={shareCode}
                        members={members}
                        currentUserId={user?.id}
                        userRole={userRole}
                      />
                      <ProposalsList
                        proposals={proposals}
                        onVote={handleVote}
                        currentUserId={user?.id}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              )}

              {/* Bouton d\u00e9penses - owner/editor only */}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setMainTab('depenses')}
                >
                  <Receipt className="h-4 w-4" />
                  <span className="hidden sm:inline">D\u00e9penses</span>
                </Button>
              )}

              {/* Bouton cloner - viewers only */}
              {!canEdit && useCollaborativeMode && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowCloneModal(true)}
                >
                  <Copy className="h-4 w-4" />
                  <span className="hidden sm:inline">Cloner</span>
                </Button>
              )}

              {/* Bouton partage - owner only */}
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowShareDialog(true)}
                >
                  <Share2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Partager</span>
                </Button>
              )}

              {canEdit && (
                <Button variant="outline" size="sm" className="gap-2" onClick={handleExportDebug}>
                  <Bug className="h-4 w-4" />
                  <span className="hidden sm:inline">Debug</span>
                </Button>
              )}
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
                    {useCollaborativeMode ? members.length : (trip.preferences.groupSize || 1)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {useCollaborativeMode ? 'Collaborateurs' : 'Voyageurs'}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-background">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Wallet className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">~{trip.totalEstimatedCost}€</p>
                  <p className="text-xs text-muted-foreground">
                    Budget estimé{' '}
                    <span className="text-orange-600 font-medium">
                      (~{Math.round((trip.totalEstimatedCost || 0) / (trip.preferences.groupSize || 1))}€/pers.)
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto px-4 py-6">
        {/* Mobile layout: everything in tabs */}
        <div className="lg:hidden">
          <Tabs value={mainTab} onValueChange={setMainTab}>
            <TabsList className={`w-full grid mb-4 ${canEdit ? 'grid-cols-5' : 'grid-cols-3'}`}>
              <TabsTrigger value="planning" className="text-xs sm:text-sm">Planning</TabsTrigger>
              <TabsTrigger value="carte" className="text-xs sm:text-sm">Carte</TabsTrigger>
              {canEdit && <TabsTrigger value="photos" className="text-xs sm:text-sm">Photos</TabsTrigger>}
              {canEdit && <TabsTrigger value="infos" className="text-xs sm:text-sm">Infos</TabsTrigger>}
              {canEdit && <TabsTrigger value="depenses" className="text-xs sm:text-sm">D\u00e9penses</TabsTrigger>}
            </TabsList>

            <TabsContent value="planning">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Itinéraire</CardTitle>
                    {editMode && (
                      <span className="text-xs text-muted-foreground">
                        Glissez les activités pour les réorganiser
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {editMode && !isDesktop ? (
                    <DraggableTimeline
                      days={trip.days}
                      isEditable={canEdit}
                      isOwner={isOwner}
                      onDirectUpdate={isOwner ? handleDirectUpdate : undefined}
                      onProposalCreate={!isOwner && canEdit ? handleProposalFromDrag : undefined}
                    />
                  ) : !editMode ? (
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
                        <TabsContent key={day.dayNumber} value={day.dayNumber.toString()} className="mt-0">
                          <DayTimeline
                            day={day}
                            selectedItemId={selectedItemId}
                            onSelectItem={handleSelectItem}
                            onEditItem={handleEditItem}
                            onDeleteItem={handleDeleteItem}
                            onMoveItem={handleMoveItem}
                            showMoveButtons={true}
                          />
                        </TabsContent>
                      ))}
                    </Tabs>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="carte">
              <div className="space-y-6">
                {trip.transportOptions && trip.transportOptions.length > 0 && (
                  <>
                    <TransportOptions
                      options={trip.transportOptions}
                      selectedId={trip.selectedTransport?.id}
                      onSelect={(option) => {
                        const updatedTrip = { ...trip, selectedTransport: option, updatedAt: new Date() };
                        saveTrip(updatedTrip);
                        setTransportChanged(option.id !== originalTransportId);
                      }}
                    />
                    {transportChanged && (
                      <Card className="bg-amber-50 border-amber-200">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="font-medium text-amber-800">Transport modifié</p>
                              <p className="text-sm text-amber-600">Régénérer le voyage pour mettre à jour les horaires.</p>
                            </div>
                            <Button onClick={handleRegenerateTrip} disabled={regenerating} className="bg-amber-600 hover:bg-amber-700">
                              {regenerating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Régénération...</> : <><RefreshCw className="h-4 w-4 mr-2" />Régénérer</>}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-lg">Carte</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="h-[400px]">
                      <TripMap
                        items={editMode ? getAllItems() : getActiveDayItems()}
                        selectedItemId={selectedItemId}
                        onItemClick={handleSelectItem}
                        flightInfo={{
                          departureCity: trip.preferences.origin,
                          departureCoords: trip.preferences.originCoords,
                          arrivalCity: trip.preferences.destination,
                          arrivalCoords: trip.preferences.destinationCoords,
                          stopoverCities: trip.outboundFlight?.stopCities,
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
                {trip.accommodationOptions && trip.accommodationOptions.length > 0 && (
                  <HotelSelector
                    hotels={trip.accommodationOptions}
                    selectedId={selectedHotelId || trip.accommodation?.id || trip.accommodationOptions[0]?.id || ''}
                    onSelect={(hotelId) => {
                      setSelectedHotelId(hotelId);
                      const newHotel = trip.accommodationOptions?.find(h => h.id === hotelId);
                      if (newHotel) saveTrip(updateTripWithNewHotel(trip, newHotel));
                    }}
                    searchLinks={generateHotelSearchLinks(
                      trip.preferences.destination,
                      trip.days[0]?.date || trip.preferences.startDate,
                      trip.days[trip.days.length - 1]?.date || trip.preferences.startDate,
                      trip.preferences.groupSize || 1
                    )}
                    nights={trip.preferences.durationDays - 1}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="infos">
              <div className="space-y-6">
                {trip.carbonFootprint && <CarbonFootprint data={trip.carbonFootprint} />}
                {trip.travelTips && <TravelTips data={trip.travelTips} />}
              </div>
            </TabsContent>

            <TabsContent value="photos">
              <Card>
                <CardHeader><CardTitle className="text-lg">Photos</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {isOwner && <PhotoUploader tripId={tripId} />}
                  <PhotoGallery tripId={tripId} isOwner={isOwner} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="depenses">
              <Card>
                <CardHeader><CardTitle className="text-lg">Dépenses partagées</CardTitle></CardHeader>
                <CardContent>
                  <ExpensesPanel
                    tripId={tripId}
                    members={useCollaborativeMode
                      ? members.map((m: any) => ({ userId: m.userId, profile: { displayName: m.profile.displayName, avatarUrl: m.profile.avatarUrl } }))
                      : user ? [{ userId: user.id, profile: { displayName: 'Moi', avatarUrl: null } }] : []
                    }
                    currentUserId={user?.id || ''}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Desktop layout: 2 columns */}
        <div className="hidden lg:grid lg:grid-cols-2 gap-6">
          {/* Left: tabs for Planning / Infos / Dépenses */}
          <div>
            <Tabs value={mainTab} onValueChange={setMainTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="planning">Planning</TabsTrigger>
                {canEdit && <TabsTrigger value="photos">Photos</TabsTrigger>}
                {canEdit && <TabsTrigger value="infos">Infos pratiques</TabsTrigger>}
                {canEdit && <TabsTrigger value="depenses">D\u00e9penses</TabsTrigger>}
              </TabsList>

              <TabsContent value="planning">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">Itinéraire</CardTitle>
                      {editMode && (
                        <span className="text-xs text-muted-foreground">
                          Glissez les activités pour les réorganiser
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editMode && isDesktop ? (
                      <DraggableTimeline
                        days={trip.days}
                        isEditable={canEdit}
                        isOwner={isOwner}
                        onDirectUpdate={isOwner ? handleDirectUpdate : undefined}
                        onProposalCreate={!isOwner && canEdit ? handleProposalFromDrag : undefined}
                      />
                    ) : !editMode ? (
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
                          <TabsContent key={day.dayNumber} value={day.dayNumber.toString()} className="mt-0">
                            <DayTimeline
                              day={day}
                              selectedItemId={selectedItemId}
                              onSelectItem={handleSelectItem}
                              onEditItem={handleEditItem}
                              onDeleteItem={handleDeleteItem}
                              onMoveItem={handleMoveItem}
                              showMoveButtons={true}
                            />
                          </TabsContent>
                        ))}
                      </Tabs>
                    ) : null}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="infos">
                <div className="space-y-6">
                  {trip.carbonFootprint && <CarbonFootprint data={trip.carbonFootprint} />}
                  {trip.travelTips && <TravelTips data={trip.travelTips} />}
                </div>
              </TabsContent>

              <TabsContent value="photos">
                <Card>
                  <CardHeader><CardTitle className="text-lg">Photos</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {isOwner && <PhotoUploader tripId={tripId} />}
                    <PhotoGallery tripId={tripId} isOwner={isOwner} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="depenses">
                <Card>
                  <CardHeader><CardTitle className="text-lg">Dépenses partagées</CardTitle></CardHeader>
                  <CardContent>
                    <ExpensesPanel
                      tripId={tripId}
                      members={useCollaborativeMode
                        ? members.map((m: any) => ({ userId: m.userId, profile: { displayName: m.profile.displayName, avatarUrl: m.profile.avatarUrl } }))
                        : user ? [{ userId: user.id, profile: { displayName: 'Moi', avatarUrl: null } }] : []
                      }
                      currentUserId={user?.id || ''}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: Transport, Map & Hotel — always visible */}
          <div className="space-y-6">
            {trip.transportOptions && trip.transportOptions.length > 0 && (
              <>
                <TransportOptions
                  options={trip.transportOptions}
                  selectedId={trip.selectedTransport?.id}
                  onSelect={(option) => {
                    const updatedTrip = { ...trip, selectedTransport: option, updatedAt: new Date() };
                    saveTrip(updatedTrip);
                    setTransportChanged(option.id !== originalTransportId);
                  }}
                />
                {transportChanged && (
                  <Card className="bg-amber-50 border-amber-200">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium text-amber-800">Transport modifié</p>
                          <p className="text-sm text-amber-600">Régénérer le voyage pour mettre à jour les horaires.</p>
                        </div>
                        <Button onClick={handleRegenerateTrip} disabled={regenerating} className="bg-amber-600 hover:bg-amber-700">
                          {regenerating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Régénération...</> : <><RefreshCw className="h-4 w-4 mr-2" />Régénérer</>}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-lg">Carte</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="h-[400px]">
                  <TripMap
                    items={editMode ? getAllItems() : getActiveDayItems()}
                    selectedItemId={selectedItemId}
                    onItemClick={handleSelectItem}
                    flightInfo={{
                      departureCity: trip.preferences.origin,
                      departureCoords: trip.preferences.originCoords,
                      arrivalCity: trip.preferences.destination,
                      arrivalCoords: trip.preferences.destinationCoords,
                      stopoverCities: trip.outboundFlight?.stopCities,
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {trip.accommodationOptions && trip.accommodationOptions.length > 0 && (
              <HotelSelector
                hotels={trip.accommodationOptions}
                selectedId={selectedHotelId || trip.accommodation?.id || trip.accommodationOptions[0]?.id || ''}
                onSelect={(hotelId) => {
                  setSelectedHotelId(hotelId);
                  const newHotel = trip.accommodationOptions?.find(h => h.id === hotelId);
                  if (newHotel) saveTrip(updateTripWithNewHotel(trip, newHotel));
                }}
                searchLinks={generateHotelSearchLinks(
                  trip.preferences.destination,
                  trip.days[0]?.date || trip.preferences.startDate,
                  trip.days[trip.days.length - 1]?.date || trip.preferences.startDate,
                  trip.preferences.groupSize || 1
                )}
                nights={trip.preferences.durationDays - 1}
              />
            )}
          </div>
        </div>
      </div>

      {/* Dialog pour créer une proposition */}
      <CreateProposalDialog
        open={showProposalDialog}
        onClose={() => {
          setShowProposalDialog(false);
          setPendingChanges([]);
        }}
        onSubmit={handleCreateProposal}
        pendingChanges={pendingChanges}
      />

      {/* Dialog de partage */}
      {trip && (
        <ShareTripDialog
          open={showShareDialog}
          isOwner={isOwner}
          currentVisibility={collaborativeTrip?.visibility || 'private'}
          onOpenChange={(open) => {
            setShowShareDialog(open);
            if (!open) {
              // Activer le mode collaboratif quand le dialog se ferme (si le trip a été sauvegardé)
              refetch();
              setUseCollaborativeMode(true);
            }
          }}
          trip={trip}
          tripId={tripId}
          onTripSaved={(savedId, code) => {
            // Mettre à jour l'URL sans recharger (pour que le tripId soit correct)
            window.history.replaceState(null, '', `/trip/${savedId}`);
          }}
        />
      )}

      {/* Modal de clonage */}
      {showCloneModal && trip && (
        <CloneTripModal
          isOpen={showCloneModal}
          onClose={() => setShowCloneModal(false)}
          tripId={tripId}
          tripTitle={collaborativeTrip?.title || `Voyage \u00e0 ${trip.preferences.destination}`}
          originalDuration={trip.preferences.durationDays}
        />
      )}

      {/* Modal d'\u00e9dition d'activit\u00e9 */}
      <ActivityEditModal
        item={editingItem}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingItem(null);
        }}
        onSave={handleSaveItem}
        onDelete={handleDeleteItem}
      />
    </div>
  );
}
