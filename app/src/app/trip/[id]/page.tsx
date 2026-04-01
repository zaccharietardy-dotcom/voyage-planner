'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useGoBack } from '@/hooks/useGoBack';
import dynamic from 'next/dynamic';
import { Trip, TripItem, TripDay, Accommodation, GROUP_TYPE_LABELS, ACTIVITY_LABELS } from '@/lib/types';
import { DayTimeline, CarbonFootprint, TransportOptions, BookingChecklist } from '@/components/trip';
import { FlightDatePicker } from '@/components/trip/FlightDatePicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Drawer, DrawerContent, DrawerHandle, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { TripOverviewTab } from '@/components/trip/TripOverviewTab';
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
  AlertTriangle,
  X,
  Check,
  Pencil,
  Settings2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { generateHotelSearchLinks } from '@/lib/services/linkGenerator';
import { clusterAccommodationsByArea } from '@/lib/services/neighbourhoodPricing';
import { useAuth } from '@/components/auth';
import { usePresence } from '@/hooks/usePresence';
import { PresenceAvatars } from '@/components/trip/PresenceAvatars';
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
import { buildTravelIntelligence } from '@/lib/services/travelIntelligence';
import { TripBudgetComparator, TripBudgetBreakdown } from '@/components/trip/TripBudgetComparator';
import { PhotoGallery } from '@/components/photos/PhotoGallery';
import { PhotoUploader } from '@/components/photos/PhotoUploader';
import { PastTripView } from '@/components/trip/PastTripView';
import { ProposedChange } from '@/lib/types/collaboration';
import { recalculateTimes, cascadeRecalculate, insertDay } from '@/lib/services/itineraryCalculator';
import { optimizeDay } from '@/lib/services/routeOptimizer';
import { Attraction } from '@/lib/services/attractions';
import { ActivityAlternativesDialog } from '@/components/trip/ActivitySwapButton';
import { AddActivityModal } from '@/components/trip/AddActivityModal';
import { ActivityPool } from '@/components/trip/ActivityPool';
import { CalendarView } from '@/components/trip/CalendarView';
import { CommentsSection } from '@/components/trip/CommentsSection';
import { ChatPanel, ChatButton } from '@/components/trip/ChatPanel';
import { TripOnboarding } from '@/components/trip/TripOnboarding';
import { ImportPlaces } from '@/components/trip/ImportPlaces';
import { ImportBooking } from '@/components/trip/ImportBooking';
import type { ParsedBooking } from '@/lib/services/bookingParser';
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
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
// exportTripPdf is dynamically imported on-demand (~650KB jsPDF + autotable)
import { useLiveTrip } from '@/hooks/useLiveTrip';
import { LiveTripBanner } from '@/components/trip/LiveTripBanner';
import { LiveTripDashboard } from '@/components/trip/LiveTripDashboard';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useActivityVotes } from '@/hooks/useActivityVotes';
import { cacheTripById, readCachedTripById } from '@/lib/mobile/offline-cache';
import { generateFeedbackCards } from '@/lib/generateFeedbackCards';
import type { FeedbackCard } from '@/lib/types/pipelineQuestions';
import { TripFeedbackCards } from '@/components/trip/TripFeedbackCards';
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
  const goBack = useGoBack('/');
  const tripId = params.id as string;
  const { user } = useAuth();
  const { isOffline } = useConnectivity();
  const { presenceUsers, updateView } = usePresence(
    tripId,
    user ? { id: user.id, displayName: user.user_metadata?.full_name || user.email?.split('@')[0], avatarUrl: user.user_metadata?.avatar_url } : undefined
  );

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
  const [swapItem, setSwapItem] = useState<TripItem | null>(null);
  const [showLiveDashboard, setShowLiveDashboard] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [mobileMapHeight, setMobileMapHeight] = useState(30); // vh percentage for mobile split view
  const [dismissedViolations, setDismissedViolations] = useState(false);
  const [mobileMapFullscreen, setMobileMapFullscreen] = useState(false);
  const [feedbackCards, setFeedbackCards] = useState<FeedbackCard[]>([]);
  const [showFeedbackCards, setShowFeedbackCards] = useState(false);
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

  // Track presence view changes
  useEffect(() => {
    updateView(mainTab);
  }, [mainTab, updateView]);

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

  // Activity voting (collaborative mode)
  const { getVoteData, castVote } = useActivityVotes(tripId);

  // Post-generation feedback cards — show on fresh trips (<2 min old)
  useEffect(() => {
    if (!trip || feedbackCards.length > 0) return;
    const dismissedKey = `feedback-dismissed-${tripId}`;
    if (safeGetItem(dismissedKey)) return;

    const createdAt = trip.createdAt ? new Date(trip.createdAt).getTime() : 0;
    const isFresh = Date.now() - createdAt < 2 * 60 * 1000;
    if (!isFresh) return;

    try {
      const cards = generateFeedbackCards(trip);
      if (cards.length > 0) {
        setFeedbackCards(cards);
        // showFeedbackCards bottom sheet removed — cards now shown inline via ActivityCard
      }
    } catch (e) {
      console.warn('[FeedbackCards] Failed to generate:', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

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
      toast.error('Erreur lors de la régénération du voyage');
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
    const previousTrip = trip;
    const updatedDays = cascadeRecalculate(
      trip.days.map((day) => ({
        ...day,
        items: day.items.filter((i) => i.id !== item.id),
      })),
      item.id,
      'delete'
    );
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast('Activité supprimée', {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => {
          saveTrip({ ...previousTrip, updatedAt: new Date() });
        },
      },
    });
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

  const handleDurationChange = useCallback((item: TripItem, newDuration: number) => {
    if (!trip) return;
    const updatedDays = trip.days.map((day) => ({
      ...day,
      items: day.items.map((i) => {
        if (i.id !== item.id) return i;
        const startMin = parseInt(i.startTime.split(':')[0]) * 60 + parseInt(i.startTime.split(':')[1]);
        const endMin = startMin + newDuration;
        const newEndTime = `${Math.floor(endMin / 60) % 24}`.padStart(2, '0') + ':' + `${endMin % 60}`.padStart(2, '0');
        return { ...i, duration: newDuration, endTime: newEndTime };
      }),
    }));
    const recalculated = cascadeRecalculate(updatedDays, item.id, 'duration');
    const updatedTrip = { ...trip, days: recalculated, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success(`Durée mise à jour: ${newDuration} min`);
  }, [trip, saveTrip]);

  const handleTransportModeChange = useCallback(async (item: TripItem, newMode: string) => {
    if (!trip) return;

    // Immediately update mode with estimated time (responsive UI)
    const speeds: Record<string, number> = { walk: 4.5, transit: 25, public: 25, bike: 15, car: 35, driving: 35, taxi: 30 };
    const speed = speeds[newMode] || 4.5;
    const distance = item.distanceFromPrevious || 0;
    const estimatedTime = distance > 0 ? Math.max(2, Math.round((distance / speed) * 60)) : item.timeFromPrevious;

    const applyUpdate = (time: number | undefined, transitInfo?: TripItem['transitInfo'], polyline?: string) => {
      const updatedDays = trip.days.map((day) => ({
        ...day,
        items: day.items.map((i) =>
          i.id === item.id ? {
            ...i,
            transportToPrevious: newMode as TripItem['transportToPrevious'],
            timeFromPrevious: time ?? estimatedTime,
            transitInfo: transitInfo ?? (newMode !== 'transit' && newMode !== 'public' ? undefined : i.transitInfo),
            routePolylineFromPrevious: polyline ?? i.routePolylineFromPrevious,
          } : i
        ),
      }));
      const recalculated = cascadeRecalculate(updatedDays, item.id, 'move');
      saveTrip({ ...trip, days: recalculated, updatedAt: new Date() });
    };

    // Apply estimated time immediately
    applyUpdate(estimatedTime);

    // Then fetch real directions from Google API (async)
    const prevItem = trip.days
      .flatMap(d => d.items)
      .find((_i, idx, arr) => idx < arr.length - 1 && arr[idx + 1]?.id === item.id);
    if (!prevItem?.latitude || !prevItem?.longitude || !item.latitude || !item.longitude) return;

    const apiMode = newMode === 'walk' ? 'walking' : (newMode === 'transit' || newMode === 'public') ? 'transit' : 'driving';
    try {
      const res = await fetch(`/api/directions?fromLat=${prevItem.latitude}&fromLng=${prevItem.longitude}&toLat=${item.latitude}&toLng=${item.longitude}&mode=${apiMode}`);
      if (!res.ok) return;
      const data = await res.json();
      applyUpdate(
        data.duration ? Math.round(data.duration) : undefined,
        data.transitLines?.length > 0 ? { lines: data.transitLines, walkingDistance: 0 } : undefined,
        data.overviewPolyline || undefined,
      );
    } catch { /* keep estimated time */ }
  }, [trip, saveTrip]);

  // Feedback card handlers (stable refs to avoid re-renders)
  const handleFeedbackKeep = useCallback(() => {}, []);

  const handleFeedbackSwap = useCallback((card: FeedbackCard) => {
    if (!trip) return;
    if (card.type === 'restaurant_swap') {
      for (const day of trip.days) {
        const item = day.items.find(i => i.id === card.targetItemId);
        if (!item || !item.restaurantAlternatives) continue;
        const alt = item.restaurantAlternatives.find(r => (r.id || r.name) === card.optionB.id);
        if (alt) {
          handleSelectRestaurantAlternative(item, alt);
          return;
        }
      }
    } else if (card.type === 'activity_swap') {
      const pool = trip.attractionPool || [];
      const newAttraction = pool.find(a => (a.id || a.name) === card.optionB.id);
      if (newAttraction) {
        for (const day of trip.days) {
          const item = day.items.find(i => i.id === card.targetItemId);
          if (item) {
            handleSwapActivity(item, newAttraction);
            return;
          }
        }
      }
    }
  }, [trip, handleSelectRestaurantAlternative, handleSwapActivity]);

  const handleFeedbackDismiss = useCallback(() => {
    setShowFeedbackCards(false);
    safeSetItem(`feedback-dismissed-${tripId}`, 'true');
  }, [tripId]);

  const handleSwapClick = useCallback((item: TripItem) => {
    if (!trip?.attractionPool || trip.attractionPool.length === 0) return;
    setSwapItem(item);
  }, [trip?.attractionPool]);

  const handleEditTime = useCallback((item: TripItem, startTime: string, endTime: string) => {
    if (!trip) return;
    const updatedDays = cascadeRecalculate(
      trip.days.map((day) => ({
        ...day,
        items: day.items.map((i) =>
          i.id === item.id ? { ...i, startTime, endTime } : i
        ),
      })),
      item.id,
      'move'
    );
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success('Horaire modifié');
  }, [trip, saveTrip]);

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

  const handleOptimizeDay = useCallback((dayNumber: number) => {
    if (!trip) return;
    const hotelLat = trip.accommodation?.latitude;
    const hotelLng = trip.accommodation?.longitude;
    if (!hotelLat || !hotelLng) {
      toast.error('Pas de coordonnées hôtel pour optimiser');
      return;
    }
    const optimizedDays = optimizeDay(trip.days, dayNumber, hotelLat, hotelLng);
    const updatedTrip = { ...trip, days: optimizedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success(`Jour ${dayNumber} optimisé !`);
  }, [trip, saveTrip]);

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

  const handleAddFromPool = useCallback((attraction: Attraction, dayNumber: number) => {
    if (!trip) return;
    const day = trip.days.find(d => d.dayNumber === dayNumber);
    if (!day) return;
    const lastItem = day.items[day.items.length - 1];
    const startTime = lastItem?.endTime || '10:00';
    const [h, m] = startTime.split(':').map(Number);
    const duration = attraction.duration || 60;
    const endH = h + Math.floor((m + duration) / 60);
    const endM = (m + duration) % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    const newItem: TripItem = {
      id: crypto.randomUUID(),
      dayNumber,
      startTime,
      endTime,
      type: 'activity',
      title: attraction.name,
      description: attraction.description || '',
      locationName: attraction.name,
      latitude: attraction.latitude,
      longitude: attraction.longitude,
      orderIndex: day.items.length,
      imageUrl: attraction.imageUrl || '',
      rating: attraction.rating,
      duration,
      estimatedCost: attraction.estimatedCost,
      googleMapsPlaceUrl: attraction.googleMapsUrl || '',
      dataReliability: attraction.dataReliability || 'verified',
    };

    const updatedDays = trip.days.map(d => {
      if (d.dayNumber !== dayNumber) return d;
      return { ...d, items: [...d.items, newItem] };
    });
    const updatedTrip = { ...trip, days: updatedDays, updatedAt: new Date() };
    saveTrip(updatedTrip);
    toast.success(`${attraction.name} ajouté au jour ${dayNumber}`);
  }, [trip, saveTrip]);

  const handleImportBooking = useCallback((booking: ParsedBooking) => {
    if (!trip) return;
    const newItem: TripItem = {
      id: crypto.randomUUID(),
      dayNumber: 1,
      startTime: booking.startTime || '10:00',
      endTime: booking.endTime || '11:00',
      type: booking.type === 'flight' ? 'flight' : booking.type === 'hotel' ? 'checkin' : 'activity',
      title: booking.name,
      description: booking.confirmationCode ? `Réf: ${booking.confirmationCode}` : '',
      locationName: booking.address || booking.name,
      latitude: 0,
      longitude: 0,
      orderIndex: 0,
      estimatedCost: booking.price,
      duration: 60,
      dataReliability: 'verified',
    };

    // Find the right day based on date
    if (booking.date) {
      const bookingDate = new Date(booking.date);
      const matchingDay = trip.days.find(d => {
        const dayDate = new Date(d.date);
        return dayDate.toDateString() === bookingDate.toDateString();
      });
      if (matchingDay) newItem.dayNumber = matchingDay.dayNumber;
    }

    handleAddNewItem(newItem);
    toast.success(`Réservation importée: ${booking.name}`);
  }, [trip, handleAddNewItem]);

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
    const recalculatedDays = cascadeRecalculate(updatedDays, item.id, 'move');
    const updatedTrip = { ...trip, days: recalculatedDays, updatedAt: new Date() };
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
    for (const day of trip.days) {
      let num = 1;
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

  // Stable flightInfo for TripMap — avoid re-creating object on every render
  const flightInfo = useMemo(() => trip ? ({
    departureCity: trip.preferences.origin,
    departureCoords: trip.preferences.originCoords,
    arrivalCity: trip.preferences.destination,
    arrivalCoords: trip.preferences.destinationCoords,
    stopoverCities: trip.outboundFlight?.stopCities,
  }) : undefined, [trip?.preferences.origin, trip?.preferences.originCoords, trip?.preferences.destination, trip?.preferences.destinationCoords, trip?.outboundFlight?.stopCities]);

  // Neighbourhood pricing cells for "Where to Stay" map overlay
  const neighbourhoodCells = useMemo(() => {
    if (!trip?.accommodationOptions || trip.accommodationOptions.length === 0) return undefined;
    return clusterAccommodationsByArea(trip.accommodationOptions);
  }, [trip?.accommodationOptions]);

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
      <div className="min-h-screen bg-[#020617] relative">
        <PremiumBackground />
        
        {/* Hero Section - Visual & Immersive */}
        <div className="relative h-[25vh] md:h-[35vh] w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#020617]/40 to-[#020617] z-10" />
          {(trip as Trip & { cover_url?: string }).cover_url ? (
            <motion.img
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 10, ease: "linear" }}
              src={(trip as Trip & { cover_url?: string }).cover_url}
              alt={trip.preferences.destination}
              className="h-full w-full object-cover opacity-60"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-gold/20 via-blue-900/40 to-black" />
          )}
          
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-8 px-4 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="h-px w-8 bg-gold/50" />
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gold">Itinéraire Signature</span>
                <div className="h-px w-8 bg-gold/50" />
              </div>
              <h1 className="font-display text-4xl md:text-6xl font-black text-white tracking-tight drop-shadow-2xl">
                {trip.preferences.destination}
              </h1>
              <p className="mt-2 text-white/60 font-medium tracking-[0.1em] uppercase text-[10px] md:text-xs">
                {format(new Date(trip.preferences.startDate), 'd MMMM yyyy', { locale: fr })} · {trip.days.length} Jours de découverte
              </p>
            </motion.div>
          </div>
        </div>

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
            Mode hors ligne: certaines actions (Calculs, collaboration, paiements) sont indisponibles.
          </div>
        </div>
      )}

      {/* Contract violations banner */}
      {!dismissedViolations && trip.contractViolations && trip.contractViolations.length > 0 && (
        <div className="container mx-auto px-4 pt-3">
          <div className="relative flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-900/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex-1 space-y-0.5">
              <p className="text-sm font-medium text-red-800 dark:text-red-300">Itinéraire dégradé</p>
              {trip.contractViolations.slice(0, 5).map((v, i) => (
                <p key={i} className="text-xs text-red-700 dark:text-red-400">{v}</p>
              ))}
              {trip.contractViolations.length > 5 && (
                <p className="text-xs text-red-500 dark:text-red-500">
                  +{trip.contractViolations.length - 5} autre{trip.contractViolations.length - 5 > 1 ? 's' : ''} violation{trip.contractViolations.length - 5 > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => setDismissedViolations(true)}
              className="shrink-0 rounded-md p-1 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Adapt banner for non-owners viewing a public trip */}
      {trip && !isOwner && !localIsOwner && isDesktop && !showCloneModal && (
        <div className="sticky top-16 z-50 bg-gradient-to-r from-primary/90 to-primary backdrop-blur-sm border-b border-primary/20">
          <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-medium text-primary-foreground">
              Ce voyage vous inspire ?
            </span>
            <button
              onClick={() => setShowCloneModal(true)}
              className="inline-flex items-center gap-1.5 bg-white text-foreground text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-white/90 transition-colors shadow-sm"
            >
              Adapter à mes dates
            </button>
          </div>
        </div>
      )}

      {/* Header — hidden on mobile (replaced by floating header over map) */}
      <header className={`sticky top-16 z-40 border-b border-gold/10 bg-background/80 backdrop-blur-xl shadow-lg ${isDesktop ? '' : 'hidden'}`}>
        <div className="container mx-auto px-4 py-4">
          <div className="rounded-[2rem] border border-gold/20 bg-white/50 dark:bg-white/5 px-6 py-4 shadow-xl shadow-gold/5 backdrop-blur-md">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-5">
                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-gold/10 hover:text-gold transition-all" onClick={goBack}>
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-4">
                    <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                      {trip.preferences.origin && <span className="text-muted-foreground/60 font-normal">{trip.preferences.origin} <ChevronsLeftRight className="inline h-4 w-4 mx-1 rotate-0 opacity-40" /> </span>}
                      {trip.preferences.destination}
                    </h1>
                    {/* Budget badge - visible et coloré si over budget */}
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border shadow-sm transition-all",
                      trip.budgetStatus?.isOverBudget
                        ? "bg-red-500/10 text-red-500 border-red-500/20"
                        : "bg-gold/10 text-gold border-gold/20"
                    )}>
                      <Wallet className="h-3.5 w-3.5" />
                      <span>~{trip.totalEstimatedCost}€</span>
                      {trip.budgetStatus?.target && trip.budgetStatus.target > 0 && (
                        <span className="opacity-50 font-medium">/ {trip.budgetStatus.target}€</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                      {format(new Date(trip.preferences.startDate), 'd MMM yyyy', { locale: fr })} · {trip.days.length} jour{trip.days.length > 1 ? 's' : ''} · {getAllItems().length} étapes
                    </p>
                    <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                    <PresenceAvatars users={presenceUsers} />
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 p-1 bg-muted/30 rounded-2xl border border-border/40">
                  {canOwnerEdit && trip.transportOptions && trip.transportOptions.length > 0 && (
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
                  )}
                  
                  <div className="h-6 w-px bg-border/40 mx-1" />

                  {useCollaborativeMode && isOwner && collaborativeTrip && (
                    <TripVisibilitySelector
                      tripId={tripId}
                      currentVisibility={collaborativeTrip.visibility || 'private'}
                    />
                  )}

                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:text-gold hover:bg-gold/10" 
                      onClick={() => setShowFlythrough(true)} 
                      title="Visualisation 3D"
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                    <ImportBooking
                      onImport={handleImportBooking}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-xl text-muted-foreground hover:text-gold hover:bg-gold/10"
                          title="Importer une réservation"
                        >
                          <Upload className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:text-gold hover:bg-gold/10"
                      onClick={handleExportPdf}
                      title="Exporter en PDF"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {isOwner && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-9 w-9 rounded-xl text-muted-foreground hover:text-gold hover:bg-gold/10" 
                        onClick={() => setShowShareDialog(true)}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="h-8 w-px bg-border/40 mx-2" />

                {canPropose && (
                  <Button 
                    variant={editMode ? "default" : "outline"} 
                    size="sm" 
                    className={cn(
                      "h-10 rounded-xl font-bold text-[10px] uppercase tracking-widest px-5 gap-2 transition-all",
                      editMode ? "bg-gold text-white hover:bg-gold-dark shadow-lg shadow-gold/20" : "border-gold/20 hover:bg-gold/5"
                    )} 
                    onClick={() => setEditMode(!editMode)}
                  >
                    {editMode ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5 text-gold" />}
                    {editMode ? 'Terminer' : (canOwnerEdit ? 'Éditer' : 'Proposer')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile layout - Fullscreen map + bottom sheet */}
      {!isDesktop && <div className="fixed inset-0 z-30">
          {/* Map fullscreen background */}
          <div className="absolute inset-0">
            <TripMap
              items={editMode ? allItems : activeDayItems}
              selectedItemId={selectedItemId}
              hoveredItemId={hoveredItemId || undefined}
              onItemClick={handleSelectItem}
              mapNumbers={itemMapNumbers}
              isVisible={true}
              importedPlaces={trip.importedPlaces?.items}
              flightInfo={flightInfo}
              neighbourhoodCells={neighbourhoodCells}
            />
          </div>

          {/* Floating header — gradient layer (click-through) + buttons (separate) */}
          <div className="absolute top-0 left-0 right-0 z-10 h-28 bg-gradient-to-b from-black/60 via-black/20 to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-6">
            <div className="flex items-center gap-3">
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 border border-white/10 shadow-[0_8px_16px_rgba(0,0,0,0.4)] active:scale-90 transition-transform text-white"
                onClick={() => { hapticImpactLight(); goBack(); }}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex flex-col justify-center">
                <h1 className="text-base font-black text-white drop-shadow-lg truncate max-w-[200px] leading-none mb-1">
                  {trip.preferences.destination}
                </h1>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/80 drop-shadow-md flex items-center gap-1.5">
                  {trip.days.length} Jours
                  <span className="w-1 h-1 rounded-full bg-gold/50" />
                  {format(new Date(trip.preferences.startDate), 'd MMM', { locale: fr })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 border border-white/10 shadow-[0_8px_16px_rgba(0,0,0,0.4)] active:scale-90 transition-transform text-white"
                  onClick={() => { hapticImpactLight(); setShowShareDialog(true); }}
                >
                  <Share2 className="h-5 w-5" />
                </button>
              )}
              <button
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 border border-white/10 shadow-[0_8px_16px_rgba(0,0,0,0.4)] active:scale-90 transition-transform text-white"
                onClick={() => { hapticImpactLight(); setShowMobileActions(true); }}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Chat floating button */}
          {canOwnerEdit && (
            <button
              className="absolute bottom-[16vh] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-gold-gradient text-black shadow-[0_10px_25px_rgba(197,160,89,0.4)] border border-white/20 active:scale-90 transition-all"
              onClick={() => { hapticImpactMedium(); setShowChatPanel(true); }}
            >
              <MessageCircle className="h-6 w-6 stroke-[2.5px]" />
            </button>
          )}

          {/* Bottom sheet */}
          <Drawer open modal={false} snapPoints={[0.3, 0.94]} dismissible={false}>
            <DrawerContent showOverlay={false} className="flex flex-col h-full bg-[#0A1628] border-t border-white/10 rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] outline-none overflow-hidden">
              {/* Zone de drag élargie — 48px de hauteur tactile */}
              <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
                <DrawerHandle className="bg-white/20 w-12 h-1.5 shrink-0" />
              </div>
              
              <Tabs value={mainTab} onValueChange={(v) => { hapticImpactLight(); setMainTab(v); }} className="flex-1 flex flex-col min-h-0">
                <TabsList className="mx-4 mb-4 flex w-auto gap-1 bg-white/5 border border-white/5 rounded-xl p-1 shrink-0" data-tour="tabs">
                  {liveState && <TabsTrigger value="live" className="shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-purple-600">Live</TabsTrigger>}
                  <TabsTrigger value="planning" className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-gold data-[state=active]:text-black">Itinéraire</TabsTrigger>
                  <TabsTrigger value="overview" className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-gold data-[state=active]:text-black">Résumé</TabsTrigger>
                  <TabsTrigger value="reserver" className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-gold data-[state=active]:text-black">Réserver</TabsTrigger>
                  <TabsTrigger value="infos" className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-gold data-[state=active]:text-black">Infos</TabsTrigger>
                  {trip.attractionPool?.length ? <TabsTrigger value="pool" className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-tight data-[state=active]:bg-gold data-[state=active]:text-black">Pool</TabsTrigger> : null}
                </TabsList>

                <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+80px)] scrollbar-hide">
                  {liveState && (
                    <TabsContent value="live" className="mt-0">
                      <LiveTripDashboard
                        liveState={liveState}
                        trip={trip}
                        onNavigateToActivity={(activityId) => {
                          const item = trip.days.flatMap(d => d.items).find(i => i.id === activityId);
                          if (item) {
                            setSelectedItemId(activityId);
                          }
                        }}
                      />
                    </TabsContent>
                  )}

                  <TabsContent value="overview" className="mt-0">
                    <TripOverviewTab
                      days={trip.days}
                      trip={trip}
                      onDayClick={(dayNumber) => {
                        handleDayChange(dayNumber.toString());
                        setMainTab('planning');
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="planning" className="mt-0">
                    <div className="space-y-4">
                      {/* Planning view toggle */}
                      <div className="flex items-center justify-between">
                        <div className="inline-flex p-0.5 bg-white/5 rounded-lg border border-white/5" data-tour="view-toggle">
                          <button 
                            className={cn("px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all", planningView === 'timeline' ? "bg-white/10 text-white" : "text-white/60")}
                            onClick={() => setPlanningView('timeline')}
                          >
                            Timeline
                          </button>
                          <button 
                            className={cn("px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all", planningView === 'calendar' ? "bg-white/10 text-white" : "text-white/60")}
                            onClick={() => setPlanningView('calendar')}
                          >
                            Calendrier
                          </button>
                        </div>
                        
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest"
                            onClick={() => { hapticImpactLight(); setEditMode(!editMode); }}
                          >
                            <Settings2 className="h-3 w-3 mr-1 text-gold" />
                            {editMode ? 'Terminer' : 'Éditer'}
                          </Button>
                        </div>
                      </div>

                      {planningView === 'calendar' ? (
                        <div className="h-[60vh] rounded-2xl overflow-hidden border border-white/5">
                          <CalendarView
                            days={trip.days}
                            isEditable={canOwnerEdit}
                            onUpdateItem={handleCalendarUpdateItem}
                            onClickItem={canOwnerEdit ? handleEditItem : undefined}
                            onClickSlot={canOwnerEdit ? handleCalendarSlotClick : undefined}
                            onCreateSlotRange={canOwnerEdit ? handleCalendarSlotRange : undefined}
                            onMoveItemCrossDay={canOwnerEdit ? handleCalendarMoveItemCrossDay : undefined}
                            onAddItem={canOwnerEdit ? (dayNumber) => { setAddActivityDay(dayNumber); setAddActivityDefaultTime(undefined); setAddActivityDefaultEndTime(undefined); setShowAddActivityModal(true); } : undefined}
                            onDeleteItem={canOwnerEdit ? handleDeleteItem : undefined}
                            onEditItem={canOwnerEdit ? handleEditItem : undefined}
                            onSwapClick={canOwnerEdit ? handleSwapClick : undefined}
                          />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Day pills compact */}
                          <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 sticky top-0 bg-[#0A1628] z-10 py-2 border-b border-white/5">
                            {trip.days.map((day) => (
                              <button
                                key={day.dayNumber}
                                onClick={() => handleDayChange(day.dayNumber.toString())}
                                className={cn(
                                  "shrink-0 h-9 px-4 rounded-xl text-[11px] font-black transition-all border",
                                  activeDay === day.dayNumber.toString()
                                    ? "bg-gold border-gold text-black shadow-lg shadow-gold/20"
                                    : "bg-white/5 border-white/5 text-white/60 hover:border-white/20"
                                )}
                              >
                                J{day.dayNumber}
                              </button>
                            ))}
                          </div>

                          <AnimatePresence mode="wait" initial={false}>
                            {trip.days.filter(d => d.dayNumber.toString() === activeDay).map((day) => (
                              <motion.div
                                key={day.dayNumber}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
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
                                  showMoveButtons={editMode}
                                  onSwapClick={canOwnerEdit ? handleSwapClick : undefined}
                                  onEditTime={canOwnerEdit ? handleEditTime : undefined}
                                  hotelSelectorData={hotelSelectorData}
                                  onSelectRestaurantAlternative={canOwnerEdit ? handleSelectRestaurantAlternative : undefined}
                                  onSelectSelfMeal={canOwnerEdit ? handleSelectSelfMeal : undefined}
                                  onDurationChange={canOwnerEdit ? handleDurationChange : undefined}
                                  onTransportModeChange={canOwnerEdit ? handleTransportModeChange : undefined}
                                  onOptimizeDay={canOwnerEdit ? handleOptimizeDay : undefined}
                                  getVoteData={useCollaborativeMode ? getVoteData : undefined}
                                  onVote={useCollaborativeMode ? castVote : undefined}
                                  feedbackCards={feedbackCards}
                                  onSwapAlternative={handleFeedbackSwap}
                                />
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="reserver" className="mt-0">
                    <div className="space-y-4">
                      <ImportBooking onImport={handleImportBooking} />
                      {trip.outboundFlight && (
                        <FlightDatePicker
                          origin={trip.preferences.origin}
                          destination={trip.preferences.destination}
                          selectedDate={new Date(trip.preferences.startDate)}
                          basePrice={trip.outboundFlight.price || 150}
                        />
                      )}
                      <BookingChecklist trip={trip} />
                    </div>
                  </TabsContent>

                  <TabsContent value="infos" className="mt-0">
                    <div className="space-y-6">
                      <TripBudgetBreakdown trip={trip} />
                      {user && <ExpensesPanel tripId={tripId} members={expenseMembers} currentUserId={user?.id || ''} />}
                    </div>
                  </TabsContent>

                  <TabsContent value="pool" className="mt-0">
                    <ActivityPool trip={trip} onAddToDay={handleAddFromPool} />
                  </TabsContent>
                </div>
              </Tabs>
            </DrawerContent>
          </Drawer>
        </div>}

      {/* Desktop layout: scrollable planning panel left + fixed full-height map right */}
      {isDesktop && <div className="flex h-[calc(100vh-73px)] bg-background">
        {/* Left: Scrollable planning panel */}
          <div className="w-[540px] xl:w-[640px] 2xl:w-[720px] shrink-0 overflow-y-auto overscroll-contain border-r border-gold/10 px-6 py-8 scrollbar-hide">
            <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-8">
              <TabsList className="w-full h-12 rounded-2xl border border-gold/10 bg-white/50 dark:bg-white/5 p-1 shadow-sm backdrop-blur-md" data-tour="tabs">
                {liveState && <TabsTrigger value="live" className="flex-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-purple-500 to-blue-500 text-white data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-blue-600 rounded-xl">Live</TabsTrigger>}
                <TabsTrigger value="overview" className="flex-1 text-[10px] font-bold uppercase tracking-widest rounded-xl data-[state=active]:bg-gold data-[state=active]:text-white transition-all">Overview</TabsTrigger>
                <TabsTrigger value="planning" className="flex-1 text-[10px] font-bold uppercase tracking-widest rounded-xl data-[state=active]:bg-gold data-[state=active]:text-white transition-all">Itinéraire</TabsTrigger>
                <TabsTrigger value="reserver" className="flex-1 text-[10px] font-bold uppercase tracking-widest rounded-xl data-[state=active]:bg-gold data-[state=active]:text-white transition-all">Réserver</TabsTrigger>
                <TabsTrigger value="infos" className="flex-1 text-[10px] font-bold uppercase tracking-widest rounded-xl data-[state=active]:bg-gold data-[state=active]:text-white transition-all">Infos</TabsTrigger>
                {trip.attractionPool?.length ? <TabsTrigger value="pool" className="flex-1 text-[10px] font-bold uppercase tracking-widest rounded-xl data-[state=active]:bg-gold data-[state=active]:text-white transition-all">Pool</TabsTrigger> : null}
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
                        setHoveredItemId(activityId);
                      }
                    }}
                  />
                </TabsContent>
              )}

              <TabsContent value="overview">
                <TripOverviewTab
                  days={trip.days}
                  trip={trip}
                  onDayClick={(dayNumber) => {
                    handleDayChange(dayNumber);
                    setMainTab('planning');
                  }}
                />
              </TabsContent>

              <TabsContent value="planning">
                {/* Hotel selector moved to check-in in timeline */}

                {/* Planning view toggle */}
                <div className="flex items-center justify-between p-4 rounded-3xl border border-gold/10 bg-white/30 dark:bg-white/5 backdrop-blur-sm shadow-sm mb-6">
                  <div className="flex flex-col">
                    <h2 className="font-display text-xl font-bold">Votre Voyage</h2>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mt-0.5">Chronologie détaillée</p>
                  </div>
                  <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1 border border-border/40">
                    <Button variant={planningView === 'timeline' ? 'default' : 'ghost'} size="sm" className="h-8 text-[10px] font-bold uppercase tracking-widest px-4 rounded-lg data-[state=active]:bg-gold" onClick={() => setPlanningView('timeline')}>Timeline</Button>
                    <Button variant={planningView === 'calendar' ? 'default' : 'ghost'} size="sm" className="h-8 text-[10px] font-bold uppercase tracking-widest px-4 rounded-lg data-[state=active]:bg-gold" onClick={() => setPlanningView('calendar')}>Calendrier</Button>
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
                      onAddItem={canOwnerEdit ? (dayNumber) => { setAddActivityDay(dayNumber); setAddActivityDefaultTime(undefined); setAddActivityDefaultEndTime(undefined); setShowAddActivityModal(true); } : undefined}
                      onDeleteItem={canOwnerEdit ? handleDeleteItem : undefined}
                      onEditItem={canOwnerEdit ? handleEditItem : undefined}
                      onSwapClick={canOwnerEdit ? handleSwapClick : undefined}
                    />
                  </div>
                ) : editMode && isDesktop ? (
                  <DraggableTimeline
                    days={trip?.days || []}
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
                  <div className="space-y-12">
                    {(trip?.days || []).map((day, idx) => (
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
                          onSwapClick={canOwnerEdit ? handleSwapClick : undefined}
                          onEditTime={canOwnerEdit ? handleEditTime : undefined}
                          hotelSelectorData={hotelSelectorData}
                          onSelectRestaurantAlternative={canOwnerEdit ? handleSelectRestaurantAlternative : undefined}
                          onSelectSelfMeal={canOwnerEdit ? handleSelectSelfMeal : undefined}
                          onDurationChange={canOwnerEdit ? handleDurationChange : undefined}
                          onTransportModeChange={canOwnerEdit ? handleTransportModeChange : undefined}
                          onOptimizeDay={canOwnerEdit ? handleOptimizeDay : undefined}
                          getVoteData={useCollaborativeMode ? getVoteData : undefined}
                          onVote={useCollaborativeMode ? castVote : undefined}
                          feedbackCards={feedbackCards}
                          onSwapAlternative={handleFeedbackSwap}
                        />
                        {/* Bouton "Ajouter un jour" entre les jours (sauf après le dernier) */}
                        {canOwnerEdit && idx < (trip?.days || []).length - 1 && idx > 0 && (
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
                <div className="mb-4">
                  <ImportBooking onImport={handleImportBooking} />
                </div>
                {trip.outboundFlight && (
                  <FlightDatePicker
                    origin={trip.preferences.origin}
                    destination={trip.preferences.destination}
                    selectedDate={new Date(trip.preferences.startDate)}
                    basePrice={trip.outboundFlight.price || 150}
                    className="mb-4"
                  />
                )}
                <BookingChecklist trip={trip} />
              </TabsContent>

              <TabsContent value="infos">
                <div className="space-y-6">
                  <TripBudgetBreakdown trip={trip} />
                  <TripBudgetComparator trip={trip} />
                  {trip.carbonFootprint && <CarbonFootprint data={trip.carbonFootprint} />}
                  {trip.travelTips && <TravelTips data={trip.travelTips} intelligence={buildTravelIntelligence(trip)} />}
                </div>
              </TabsContent>

              <TabsContent value="pool">
                <ActivityPool trip={trip} onAddToDay={handleAddFromPool} />
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

            {/* Comments */}
            <div className="mt-6 pt-6 border-t">
              <Card>
                <CardContent className="p-4">
                  <CommentsSection tripId={tripId} />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right: Fixed full-height map */}
          <div className="flex-1 min-w-0 relative" data-tour="map-panel">
            <div className="absolute inset-0">
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
                neighbourhoodCells={neighbourhoodCells}
              />
            </div>
          </div>
      </div>}

      {/* Comments section moved inside planning panel */}

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
        <AddActivityModal isOpen={showAddActivityModal} onClose={() => setShowAddActivityModal(false)} onAdd={handleAddNewItem} dayNumber={addActivityDay} destination={trip.preferences?.destination || collaborativeTrip?.destination || ''} defaultStartTime={addActivityDefaultTime} defaultEndTime={addActivityDefaultEndTime} attractionPool={trip.attractionPool} />
      )}

      {swapItem && trip?.attractionPool && (
        <ActivityAlternativesDialog
          item={swapItem}
          days={trip.days}
          attractionPool={trip.attractionPool}
          open={!!swapItem}
          onOpenChange={(open) => { if (!open) setSwapItem(null); }}
          onSwap={(oldItem, newAttraction) => {
            handleSwapActivity(oldItem, newAttraction);
            setSwapItem(null);
          }}
        />
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

      {/* Mobile actions sheet */}
      <Sheet open={showMobileActions} onOpenChange={setShowMobileActions}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Actions</SheetTitle>
          </SheetHeader>
          <div className="grid gap-2 py-4">
            <ImportBooking
              onImport={(b) => { handleImportBooking(b); setShowMobileActions(false); }}
              trigger={
                <button className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left text-sm font-medium hover:bg-muted transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  Importer une réservation
                </button>
              }
            />
            <button
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => { handleExportPdf(); setShowMobileActions(false); }}
            >
              <Download className="h-5 w-5 text-muted-foreground" />
              Exporter en PDF
            </button>
            <button
              className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => { setShowFlythrough(true); setShowMobileActions(false); }}
            >
              <Globe className="h-5 w-5 text-muted-foreground" />
              Visualisation 3D
            </button>
            {canPropose && (
              <button
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => { setEditMode(!editMode); setShowMobileActions(false); }}
              >
                <Pencil className="h-5 w-5 text-muted-foreground" />
                {editMode ? 'Terminer édition' : 'Éditer le voyage'}
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Tour guidé pour les nouveaux utilisateurs */}
      {trip && <TripOnboarding />}

      {/* Post-generation A/B feedback cards — moved inline into DayTimeline/ActivityCard */}
      {/* <AnimatePresence mode="wait">
        {showFeedbackCards && feedbackCards.length > 0 && trip && (
          <TripFeedbackCards
            cards={feedbackCards}
            onSelectA={handleFeedbackKeep}
            onSelectB={handleFeedbackSwap}
            onDismiss={handleFeedbackDismiss}
          />
        )}
      </AnimatePresence> */}
      </div>
    </TripErrorBoundary>
  );
}
