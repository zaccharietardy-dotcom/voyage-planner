'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Trip, TripItem, TripDay, Accommodation, GROUP_TYPE_LABELS, ACTIVITY_LABELS } from '@/lib/types';
import { DayTimeline, CarbonFootprint, TransportOptions, BookingChecklist } from '@/components/trip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  ArrowLeft,
  Share2,
  Wallet,
  Loader2,
  RefreshCw,
  Bug,
  GitPullRequest,
  GripVertical,
  Copy,
  CalendarPlus,
  Download,
  Globe,
  Upload,
  ChevronsLeftRight,
  MapPinned,
  MoreHorizontal,
  MessageCircle,
  Maximize2,
  Minimize2,
  GripHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { generateHotelSearchLinks } from '@/lib/services/linkGenerator';
import { useAuth } from '@/components/auth';
import { useRealtimeTrip } from '@/hooks/useRealtimeTrip';
import { SharePanel } from '@/components/trip/SharePanel';
import { ProposalsList } from '@/components/trip/ProposalsList';
import { CreateProposalDialog } from '@/components/trip/CreateProposalDialog';
const DraggableTimeline = dynamic(
  () => import('@/components/trip/DraggableTimeline').then((mod) => mod.DraggableTimeline),
  {
    ssr: false,
    loading: () => (
      <div className="w-full min-h-[200px] bg-muted animate-pulse rounded-lg flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);
import { ShareTripDialog } from '@/components/trip/ShareTripDialog';
import { TripErrorBoundary } from '@/components/trip/TripErrorBoundary';
import { TripVisibilitySelector, VisibilityBadge } from '@/components/trip/TripVisibilitySelector';
import { CloneTripModal } from '@/components/social/CloneTripModal';
import { ActivityEditModal } from '@/components/trip/ActivityEditModal';
import { ExpensesPanel } from '@/components/trip/expenses/ExpensesPanel';
import { TravelTips } from '@/components/trip/TravelTips';
import { PhotoGallery } from '@/components/photos/PhotoGallery';
import { PhotoUploader } from '@/components/photos/PhotoUploader';
import { PastTripView } from '@/components/trip/PastTripView';
import { ProposedChange } from '@/lib/types/collaboration';
import { recalculateTimes, insertDay } from '@/lib/services/itineraryCalculator';
import { Attraction } from '@/lib/services/attractions';
import { ActivitySwapButton } from '@/components/trip/ActivitySwapButton';
import { AddActivityModal } from '@/components/trip/AddActivityModal';
import { CalendarView } from '@/components/trip/CalendarView';
import { CommentsSection } from '@/components/trip/CommentsSection';
import { ChatPanel, ChatButton } from '@/components/trip/ChatPanel';
import { TripOnboarding } from '@/components/trip/TripOnboarding';
import { ImportPlaces } from '@/components/trip/ImportPlaces';
import { AddToCalendarDropdown } from '@/components/trip/AddToCalendarDropdown';
import { ImportedPlace } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
// exportTripPdf is dynamically imported on-demand (~650KB jsPDF + autotable)
import { useLiveTrip } from '@/hooks/useLiveTrip';
import { LiveTripBanner } from '@/components/trip/LiveTripBanner';
import { LiveTripDashboard } from '@/components/trip/LiveTripDashboard';
import { useConnectivity } from '@/hooks/useConnectivity';
import { cacheTripById, readCachedTripById } from '@/lib/mobile/offline-cache';
import { generateTripStream } from '@/lib/generateTrip';
import { safeGetItem, safeSetItem } from '@/lib/storage';

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

function buildRestaurantDescription(restaurant: NonNullable<TripItem['restaurant']>): string {
  if (restaurant.description?.trim()) return restaurant.description;
  if (restaurant.specialties?.length) return restaurant.specialties[0];
  if (restaurant.cuisineTypes?.length) return restaurant.cuisineTypes.slice(0, 2).join(', ');
  return '';
}

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

const TripFlythrough = dynamic(
  () => import('@/components/trip/TripFlythrough').then((mod) => mod.TripFlythrough),
  { ssr: false }
);

type TripPreferencesWithType = Trip['preferences'] & { tripType?: string };

interface TripApiRecord {
  id: string;
  owner_id?: string;
  preferences?: TripPreferencesWithType;
  data?: Trip;
  [key: string]: unknown;
}

function isHotelBoundaryTransportItem(item: TripItem): boolean {
  return item.type === 'transport' &&
    (item.id.startsWith('hotel-depart-') || item.id.startsWith('hotel-return-'));
}

type TransportRegenerateMode = Trip['preferences']['transport'];

function getRequestedTransportModeForRegeneration(trip: Trip): TransportRegenerateMode {
  const selectedMode = trip.selectedTransport?.mode;
  if (
    selectedMode === 'plane'
    || selectedMode === 'train'
    || selectedMode === 'car'
    || selectedMode === 'bus'
  ) {
    return selectedMode;
  }
  return trip.preferences.transport || 'optimal';
}

function toTripPreferenceTransportMode(mode: string | undefined): Trip['preferences']['transport'] {
  if (mode === 'plane' || mode === 'train' || mode === 'car' || mode === 'bus' || mode === 'optimal') {
    return mode;
  }
  return 'optimal';
}

function resolveSelectedTransportFromGeneratedTrip(
  generatedTrip: Trip,
  requestedMode: TransportRegenerateMode,
): Trip['selectedTransport'] {
  const options = generatedTrip.transportOptions || [];

  const byMode = options.find((option) => option.mode === requestedMode);
  if (byMode) return byMode;

  const byGeneratedId = generatedTrip.selectedTransport
    ? options.find((option) => option.id === generatedTrip.selectedTransport?.id)
    : undefined;
  if (byGeneratedId) return byGeneratedId;

  return generatedTrip.selectedTransport
    || options.find((option) => option.recommended)
    || options[0];
}

export default function TripPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;
  const { user } = useAuth();
  const { isOffline } = useConnectivity();

  const [useCollaborativeMode, setUseCollaborativeMode] = useState(false);
  const [localTrip, setLocalTrip] = useState<Trip | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [dbTrip, setDbTrip] = useState<TripApiRecord | null>(null);

  const {
    trip: collaborativeTrip,
    isLoading: collaborativeLoading,
    error: collaborativeError,
    updateDays,
    createProposal,
    vote,
    decideProposal,
    refetch,
  } = useRealtimeTrip(tripId);

  const [regenerating, setRegenerating] = useState(false);
  const [transportChanged, setTransportChanged] = useState(false);
  const [originalTransportId, setOriginalTransportId] = useState<string | undefined>();
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState('1');
  const [selectedHotelId, setSelectedHotelId] = useState<string | undefined>();
  const [editMode, setEditMode] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<ProposedChange[]>([]);
  const [showProposalDialog, setShowProposalDialog] = useState(false);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [mainTab, setMainTab] = useState('planning');
  const [editingItem, setEditingItem] = useState<TripItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showAddActivityModal, setShowAddActivityModal] = useState(false);
  const [addActivityDay, setAddActivityDay] = useState<number>(1);
  const [addActivityDefaultTime, setAddActivityDefaultTime] = useState<string | undefined>();
  const [addActivityDefaultEndTime, setAddActivityDefaultEndTime] = useState<string | undefined>();
  const [planningView, setPlanningView] = useState<'timeline' | 'calendar'>('timeline');
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [showFlythrough, setShowFlythrough] = useState(false);
  const [showImportPlaces, setShowImportPlaces] = useState(false);
  const [showLiveDashboard, setShowLiveDashboard] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [mobileMapHeight, setMobileMapHeight] = useState(30); // vh percentage for mobile split view
  const [mobileMapFullscreen, setMobileMapFullscreen] = useState(false);
  const prevDayRef = useRef('1');
  const dayDirection = useRef(0);

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Track day direction for slide animations
  const handleDayChange = useCallback((newDay: string) => {
    const prev = parseInt(prevDayRef.current);
    const next = parseInt(newDay);
    dayDirection.current = next > prev ? 1 : next < prev ? -1 : 0;
    prevDayRef.current = newDay;
    setActiveDay(newDay);
  }, []);

  // Drag handler for mobile split view resize
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(30);
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragStartHeight.current = mobileMapHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [mobileMapHeight]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartY.current) return;
    const deltaVh = ((e.clientY - dragStartY.current) / window.innerHeight) * 100;
    const newHeight = Math.min(55, Math.max(15, dragStartHeight.current + deltaVh));
    setMobileMapHeight(newHeight);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragStartY.current = 0;
  }, []);

  const trip = useCollaborativeMode ? collaborativeTrip?.data : localTrip;
  const loading = useCollaborativeMode ? collaborativeLoading : localLoading;

  // Live Trip Mode
  const liveState = useLiveTrip(trip || null);

  const members = useMemo(() => collaborativeTrip?.members || [], [collaborativeTrip?.members]);
  const proposals = useMemo(() => collaborativeTrip?.proposals || [], [collaborativeTrip?.proposals]);
  const openProposalCount = proposals.filter(
    (proposal) => proposal.status === 'pending' || proposal.status === 'approved'
  ).length;
  const userRole = collaborativeTrip?.userRole;
  const shareCode = collaborativeTrip?.shareCode || '';
  const localIsOwner = Boolean(user && dbTrip?.owner_id && dbTrip.owner_id === user.id);
  const isOwner = useCollaborativeMode ? userRole === 'owner' : localIsOwner;
  const canOwnerEdit = isOwner;
  const canPropose = useCollaborativeMode ? (userRole === 'owner' || userRole === 'editor') : localIsOwner;
  const canVoteOnProposals = useCollaborativeMode ? userRole === 'editor' : false;
  const canOwnerDecide = useCollaborativeMode ? userRole === 'owner' : false;

  useEffect(() => {
    const hydrateTrip = (rawTrip: Trip): Trip => {
      const hydrated = { ...rawTrip };
      if (hydrated.createdAt) hydrated.createdAt = new Date(hydrated.createdAt);
      if (hydrated.updatedAt) hydrated.updatedAt = new Date(hydrated.updatedAt);
      if (hydrated.preferences?.startDate) {
        hydrated.preferences.startDate = new Date(hydrated.preferences.startDate);
      }
      if (hydrated.days) {
        hydrated.days = hydrated.days.map((day: TripDay) => ({
          ...day,
          date: day.date ? new Date(day.date) : new Date(),
        }));
      }
      return hydrated;
    };

    const applyLocalTrip = (candidate: Trip | null): boolean => {
      if (!candidate || candidate.id !== tripId) return false;
      const hydrated = hydrateTrip(candidate);
      setLocalTrip(hydrated);
      setOriginalTransportId(hydrated.selectedTransport?.id);
      setSelectedHotelId(hydrated.accommodation?.id);
      setLocalLoading(false);
      return true;
    };

    const stored = safeGetItem('currentTrip');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Trip;
        if (applyLocalTrip(parsed)) return;
      } catch (e) {
        console.error('Error parsing localStorage trip:', e);
      }
    }

    const cachedTrip = readCachedTripById<Trip>(tripId);
    if (applyLocalTrip(cachedTrip)) return;

    const fetchFromApi = async (retries = 0): Promise<void> => {
      try {
        const r = await fetch(`/api/trips/${tripId}`);
        if (r.status === 401 && retries < 3) {
          await new Promise(resolve => setTimeout(resolve, (retries + 1) * 800));
          return fetchFromApi(retries + 1);
        }
        if (!r.ok) {
          const fallback = readCachedTripById<Trip>(tripId);
          if (fallback) {
            applyLocalTrip(fallback);
          }
          return;
        }
        const data = await r.json();
        handleApiData(data);
      } catch (e) {
        console.error('Error fetching trip from API:', e);
        const fallback = readCachedTripById<Trip>(tripId);
        if (fallback) {
          applyLocalTrip(fallback);
        }
      } finally {
        setLocalLoading(false);
      }
    };

    const handleApiData = (data: TripApiRecord) => {
      if (data) {
        setDbTrip(data);
        if (data.data && Object.keys(data.data).length > 0) {
          const tripData = hydrateTrip(data.data);
          tripData.id = tripId;
          setLocalTrip(tripData);
          safeSetItem('currentTrip', JSON.stringify(tripData));
          cacheTripById(tripId, tripData);
        }
      }
    };

    fetchFromApi();
  }, [tripId]);

  useEffect(() => {
    if (user && collaborativeTrip && !collaborativeError) {
      setUseCollaborativeMode(true);
    }
  }, [user, collaborativeTrip, collaborativeError]);

  const saveTrip = useCallback((updatedTrip: Trip) => {
    if (useCollaborativeMode && !canOwnerEdit) {
      toast.error('Mode collaboration: seules les actions propriétaire appliquent directement le voyage');
      return;
    }

    if (useCollaborativeMode) {
      updateDays(updatedTrip.days);
    } else {
      setLocalTrip(updatedTrip);
      safeSetItem('currentTrip', JSON.stringify(updatedTrip));
    }
  }, [useCollaborativeMode, canOwnerEdit, updateDays]);

  useEffect(() => {
    if (!trip) return;
    cacheTripById(tripId, trip);
  }, [trip, tripId]);

  const handleDirectUpdate = useCallback((updatedDays: TripDay[]) => {
    if (!trip) return;
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
  }, [trip, saveTrip]);

  const handleProposalFromDrag = useCallback((change: ProposedChange) => {
    setPendingChanges((prev) => [...prev, change]);
    setShowProposalDialog(true);
  }, []);

  const handleCreateProposal = useCallback(async (title: string, description: string, changes: ProposedChange[]) => {
    if (useCollaborativeMode && canPropose) {
      await createProposal(title, description, changes);
    }
    setPendingChanges([]);
  }, [useCollaborativeMode, canPropose, createProposal]);

  const handleVote = useCallback(async (proposalId: string, voteValue: boolean) => {
    if (useCollaborativeMode && canVoteOnProposals) {
      await vote(proposalId, voteValue);
    }
  }, [useCollaborativeMode, canVoteOnProposals, vote]);

  const handleProposalDecision = useCallback(async (proposalId: string, decision: 'merge' | 'reject') => {
    if (useCollaborativeMode && canOwnerDecide) {
      await decideProposal(proposalId, decision);
    }
  }, [useCollaborativeMode, canOwnerDecide, decideProposal]);

  const handleRegenerateTrip = async () => {
    if (!trip) return;
    if (isOffline) {
      toast.error('Régénération indisponible hors ligne');
      return;
    }
    setRegenerating(true);
    try {
      const requestedMode = getRequestedTransportModeForRegeneration(trip);

      const newTrip = await generateTripStream({
        ...trip.preferences,
        transport: requestedMode,
      });
      const resolvedSelectedTransport = resolveSelectedTransportFromGeneratedTrip(newTrip, requestedMode);
      const updatedTrip: Trip = {
        ...newTrip,
        selectedTransport: resolvedSelectedTransport,
        preferences: {
          ...newTrip.preferences,
          transport: toTripPreferenceTransportMode(resolvedSelectedTransport?.mode || requestedMode),
        },
      };
      saveTrip(updatedTrip);
      setTransportChanged(false);
      setOriginalTransportId(updatedTrip.selectedTransport?.id);
    } catch (error) {
      console.error('Erreur régénération:', error);
      alert('Erreur lors de la régénération du voyage');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSelectItem = useCallback((item: TripItem) => {
    setSelectedItemId(item.id);
  }, []);

  const handleEditItem = useCallback((item: TripItem) => {
    setEditingItem(item);
    setShowEditModal(true);
  }, []);

  const handleSaveItem = useCallback((updatedItem: TripItem) => {
    if (!trip) return;
    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
    }));
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité modifiée');
  }, [trip, saveTrip]);

  const handleDeleteItem = useCallback((item: TripItem) => {
    if (!trip) return;
    if (!confirm('Supprimer cette activité ?')) return;
    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.filter((i) => i.id !== item.id),
    }));
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité supprimée');
  }, [trip, saveTrip]);

  const handleSwapActivity = useCallback((oldItem: TripItem, newAttraction: Attraction) => {
    if (!trip) return;

    // Convertir Attraction → TripItem en conservant le créneau horaire
    const newItem: TripItem = {
      id: crypto.randomUUID(),
      dayNumber: oldItem.dayNumber,
      startTime: oldItem.startTime,
      endTime: oldItem.endTime,
      type: 'activity',
      title: newAttraction.name,
      description: newAttraction.description || '',
      locationName: newAttraction.name,
      latitude: newAttraction.latitude,
      longitude: newAttraction.longitude,
      orderIndex: oldItem.orderIndex,
      estimatedCost: newAttraction.estimatedCost || 0,
      duration: newAttraction.duration || oldItem.duration,
      rating: newAttraction.rating,
      bookingUrl: newAttraction.bookingUrl,
      googleMapsPlaceUrl: newAttraction.googleMapsUrl,
      imageUrl: newAttraction.imageUrl,
      dataReliability: newAttraction.dataReliability || 'verified',
    };

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((item) => (item.id === oldItem.id ? newItem : item)),
    }));

    const updatedTrip: Trip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success(`"${oldItem.title}" remplacé par "${newAttraction.name}"`);
  }, [trip, saveTrip]);

  const handleSelectRestaurantAlternative = useCallback((
    item: TripItem,
    selectedRestaurant: NonNullable<TripItem['restaurant']>
  ) => {
    if (!trip || item.type !== 'restaurant') return;

    const titlePrefix = item.title.includes('—')
      ? item.title.split('—')[0].trim()
      : 'Restaurant';

    const candidates = [item.restaurant, ...(item.restaurantAlternatives || [])]
      .filter((r): r is NonNullable<TripItem['restaurant']> => !!r);

    const dedup = new Map<string, NonNullable<TripItem['restaurant']>>();
    candidates.forEach((r) => dedup.set(r.id, r));
    dedup.set(selectedRestaurant.id, selectedRestaurant);

    const alternatives = Array.from(dedup.values())
      .filter((r) => r.id !== selectedRestaurant.id)
      .slice(0, 2);

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((currentItem) => {
        if (currentItem.id !== item.id) return currentItem;

        const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedRestaurant.name}, ${trip.preferences.destination}`)}`;

        return {
          ...currentItem,
          title: `${titlePrefix} — ${selectedRestaurant.name}`,
          description: buildRestaurantDescription(selectedRestaurant),
          locationName: selectedRestaurant.address || selectedRestaurant.name,
          latitude: selectedRestaurant.latitude,
          longitude: selectedRestaurant.longitude,
          rating: selectedRestaurant.rating,
          bookingUrl: selectedRestaurant.reservationUrl || selectedRestaurant.googleMapsUrl || mapsSearchUrl,
          googleMapsPlaceUrl: mapsSearchUrl,
          restaurant: selectedRestaurant,
          restaurantAlternatives: alternatives,
        };
      }),
    }));

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success(`Restaurant mis à jour: ${selectedRestaurant.name}`);
  }, [trip, saveTrip]);

  const handleSelectSelfMeal = useCallback((item: TripItem) => {
    if (!trip || item.type !== 'restaurant') return;

    const titlePrefix = item.title.includes('—')
      ? item.title.split('—')[0].trim()
      : 'Repas';

    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((currentItem) => {
        if (currentItem.id !== item.id) return currentItem;
        return {
          ...currentItem,
          title: `${titlePrefix} — Repas libre`,
          description: 'Pique-nique / courses / repas maison',
          locationName: 'Repas libre',
          estimatedCost: 0,
          bookingUrl: undefined,
          googleMapsPlaceUrl: undefined,
          restaurant: undefined,
          restaurantAlternatives: undefined,
        };
      }),
    }));

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Repas passé en mode libre');
  }, [trip, saveTrip]);

  // Render swap button pour les ActivityCards (si pool disponible)
  const renderSwapButton = useCallback((item: TripItem) => {
    if (!trip?.attractionPool || trip.attractionPool.length === 0 || !canOwnerEdit) return null;
    if (item.type !== 'activity') return null;
    return (
      <ActivitySwapButton
        item={item}
        days={trip.days}
        attractionPool={trip.attractionPool}
        onSwap={handleSwapActivity}
      />
    );
  }, [trip?.attractionPool, trip?.days, canOwnerEdit, handleSwapActivity]);

  const handleInsertDay = (afterDayNumber: number) => {
    if (!trip) return;
    if (trip.days.length < 2) {
      toast.error('Le voyage est trop court pour ajouter un jour');
      return;
    }

    const startDate = trip.preferences?.startDate
      ? new Date(trip.preferences.startDate)
      : trip.days[0]?.date ? new Date(trip.days[0].date) : new Date();

    const newDays = insertDay(
      trip.days,
      afterDayNumber,
      startDate,
      trip.accommodation ? {
        name: trip.accommodation.name,
        latitude: trip.accommodation.latitude,
        longitude: trip.accommodation.longitude,
        pricePerNight: trip.accommodation.pricePerNight,
      } : undefined,
      trip.attractionPool
    );

    if (newDays.length === trip.days.length) {
      toast.error("Impossible d'ajouter un jour ici");
      return;
    }

    // Mettre à jour preferences.durationDays
    const updatedPreferences = {
      ...trip.preferences,
      durationDays: newDays.length,
    };

    // Mettre à jour les coûts d'hébergement
    let updatedCostBreakdown = trip.costBreakdown;
    let updatedTotalCost = trip.totalEstimatedCost;

    if (updatedCostBreakdown && trip.accommodation?.pricePerNight) {
      const newNights = newDays.length - 1;
      const newAccommodationCost = trip.accommodation.pricePerNight * newNights;
      const costDiff = newAccommodationCost - (updatedCostBreakdown.accommodation || 0);
      updatedCostBreakdown = {
        ...updatedCostBreakdown,
        accommodation: newAccommodationCost,
      };
      if (updatedTotalCost) {
        updatedTotalCost = updatedTotalCost + costDiff;
      }
    }

    const updatedTrip: Trip = {
      ...trip,
      days: newDays,
      preferences: updatedPreferences,
      ...(updatedCostBreakdown ? { costBreakdown: updatedCostBreakdown } : {}),
      ...(updatedTotalCost !== undefined ? { totalEstimatedCost: updatedTotalCost } : {}),
      updatedAt: new Date(),
    };

    saveTrip(updatedTrip);
    toast.success(`Jour ${afterDayNumber + 1} ajouté ! Votre voyage passe à ${newDays.length} jours.`);
  };

  const handleAddNewItem = useCallback((newItem: TripItem) => {
    if (!trip) return;
    const dayIndex = trip.days.findIndex((d) => d.dayNumber === newItem.dayNumber);
    if (dayIndex === -1) return;
    const updatedDays = trip.days.map((day, idx) => {
      if (idx !== dayIndex) return day;
      return { ...day, items: [...day.items, { ...newItem, orderIndex: day.items.length }] };
    });
    const updatedTrip = { ...trip, days: recalculateTimes(updatedDays), updatedAt: new Date() };
    saveTrip(updatedTrip);
    setShowAddActivityModal(false);
    toast.success(`"${newItem.title}" ajouté au Jour ${newItem.dayNumber}`);
  }, [trip, saveTrip]);

  const handleCalendarUpdateItem = useCallback((updatedItem: TripItem) => {
    if (!trip) return;
    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((item) => item.id === updatedItem.id ? updatedItem : item),
    }));
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
  }, [trip, saveTrip]);

  const handleCalendarSlotClick = (dayNumber: number, time: string) => {
    setAddActivityDay(dayNumber);
    setAddActivityDefaultTime(time);
    setAddActivityDefaultEndTime(undefined);
    setShowAddActivityModal(true);
  };

  const handleCalendarSlotRange = (dayNumber: number, startTime: string, endTime: string) => {
    setAddActivityDay(dayNumber);
    setAddActivityDefaultTime(startTime);
    setAddActivityDefaultEndTime(endTime);
    setShowAddActivityModal(true);
  };

  const handleCalendarMoveItemCrossDay = (item: TripItem, fromDayNumber: number, toDayNumber: number, newStartTime: string) => {
    if (!trip) return;
    const [h, m] = newStartTime.split(':').map(Number);
    const startMin = h * 60 + m;
    const duration = item.duration || 60;
    const endMin = startMin + duration;
    const newEndTime = `${Math.floor(endMin / 60) % 24}`.padStart(2, '0') + ':' + `${endMin % 60}`.padStart(2, '0');

    const movedItem = {
      ...item,
      dayNumber: toDayNumber,
      startTime: newStartTime,
      endTime: newEndTime,
    };

    const updatedDays = trip.days.map((day) => {
      if (day.dayNumber === fromDayNumber) {
        return { ...day, items: day.items.filter((i) => i.id !== item.id) };
      }
      if (day.dayNumber === toDayNumber) {
        return { ...day, items: [...day.items, movedItem].sort((a, b) => {
          const aMin = a.startTime ? parseInt(a.startTime.split(':')[0]) * 60 + parseInt(a.startTime.split(':')[1]) : 0;
          const bMin = b.startTime ? parseInt(b.startTime.split(':')[0]) * 60 + parseInt(b.startTime.split(':')[1]) : 0;
          return aMin - bMin;
        })};
      }
      return day;
    });

    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
  };

  const timeToSortableMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return hours < 6 ? totalMinutes + 1440 : totalMinutes;
  };

  const handleMoveItem = useCallback((item: TripItem, direction: 'up' | 'down') => {
    if (!trip) return;
    const dayIndex = trip.days.findIndex((d) => d.items.some((i) => i.id === item.id));
    if (dayIndex === -1) return;
    const day = trip.days[dayIndex];
    const sortedItems = [...day.items]
      .filter((i) => i.type !== 'transport')
      .sort((a, b) => timeToSortableMinutes(a.startTime) - timeToSortableMinutes(b.startTime));
    const currentIndex = sortedItems.findIndex((i) => i.id === item.id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) return;
    const currentItem = sortedItems[currentIndex];
    const targetItem = sortedItems[targetIndex];
    const currentStartTime = currentItem.startTime;
    const currentEndTime = currentItem.endTime;
    const targetStartTime = targetItem.startTime;
    const targetEndTime = targetItem.endTime;
    const newItems = day.items.map((i) => {
      if (i.id === currentItem.id) return { ...i, startTime: targetStartTime, endTime: targetEndTime };
      if (i.id === targetItem.id) return { ...i, startTime: currentStartTime, endTime: currentEndTime };
      return i;
    });
    const updatedDays = trip.days.map((d, idx) => idx === dayIndex ? { ...d, items: newItems } : d);
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Activité déplacée');
  }, [trip, saveTrip]);

  const handleRegenerateDay = async (dayNumber: number) => {
    if (!trip) return;
    if (isOffline) {
      toast.error('Régénération indisponible hors ligne');
      return;
    }
    setRegenerating(true);
    try {
      const requestedMode = getRequestedTransportModeForRegeneration(trip);
      const newTrip = await generateTripStream({
        ...trip.preferences,
        transport: requestedMode,
        regenerateDay: dayNumber,
      });
      const resolvedSelectedTransport = resolveSelectedTransportFromGeneratedTrip(newTrip, requestedMode);
      const updatedDays = trip.days.map((day) =>
        day.dayNumber === dayNumber
          ? newTrip.days.find((d: TripDay) => d.dayNumber === dayNumber) || day
          : day
      );
      const updatedTrip: Trip = {
        ...trip,
        days: updatedDays,
        transportOptions: newTrip.transportOptions || trip.transportOptions,
        selectedTransport: resolvedSelectedTransport || trip.selectedTransport,
        preferences: {
          ...trip.preferences,
          transport: toTripPreferenceTransportMode(resolvedSelectedTransport?.mode || requestedMode),
        },
        updatedAt: new Date(),
      };
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
    if (isOffline) {
      toast.error('Régénération indisponible hors ligne');
      return;
    }
    setRegenerating(true);
    try {
      const requestedMode = getRequestedTransportModeForRegeneration(trip);
      const newTrip = await generateTripStream({
        ...trip.preferences,
        transport: requestedMode,
        regenerateRestaurants: true,
      });
      const resolvedSelectedTransport = resolveSelectedTransportFromGeneratedTrip(newTrip, requestedMode);
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
      const updatedTrip: Trip = {
        ...trip,
        days: updatedDays,
        transportOptions: newTrip.transportOptions || trip.transportOptions,
        selectedTransport: resolvedSelectedTransport || trip.selectedTransport,
        preferences: {
          ...trip.preferences,
          transport: toTripPreferenceTransportMode(resolvedSelectedTransport?.mode || requestedMode),
        },
        updatedAt: new Date(),
      };
      saveTrip(updatedTrip);
      toast.success('Restaurants régénérés');
    } catch (error) {
      console.error('Erreur régénération restaurants:', error);
      toast.error('Erreur lors de la régénération');
    } finally {
      setRegenerating(false);
    }
  };

  const allItems = useMemo(() => {
    if (!trip) return [];
    return trip.days.flatMap((day) => day.items).filter((item) => !isHotelBoundaryTransportItem(item));
  }, [trip]);

  const activeDayItems = useMemo(() => {
    if (!trip) return [];
    const dayNumber = parseInt(activeDay);
    const day = trip.days.find((d) => d.dayNumber === dayNumber);
    return (day?.items || []).filter((item) => !isHotelBoundaryTransportItem(item));
  }, [trip, activeDay]);

  // Keep backward-compat function signatures for non-map callers
  const getAllItems = (): TripItem[] => allItems;

  const handleExportDebug = (compact: boolean = true) => {
    if (!trip) return;
    const debugExport = {
      _meta: {
        exportedAt: new Date().toISOString(),
        purpose: 'Debug export',
        compact,
      },
      summary: {
        destination: trip.preferences.destination,
        origin: trip.preferences.origin,
        startDate: trip.preferences.startDate,
        durationDays: trip.preferences.durationDays,
        groupSize: trip.preferences.groupSize,
        totalEstimatedCost: trip.totalEstimatedCost,
      },
      days: trip.days,
      ...(compact ? {} : { _rawTrip: trip }),
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

  const handleExportPdf = async () => {
    if (!trip) return;
    try {
      const { exportTripPdf } = await import('@/lib/exportPdf');
      exportTripPdf(trip);
      toast.success('PDF téléchargé avec succès');
    } catch (error) {
      console.error('Erreur lors de l\'export PDF:', error);
      toast.error('Erreur lors de l\'export PDF');
    }
  };

  const handleImportPlaces = async (places: ImportedPlace[]) => {
    if (!trip) return;

    const updatedTrip: Trip = {
      ...trip,
      importedPlaces: {
        items: places,
        importedAt: new Date().toISOString(),
        source: places[0]?.source || 'unknown',
      },
    };

    setLocalTrip(updatedTrip);
    safeSetItem('currentTrip', JSON.stringify(updatedTrip));

    // Si mode collaboratif, sauvegarder en DB
    if (useCollaborativeMode && tripId) {
      try {
        await fetch(`/api/trips/${tripId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: updatedTrip,
          }),
        });
      } catch (error) {
        console.error('Erreur lors de la sauvegarde des lieux importés:', error);
      }
    }
  };

  // Unified map numbers: same numbering for both map markers and planning view
  // Only items with valid coords and non-flight type get a number (matching TripMap logic)
  const itemMapNumbers = useMemo(() => {
    if (!trip) return new Map<string, number>();
    const numMap = new Map<string, number>();
    let num = 1;
    for (const day of trip.days) {
      // Sort items by startTime to match chronological map order
      const sorted = [...day.items].sort((a, b) => {
        const aTime = a.startTime || '00:00';
        const bTime = b.startTime || '00:00';
        return aTime.localeCompare(bTime);
      });
      for (const item of sorted) {
        if (item.latitude && item.longitude && item.type !== 'flight') {
          numMap.set(item.id, num++);
        }
      }
    }
    return numMap;
  }, [trip]);

  // Legacy offset function kept for backward compatibility but uses map numbers
  const getDayIndexOffset = (dayNumber: number): number => {
    if (!trip) return 0;
    let offset = 0;
    for (const day of trip.days) {
      if (day.dayNumber === dayNumber) return offset;
      offset += day.items.length;
    }
    return offset;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Sticky Header Skeleton */}
        <div className="sticky top-0 z-50 w-full border-b border-[#1e3a5f]/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between px-4 md:px-8">
            <div className="h-6 w-48 md:w-64 rounded bg-muted animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
              <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 md:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content Area */}
            <div className="lg:col-span-2 space-y-6">
              {/* Mini Map Placeholder */}
              <div className="w-full h-64 md:h-80 rounded-lg bg-muted animate-pulse" />

              {/* Activity Cards Skeleton */}
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col sm:flex-row gap-4 p-4 rounded-lg border border-[#1e3a5f]/10 bg-background"
                  >
                    {/* Image placeholder */}
                    <div className="w-full sm:w-32 h-32 rounded-md bg-muted animate-pulse flex-shrink-0" />

                    {/* Text content */}
                    <div className="flex-1 space-y-3">
                      <div className="h-5 w-3/4 rounded bg-muted animate-pulse" />
                      <div className="h-4 w-full rounded bg-muted animate-pulse" />
                      <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
                      <div className="flex items-center gap-3 mt-3">
                        <div className="h-4 w-16 rounded bg-muted animate-pulse" />
                        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar Skeleton */}
            <div className="hidden lg:block space-y-4">
              <div className="rounded-lg border border-[#1e3a5f]/10 p-6 space-y-4">
                <div className="h-5 w-32 rounded bg-muted animate-pulse" />
                <div className="h-4 w-full rounded bg-muted animate-pulse" />
                <div className="h-4 w-4/5 rounded bg-muted animate-pulse" />
              </div>
              <div className="rounded-lg border border-[#1e3a5f]/10 p-6 space-y-4">
                <div className="h-5 w-24 rounded bg-muted animate-pulse" />
                <div className="h-32 w-full rounded bg-muted animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!trip && !dbTrip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Voyage non trouvé</p>
        <Button onClick={() => router.push('/plan')}>Créer un nouveau voyage</Button>
      </div>
    );
  }

  const collaborativeTripType = (collaborativeTrip?.data?.preferences as TripPreferencesWithType | undefined)?.tripType;
  const isPastTrip = dbTrip?.preferences?.tripType === 'past' || collaborativeTripType === 'past';
  if (isPastTrip && dbTrip) {
    return <PastTripView trip={dbTrip} isOwner={isOwner || dbTrip.owner_id === user?.id} />;
  }

  if (!trip) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Voyage non trouvé</p>
        <Button onClick={() => router.push('/plan')}>Créer un nouveau voyage</Button>
      </div>
    );
  }

  const hotelSelectorData = trip.accommodationOptions && trip.accommodationOptions.length > 0 ? {
    hotels: trip.accommodationOptions,
    selectedId: selectedHotelId || trip.accommodation?.id || trip.accommodationOptions[0]?.id || '',
    onSelect: (hotelId: string) => {
      if (!canOwnerEdit) {
        toast.error('Seul le propriétaire peut modifier l’hébergement');
        return;
      }
      setSelectedHotelId(hotelId);
      const newHotel = trip.accommodationOptions?.find(h => h.id === hotelId);
      if (newHotel) saveTrip(updateTripWithNewHotel(trip, newHotel));
    },
    searchLinks: generateHotelSearchLinks(
      trip.preferences.destination,
      trip.days[0]?.date || trip.preferences.startDate,
      trip.days[trip.days.length - 1]?.date || trip.preferences.startDate,
      trip.preferences.groupSize || 1
    ),
    nights: trip.preferences.durationDays - 1,
  } : undefined;

  const expenseMembers = useCollaborativeMode
    ? members.map((member) => ({
        userId: member.userId,
        profile: {
          displayName: member.profile.displayName,
          avatarUrl: member.profile.avatarUrl,
        },
      }))
    : user
      ? [{ userId: user.id, profile: { displayName: 'Moi', avatarUrl: null } }]
      : [];

  return (
    <TripErrorBoundary>
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-[#1e3a5f]/5">
        {/* Live Trip Banner */}
        {liveState && trip && (
        <LiveTripBanner
          liveState={liveState}
          trip={trip}
          onShowMap={() => setMainTab('carte')}
          onReportIssue={() => setShowChatPanel(true)}
        />
      )}

      {isOffline && (
        <div className="container mx-auto px-4 pt-3">
          <div className="rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            Mode hors ligne: certaines actions (IA, collaboration, paiements) sont indisponibles.
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-16 z-40 border-b border-[#1e3a5f]/10 bg-background/85 shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="rounded-2xl border border-[#1e3a5f]/10 bg-background/75 px-3 py-2 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-2 sm:gap-3">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <h1 className="font-serif font-bold text-lg">
                    {trip.preferences.origin && <span className="text-muted-foreground font-normal">{trip.preferences.origin} → </span>}
                    {trip.preferences.destination}
                  </h1>
                  {/* Budget badge - visible et coloré si over budget */}
                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    trip.budgetStatus?.isOverBudget
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}>
                    <span>~{trip.totalEstimatedCost}€</span>
                    {trip.budgetStatus?.target && trip.budgetStatus.target > 0 && (
                      <span className="text-[10px] opacity-70">/ {trip.budgetStatus.target}€</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(trip.preferences.startDate), 'd MMM yyyy', { locale: fr })} · {trip.days.length} jour{trip.days.length > 1 ? 's' : ''} · {getAllItems().length} activités · {useCollaborativeMode ? members.length : (trip.preferences.groupSize || 1)} {useCollaborativeMode ? 'collaborateurs' : 'voyageurs'}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {trip.preferences.groupType && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {GROUP_TYPE_LABELS[trip.preferences.groupType]}
                    </span>
                  )}
                  {trip.preferences.activities?.map((act) => (
                    <span key={act} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {ACTIVITY_LABELS[act]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide md:max-w-[60%] md:flex-wrap md:justify-end md:overflow-visible md:pb-0">
              {/* Transport selector - compact popover */}
              {canOwnerEdit && trip.transportOptions && trip.transportOptions.length > 0 && (
                <div className="shrink-0">
                  <TransportOptions
                    options={trip.transportOptions}
                    selectedId={trip.selectedTransport?.id}
                    onSelect={(option) => {
                      const updatedTrip: Trip = {
                        ...trip,
                        selectedTransport: option,
                        preferences: {
                          ...trip.preferences,
                          transport: toTripPreferenceTransportMode(option.mode),
                        },
                        updatedAt: new Date(),
                      };
                      saveTrip(updatedTrip);
                      setTransportChanged(option.id !== originalTransportId);
                    }}
                  />
                </div>
              )}

              {useCollaborativeMode && isOwner && collaborativeTrip && (
                <div className="shrink-0">
                  <TripVisibilitySelector
                    tripId={tripId}
                    currentVisibility={collaborativeTrip.visibility || 'private'}
                  />
                </div>
              )}
              {useCollaborativeMode && !isOwner && collaborativeTrip && (
                <div className="shrink-0">
                  <VisibilityBadge visibility={collaborativeTrip.visibility || 'private'} />
                </div>
              )}

              {canOwnerEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0" disabled={regenerating}>
                      {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline text-xs">Régénérer</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleRegenerateTrip}>Tout régénérer</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {trip.days.map((day) => (
                      <DropdownMenuItem key={day.dayNumber} onClick={() => handleRegenerateDay(day.dayNumber)}>
                        Jour {day.dayNumber}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleRegenerateRestaurants}>Restaurants uniquement</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {canPropose && !editMode && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0" onClick={() => setEditMode(true)} data-tour="edit-mode">
                  <GripVertical className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline text-xs">{canOwnerEdit ? 'Éditer' : 'Proposer'}</span>
                </Button>
              )}
              {canPropose && editMode && (
                <Button variant="default" size="sm" className="gap-1.5 h-8 shrink-0" onClick={() => setEditMode(false)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span className="text-xs">Terminer</span>
                </Button>
              )}

              {useCollaborativeMode && (
                <Sheet open={showCollabPanel} onOpenChange={setShowCollabPanel}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 relative shrink-0 hidden sm:inline-flex">
                      <GitPullRequest className="h-3.5 w-3.5" />
                      {openProposalCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center">
                          {openProposalCount}
                        </span>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader><SheetTitle>Collaboration</SheetTitle></SheetHeader>
                    <div className="mt-6 space-y-6">
                      <SharePanel tripId={tripId} shareCode={shareCode} members={members} currentUserId={user?.id} userRole={userRole} />
                      <ProposalsList
                        proposals={proposals}
                        onVote={handleVote}
                        onDecision={handleProposalDecision}
                        currentUserId={user?.id}
                        canVote={canVoteOnProposals}
                        canOwnerDecide={canOwnerDecide}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
              )}

              {!canOwnerEdit && useCollaborativeMode && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex" onClick={() => setShowCloneModal(true)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}

              {isOwner && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex" onClick={() => setShowShareDialog(true)} data-tour="share-button">
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex" onClick={() => setShowFlythrough(true)} title="Visualisation 3D">
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">3D</span>
              </Button>

              <Button variant="outline" size="sm" className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex" onClick={handleExportPdf} title="Exporter en PDF">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">PDF</span>
              </Button>

              <AddToCalendarDropdown
                savedTripId={dbTrip?.id}
                shareCode={shareCode}
                trip={trip}
              />

              {canOwnerEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex"
                  onClick={() => setShowImportPlaces(true)}
                  title="Importer des lieux depuis Google Maps"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline text-xs">Lieux</span>
                </Button>
              )}

              {canOwnerEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex"
                  onClick={(event) => handleExportDebug(!event.shiftKey)}
                  title="Export debug compact (Shift+clic pour inclure _rawTrip)"
                >
                  <Bug className="h-3.5 w-3.5" />
                </Button>
              )}

              {/* Chat Assistant Button */}
              {canOwnerEdit && (
                <div className="shrink-0 hidden sm:block" data-tour="chat-button">
                  <ChatButton onClick={() => setShowChatPanel(true)} />
                </div>
              )}

              <Sheet open={showMobileActions} onOpenChange={setShowMobileActions}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0 sm:hidden">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    <span className="text-xs">Actions</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
                  <SheetHeader>
                    <SheetTitle>Actions du voyage</SheetTitle>
                  </SheetHeader>
                  <div className="mt-5 grid gap-2">
                    {isOwner && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowShareDialog(true);
                        }}
                      >
                        <Share2 className="h-4 w-4" />
                        Partager le voyage
                      </Button>
                    )}
                    {useCollaborativeMode && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowCollabPanel(true);
                        }}
                      >
                        <GitPullRequest className="h-4 w-4" />
                        Collaboration
                      </Button>
                    )}
                    {!canOwnerEdit && useCollaborativeMode && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowCloneModal(true);
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Cloner ce voyage
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => {
                        setShowMobileActions(false);
                        setShowFlythrough(true);
                      }}
                    >
                      <Globe className="h-4 w-4" />
                      Vue 3D
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start gap-2"
                      onClick={() => {
                        setShowMobileActions(false);
                        handleExportPdf();
                      }}
                    >
                      <Download className="h-4 w-4" />
                      Exporter en PDF
                    </Button>
                    {canOwnerEdit && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowImportPlaces(true);
                        }}
                      >
                        <Upload className="h-4 w-4" />
                        Importer des lieux
                      </Button>
                    )}
                    {canOwnerEdit && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          setShowChatPanel(true);
                        }}
                      >
                        <MessageCircle className="h-4 w-4" />
                        Assistant IA
                      </Button>
                    )}
                    {canOwnerEdit && (
                      <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                          setShowMobileActions(false);
                          handleExportDebug(true);
                        }}
                      >
                        <Bug className="h-4 w-4" />
                        Export debug
                      </Button>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
              </div>
            </div>

            {/* Transport changed warning */}
            {transportChanged && canOwnerEdit && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-900/20">
                <p className="text-xs text-amber-800 dark:text-amber-300">Transport modifié — régénérez pour recalculer horaires et liens</p>
                <Button size="sm" className="h-7 bg-amber-600 text-xs hover:bg-amber-700" onClick={handleRegenerateTrip} disabled={regenerating}>
                  {regenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  Régénérer
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="container mx-auto px-4 py-6">
        {/* Mobile layout - Split View: Map on top + Planning below */}
        <div className="lg:hidden">
          {/* Mini map - always visible on planning tab, fullscreen on carte tab */}
          {mainTab !== 'carte' && !mobileMapFullscreen && (
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-sm">
              <div
                className="relative overflow-hidden border-b border-[#1e3a5f]/15 shadow-sm"
                style={{ height: `${mobileMapHeight}vh` }}
              >
                <TripMap
                  items={editMode ? allItems : activeDayItems}
                  selectedItemId={selectedItemId}
                  hoveredItemId={hoveredItemId || undefined}
                  onItemClick={handleSelectItem}
                  mapNumbers={itemMapNumbers}
                  isVisible={true}
                  importedPlaces={trip.importedPlaces?.items}
                  flightInfo={{
                    departureCity: trip.preferences.origin,
                    departureCoords: trip.preferences.originCoords,
                    arrivalCity: trip.preferences.destination,
                    arrivalCoords: trip.preferences.destinationCoords,
                    stopoverCities: trip.outboundFlight?.stopCities,
                  }}
                />
                {/* Fullscreen toggle */}
                <button
                  className="absolute top-2 right-2 z-[1000] flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 shadow-md backdrop-blur-sm border border-border/50 active:scale-95 transition-transform"
                  onClick={() => setMobileMapFullscreen(true)}
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
              {/* Drag handle to resize */}
              <div
                className="flex items-center justify-center py-0.5 cursor-row-resize touch-none select-none"
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
              >
                <div className="flex items-center gap-1 rounded-full bg-muted/80 px-3 py-0.5">
                  <GripHorizontal className="h-3 w-3 text-muted-foreground/60" />
                </div>
              </div>
            </div>
          )}

          {/* Fullscreen map overlay */}
          {mobileMapFullscreen && (
            <div className="fixed inset-0 z-50 bg-background">
              <div className="h-full w-full">
                <TripMap
                  items={editMode ? allItems : activeDayItems}
                  selectedItemId={selectedItemId}
                  hoveredItemId={hoveredItemId || undefined}
                  onItemClick={handleSelectItem}
                  mapNumbers={itemMapNumbers}
                  isVisible={true}
                  importedPlaces={trip.importedPlaces?.items}
                  flightInfo={{
                    departureCity: trip.preferences.origin,
                    departureCoords: trip.preferences.originCoords,
                    arrivalCity: trip.preferences.destination,
                    arrivalCoords: trip.preferences.destinationCoords,
                    stopoverCities: trip.outboundFlight?.stopCities,
                  }}
                />
              </div>
              <button
                className="absolute top-4 right-4 z-[1000] flex h-10 w-10 items-center justify-center rounded-xl bg-background/90 shadow-lg backdrop-blur-sm border border-border/50 active:scale-95 transition-transform"
                onClick={() => setMobileMapFullscreen(false)}
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          )}

          <Tabs value={mainTab} onValueChange={setMainTab}>
            <TabsList className="mb-2 flex w-full gap-1 overflow-x-auto scroll-snap-x rounded-xl border border-[#1e3a5f]/12 bg-background/85 p-1 backdrop-blur-xl scrollbar-hide" data-tour="tabs">
              {liveState && <TabsTrigger value="live" className="shrink-0 px-4 py-2 text-sm bg-gradient-to-r from-purple-500 to-blue-500 text-white data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-blue-600">🔴 Live</TabsTrigger>}
              <TabsTrigger value="planning" className="shrink-0 px-4 py-2 text-sm">Planning</TabsTrigger>
              <TabsTrigger value="reserver" className="shrink-0 px-4 py-2 text-sm">Réserver</TabsTrigger>
              <TabsTrigger value="carte" className="shrink-0 px-4 py-2 text-sm">Carte</TabsTrigger>
              {user && <TabsTrigger value="photos" className="shrink-0 px-4 py-2 text-sm">Photos</TabsTrigger>}
              {user && <TabsTrigger value="depenses" className="shrink-0 px-4 py-2 text-sm">Dépenses</TabsTrigger>}
              <TabsTrigger value="infos" className="shrink-0 px-4 py-2 text-sm">Infos</TabsTrigger>
            </TabsList>

            {liveState && (
              <TabsContent value="live">
                <LiveTripDashboard
                  liveState={liveState}
                  trip={trip}
                  onNavigateToActivity={(activityId) => {
                    const item = trip.days.flatMap(d => d.items).find(i => i.id === activityId);
                    if (item) {
                      setSelectedItemId(activityId);
                      setMobileMapFullscreen(true);
                    }
                  }}
                />
              </TabsContent>
            )}

            <TabsContent value="planning">
              <div className="space-y-0 rounded-2xl border border-[#1e3a5f]/10 bg-background/65 p-3 shadow-sm">
                {/* Planning view toggle */}
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Itinéraire</h2>
                  <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5" data-tour="view-toggle">
                    <Button variant={planningView === 'timeline' ? 'default' : 'ghost'} size="sm" className="h-9 text-sm px-3" onClick={() => setPlanningView('timeline')}>Timeline</Button>
                    <Button variant={planningView === 'calendar' ? 'default' : 'ghost'} size="sm" className="h-9 text-sm px-3" onClick={() => setPlanningView('calendar')}>Calendrier</Button>
                  </div>
                </div>

                {planningView === 'calendar' ? (
                  <div className="h-[60vh]">
                    <CalendarView
                      days={trip.days}
                      isEditable={canOwnerEdit}
                      onUpdateItem={handleCalendarUpdateItem}
                      onClickItem={canOwnerEdit ? handleEditItem : undefined}
                      onClickSlot={canOwnerEdit ? handleCalendarSlotClick : undefined}
                      onCreateSlotRange={canOwnerEdit ? handleCalendarSlotRange : undefined}
                      onMoveItemCrossDay={canOwnerEdit ? handleCalendarMoveItemCrossDay : undefined}
                    />
                  </div>
                ) : editMode && !isDesktop ? (
                  <DraggableTimeline
                    days={trip.days}
                    isEditable={canPropose}
                    isOwner={isOwner}
                    onDirectUpdate={canOwnerEdit ? handleDirectUpdate : undefined}
                    onProposalCreate={!canOwnerEdit && canPropose ? handleProposalFromDrag : undefined}
                    onEditItem={canOwnerEdit ? handleEditItem : undefined}
                    onAddItem={canOwnerEdit ? (dayNumber) => {
                      setAddActivityDay(dayNumber);
                      setAddActivityDefaultTime(undefined);
                      setAddActivityDefaultEndTime(undefined);
                      setShowAddActivityModal(true);
                    } : undefined}
                    hotelSelectorData={hotelSelectorData}
                  />
                ) : !editMode ? (
                  <div>
                    {/* Day pills - sticky below map */}
                    <div className="sticky top-16 z-10 bg-background/95 backdrop-blur-sm border-b border-[#1e3a5f]/10 -mx-3 px-3 py-1.5"
                      style={mainTab !== 'carte' && !mobileMapFullscreen ? { top: `calc(4rem + ${mobileMapHeight}vh + 1.5rem)` } : undefined}
                    >
                      <div className="flex h-auto w-full flex-nowrap gap-1.5 overflow-x-auto scroll-snap-x bg-transparent p-0.5 scrollbar-hide">
                        {trip.days.map((day) => (
                          <button
                            key={day.dayNumber}
                            onClick={() => handleDayChange(day.dayNumber.toString())}
                            className={`relative shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 ${
                              activeDay === day.dayNumber.toString()
                                ? 'bg-primary text-primary-foreground shadow-md'
                                : 'border border-[#1e3a5f]/15 bg-background/70 text-foreground hover:bg-muted/60'
                            }`}
                          >
                            Jour {day.dayNumber}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Animated day content */}
                    <AnimatePresence mode="wait" initial={false}>
                      {trip.days.filter(d => d.dayNumber.toString() === activeDay).map((day) => {
                        const idx = trip.days.indexOf(day);
                        return (
                          <motion.div
                            key={day.dayNumber}
                            initial={{ x: dayDirection.current * 40, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: dayDirection.current * -40, opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeOut' }}
                          >
                            <DayTimeline
                              day={day}
                              selectedItemId={selectedItemId}
                              globalIndexOffset={getDayIndexOffset(day.dayNumber)}
                              mapNumbers={itemMapNumbers}
                              onSelectItem={handleSelectItem}
                              onEditItem={canOwnerEdit ? handleEditItem : undefined}
                              onDeleteItem={canOwnerEdit ? handleDeleteItem : undefined}
                              onMoveItem={canOwnerEdit ? handleMoveItem : undefined}
                              onHoverItem={setHoveredItemId}
                              showMoveButtons={canOwnerEdit}
                              renderSwapButton={renderSwapButton}
                              hotelSelectorData={hotelSelectorData}
                              onSelectRestaurantAlternative={canOwnerEdit ? handleSelectRestaurantAlternative : undefined}
                              onSelectSelfMeal={canOwnerEdit ? handleSelectSelfMeal : undefined}
                            />
                            {canOwnerEdit && idx > 0 && idx < trip.days.length - 1 && (
                              <div className="flex items-center justify-center py-3 mt-3">
                                <Button
                                  variant="outline"
                                  className="h-10 text-sm text-muted-foreground gap-2"
                                  onClick={() => handleInsertDay(day.dayNumber)}
                                >
                                  <CalendarPlus className="h-4 w-4" />
                                  Ajouter un jour après le jour {day.dayNumber}
                                </Button>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="reserver">
              <BookingChecklist trip={trip} />
            </TabsContent>

            <TabsContent value="carte">
              <div className="h-[calc(100vh-10rem)] min-h-[400px] rounded-2xl overflow-hidden border border-[#1e3a5f]/15 shadow-sm">
                <TripMap items={editMode ? allItems : activeDayItems} selectedItemId={selectedItemId} hoveredItemId={hoveredItemId || undefined} onItemClick={handleSelectItem} mapNumbers={itemMapNumbers} isVisible={mainTab === 'carte'} importedPlaces={trip.importedPlaces?.items} flightInfo={{ departureCity: trip.preferences.origin, departureCoords: trip.preferences.originCoords, arrivalCity: trip.preferences.destination, arrivalCoords: trip.preferences.destinationCoords, stopoverCities: trip.outboundFlight?.stopCities }} />
              </div>
            </TabsContent>

            <TabsContent value="infos">
              <div className="space-y-6">
                {trip.carbonFootprint && <CarbonFootprint data={trip.carbonFootprint} />}
                {trip.travelTips && <TravelTips data={trip.travelTips} />}
              </div>
            </TabsContent>

            <TabsContent value="depenses">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Dépenses partagées
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ExpensesPanel tripId={tripId} members={expenseMembers} currentUserId={user?.id || ''} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="photos">
              <Card>
                <CardHeader><CardTitle className="text-lg">Photos</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {canOwnerEdit && <PhotoUploader tripId={tripId} />}
                  <PhotoGallery tripId={tripId} isOwner={isOwner} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Desktop layout: planning left (60%) + sticky map right (40%) */}
        <div className="hidden lg:flex gap-4">
          {/* Left: Planning */}
          <div className="flex-[3] min-w-0">
            <Tabs value={mainTab} onValueChange={setMainTab}>
              <TabsList className="mb-3 rounded-xl border border-[#1e3a5f]/12 bg-background/70 p-1" data-tour="tabs">
                {liveState && <TabsTrigger value="live" className="text-sm bg-gradient-to-r from-purple-500 to-blue-500 text-white data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-blue-600">🔴 Live</TabsTrigger>}
                <TabsTrigger value="planning" className="text-sm">Planning</TabsTrigger>
                <TabsTrigger value="reserver" className="text-sm">Reserver</TabsTrigger>
                {user && <TabsTrigger value="photos" className="text-sm">Photos</TabsTrigger>}
                {user && <TabsTrigger value="depenses" className="text-sm">Dépenses partagées</TabsTrigger>}
                <TabsTrigger value="infos" className="text-sm">Infos</TabsTrigger>
              </TabsList>

              {liveState && (
                <TabsContent value="live">
                  <LiveTripDashboard
                    liveState={liveState}
                    trip={trip}
                    onNavigateToActivity={(activityId) => {
                      const item = trip.days.flatMap(d => d.items).find(i => i.id === activityId);
                      if (item) {
                        setSelectedItemId(activityId);
                        // The map is already visible on desktop, just highlight the item
                        setHoveredItemId(activityId);
                      }
                    }}
                  />
                </TabsContent>
              )}

              <TabsContent value="planning">
                {/* Hotel selector moved to check-in in timeline */}

                {/* Planning view toggle */}
                <div className="mb-3 flex items-center justify-between rounded-xl border border-[#1e3a5f]/10 bg-background/65 px-3 py-2">
                  <h2 className="font-semibold">Itinéraire</h2>
                  <div className="flex items-center gap-2">
                    {editMode && planningView === 'timeline' && (
                      <span className="text-xs text-muted-foreground">Glissez pour réorganiser</span>
                    )}
                    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5" data-tour="view-toggle">
                      <Button variant={planningView === 'timeline' ? 'default' : 'ghost'} size="sm" className="h-6 text-xs px-2" onClick={() => setPlanningView('timeline')}>Timeline</Button>
                      <Button variant={planningView === 'calendar' ? 'default' : 'ghost'} size="sm" className="h-6 text-xs px-2" onClick={() => setPlanningView('calendar')}>Calendrier</Button>
                    </div>
                  </div>
                </div>

                {planningView === 'calendar' ? (
                  <div className="h-[75vh]">
                    <CalendarView
                      days={trip.days}
                      isEditable={canOwnerEdit}
                      onUpdateItem={handleCalendarUpdateItem}
                      onClickItem={canOwnerEdit ? handleEditItem : undefined}
                      onClickSlot={canOwnerEdit ? handleCalendarSlotClick : undefined}
                      onCreateSlotRange={canOwnerEdit ? handleCalendarSlotRange : undefined}
                      onMoveItemCrossDay={canOwnerEdit ? handleCalendarMoveItemCrossDay : undefined}
                    />
                  </div>
                ) : editMode && isDesktop ? (
                  <DraggableTimeline
                    days={trip.days}
                    isEditable={canPropose}
                    isOwner={isOwner}
                    onDirectUpdate={canOwnerEdit ? handleDirectUpdate : undefined}
                    onProposalCreate={!canOwnerEdit && canPropose ? handleProposalFromDrag : undefined}
                    onEditItem={canOwnerEdit ? handleEditItem : undefined}
                    onAddItem={canOwnerEdit ? (dayNumber) => {
                      setAddActivityDay(dayNumber);
                      setAddActivityDefaultTime(undefined);
                      setAddActivityDefaultEndTime(undefined);
                      setShowAddActivityModal(true);
                    } : undefined}
                    hotelSelectorData={hotelSelectorData}
                  />
                ) : !editMode ? (
                  <div className="space-y-6">
                    {trip.days.map((day, idx) => (
                      <div key={day.dayNumber}>
                        <DayTimeline
                          day={day}
                          selectedItemId={selectedItemId}
                          globalIndexOffset={getDayIndexOffset(day.dayNumber)}
                          mapNumbers={itemMapNumbers}
                          onSelectItem={handleSelectItem}
                          onEditItem={canOwnerEdit ? handleEditItem : undefined}
                          onDeleteItem={canOwnerEdit ? handleDeleteItem : undefined}
                          onMoveItem={canOwnerEdit ? handleMoveItem : undefined}
                          onHoverItem={setHoveredItemId}
                          onAddItem={canOwnerEdit ? (dayNumber) => { setAddActivityDay(dayNumber); setAddActivityDefaultTime(undefined); setAddActivityDefaultEndTime(undefined); setShowAddActivityModal(true); } : undefined}
                          showMoveButtons={canOwnerEdit}
                          renderSwapButton={renderSwapButton}
                          hotelSelectorData={hotelSelectorData}
                          onSelectRestaurantAlternative={canOwnerEdit ? handleSelectRestaurantAlternative : undefined}
                          onSelectSelfMeal={canOwnerEdit ? handleSelectSelfMeal : undefined}
                        />
                        {/* Bouton "Ajouter un jour" entre les jours (sauf après le dernier) */}
                        {canOwnerEdit && idx < trip.days.length - 1 && idx > 0 && (
                          <div className="flex items-center justify-center py-2 group">
                            <div className="flex-1 h-px bg-border group-hover:bg-primary/30 transition-colors" />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground hover:text-primary gap-1.5 mx-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleInsertDay(day.dayNumber)}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />
                              Ajouter un jour
                            </Button>
                            <div className="flex-1 h-px bg-border group-hover:bg-primary/30 transition-colors" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="reserver">
                <BookingChecklist trip={trip} />
              </TabsContent>

              <TabsContent value="infos">
                <div className="space-y-6">
                  {trip.carbonFootprint && <CarbonFootprint data={trip.carbonFootprint} />}
                  {trip.travelTips && <TravelTips data={trip.travelTips} />}
                </div>
              </TabsContent>

              <TabsContent value="depenses">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Wallet className="h-5 w-5" />
                      Dépenses partagées
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ExpensesPanel tripId={tripId} members={expenseMembers} currentUserId={user?.id || ''} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="photos">
                <Card>
                <CardHeader><CardTitle className="text-lg">Photos</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    {canOwnerEdit && <PhotoUploader tripId={tripId} />}
                    <PhotoGallery tripId={tripId} isOwner={isOwner} />
                </CardContent>
              </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: Sticky map */}
          <div className="flex-[2] min-w-0" data-tour="map-panel">
            <div className="sticky top-[73px] h-[calc(100vh-73px-2rem)] rounded-lg overflow-hidden border">
              <TripMap
                items={allItems}
                selectedItemId={selectedItemId}
                hoveredItemId={hoveredItemId || undefined}
                onItemClick={handleSelectItem}
                mapNumbers={itemMapNumbers}
                isVisible={true}
                importedPlaces={trip.importedPlaces?.items}
                flightInfo={{
                  departureCity: trip.preferences.origin,
                  departureCoords: trip.preferences.originCoords,
                  arrivalCity: trip.preferences.destination,
                  arrivalCoords: trip.preferences.destinationCoords,
                  stopoverCities: trip.outboundFlight?.stopCities,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Comments section */}
      <div className="container mx-auto px-4 py-6 border-t">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CommentsSection tripId={tripId} />
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <CreateProposalDialog open={showProposalDialog} onClose={() => { setShowProposalDialog(false); setPendingChanges([]); }} onSubmit={handleCreateProposal} pendingChanges={pendingChanges} />

      {trip && (
        <ShareTripDialog
          open={showShareDialog}
          isOwner={isOwner}
          currentVisibility={collaborativeTrip?.visibility || 'private'}
          onOpenChange={(open) => { setShowShareDialog(open); if (!open) { refetch(); setUseCollaborativeMode(true); } }}
          trip={trip}
          tripId={tripId}
          onTripSaved={(savedId) => { window.history.replaceState(null, '', `/trip/${savedId}`); }}
        />
      )}

      {showCloneModal && trip && (
        <CloneTripModal isOpen={showCloneModal} onClose={() => setShowCloneModal(false)} tripId={tripId} tripTitle={collaborativeTrip?.title || `Voyage à ${trip.preferences.destination}`} originalDuration={trip.preferences.durationDays} />
      )}

      <ActivityEditModal item={editingItem} isOpen={showEditModal} onClose={() => { setShowEditModal(false); setEditingItem(null); }} onSave={handleSaveItem} onDelete={handleDeleteItem} />

      {trip && (
        <AddActivityModal isOpen={showAddActivityModal} onClose={() => setShowAddActivityModal(false)} onAdd={handleAddNewItem} dayNumber={addActivityDay} destination={trip.preferences?.destination || collaborativeTrip?.destination || ''} defaultStartTime={addActivityDefaultTime} defaultEndTime={addActivityDefaultEndTime} />
      )}

      <ImportPlaces
        open={showImportPlaces}
        onOpenChange={setShowImportPlaces}
        onImport={handleImportPlaces}
        destinationCoords={trip?.preferences.destinationCoords}
      />

      {/* Chat Panel for AI-powered itinerary modifications */}
      {trip && canOwnerEdit && (
        <ChatPanel
          tripId={tripId}
          trip={{
            days: trip.days,
            preferences: trip.preferences,
          }}
          isOpen={showChatPanel}
          onClose={() => setShowChatPanel(false)}
          onDaysUpdate={handleDirectUpdate}
        />
      )}

      {/* 3D Flythrough */}
      {trip && (
        <TripFlythrough
          trip={trip}
          isOpen={showFlythrough}
          onClose={() => setShowFlythrough(false)}
        />
      )}

      {/* Tour guidé pour les nouveaux utilisateurs */}
      {trip && <TripOnboarding />}
      </div>
    </TripErrorBoundary>
  );
}
