'use client';

import { useState, useEffect, memo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { TripItem, TripItemType, Flight, Restaurant, Accommodation, TRIP_ITEM_COLORS } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
  DrawerHandle,
} from '@/components/ui/drawer';
import { PriceComparisonCard } from './PriceComparisonCard';
import {
  MapPin,
  Clock,
  Utensils,
  Bed,
  Bus,
  Car,
  Pencil,
  Trash2,
  GripVertical,
  Plane,
  ParkingCircle,
  LogIn,
  LogOut,
  ExternalLink,
  Star,
  Navigation,
  Map as MapIcon,
  TrainFront,
  TramFront,
  Ship,
  Footprints,
  Briefcase,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ChevronsLeftRight,
  Coffee,
  Ticket,
  Globe,
  ImageIcon,
  Phone,
  ShieldCheck,
  Zap,
  Award,
  Check,
  TrendingDown,
  UtensilsCrossed,
  MoreHorizontal,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { classifyActivityCategory, getCategoryConfig } from '@/lib/utils/activityClassifier';
import { ActivityVote } from './ActivityVote';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';
import type { FeedbackCard } from '@/lib/types/pipelineQuestions';

type SvgIconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface ActivityCardProps {
  item: TripItem;
  orderNumber?: number;
  isSelected?: boolean;
  isDragging?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onSwapClick?: () => void;
  onEditTime?: (item: TripItem, start: string, end: string) => void;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
  onDurationChange?: (item: TripItem, newDuration: number) => void;
  showPriceComparison?: boolean;
  hotelAlternatives?: Accommodation[];
  voteData?: { wantCount: number; skipCount: number; userVote: 'want' | 'skip' | null };
  onVote?: (vote: 'want' | 'skip' | null) => void;
  alternative?: FeedbackCard;
  onSwapAlternative?: (card: FeedbackCard) => void;
}

const TYPE_ICONS: Record<TripItemType, SvgIconComponent> = {
  activity: MapPin,
  restaurant: Utensils,
  hotel: Bed,
  transport: Bus,
  flight: Plane,
  parking: ParkingCircle,
  checkin: LogIn,
  checkout: LogOut,
  luggage: Briefcase,
  free_time: Coffee,
};

const TRANSPORT_MODE_ICONS: Record<NonNullable<TripItem['transportMode']>, SvgIconComponent> = {
  train: TrainFront,
  bus: Bus,
  car: Car,
  ferry: Ship,
  walking: Footprints,
  transit: TramFront,
  RER: TrainFront,
  metro: TramFront,
};

const TRANSPORT_UI_V2_ENABLED = !['0', 'false', 'off'].includes(
  String(process.env.NEXT_PUBLIC_PIPELINE_TRANSPORT_UI_V2 || 'true').toLowerCase()
);


const TRANSIT_MODE_ICONS: Record<string, SvgIconComponent> = {
  bus: Bus,
  metro: TrainFront,
  train: TrainFront,
  tram: TramFront,
  ferry: Ship,
};

const TRANSIT_MODE_COLORS: Record<string, string> = {
  bus: '#0074D9',
  metro: '#FF4136',
  train: '#2ECC40',
  tram: '#FF851B',
  ferry: '#39CCCC',
};

const GOOGLE_PLACE_PHOTO_PATTERN = /(^\/api\/place-photo\?)|(maps\.googleapis\.com\/maps\/api\/place\/photo)/i;

function toGooglePlacePhotoUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const normalized = url.trim();
  return GOOGLE_PLACE_PHOTO_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const normalized = url.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('//')) return `https:${normalized}`;
  if (/^http:\/\//i.test(normalized)) return normalized.replace(/^http:\/\//i, 'https://');
  return normalized;
}

function sanitizeUserFacingDescription(description?: string): string | undefined {
  if (!description) return undefined;
  const cleaned = description
    .replace(/valid[ée]e?\s+par\s+geocodage/gi, '')
    .replace(/validee?\s+par\s+geocodage/gi, '')
    .replace(/valid(?:ated|e)?\s+by\s+geocod(?:ing|age)/gi, '')
    .replace(/sugg?estion\s+(?:iconique|locale)[^,.]*[,.]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || undefined;
}

function formatEstimatedCostLabel(cost: TripItem['estimatedCost']): string | null {
  if (cost === undefined || cost === null) return null;
  const numeric = Number(cost);
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) return 'Gratuit';
    return `${Math.round(numeric)}€`;
  }
  const raw = String(cost).trim();
  if (!raw) return null;
  return raw;
}

function getRestaurantGooglePhoto(restaurant?: Partial<Restaurant>): string | undefined {
  const photos = Array.isArray(restaurant?.photos) ? restaurant.photos : [];
  for (const photo of photos) {
    const valid = toGooglePlacePhotoUrl(photo);
    if (valid) return valid;
  }
  return undefined;
}

function normalizeTransportModeForUi(mode?: string): TripItem['transportMode'] | undefined {
  if (!mode) return undefined;
  const normalized = mode.toLowerCase();
  if (normalized === 'train' || normalized === 'bus' || normalized === 'car' || normalized === 'ferry') return normalized;
  if (normalized === 'walk' || normalized === 'walking') return 'walking';
  if (normalized === 'public' || normalized === 'metro' || normalized === 'tram' || normalized === 'subway' || normalized === 'transit' || normalized === 'combined') return 'transit';
  return undefined;
}

function getTransportModeForItem(item: TripItem): TripItem['transportMode'] | undefined {
  const explicit = normalizeTransportModeForUi(item.transportMode);
  if (explicit) return explicit;

  if (item.transitLegs && item.transitLegs.length > 0) {
    const weighted = new Map<string, number>();
    for (const leg of item.transitLegs) {
      const mode = normalizeTransportModeForUi(leg.mode);
      if (!mode) continue;
      weighted.set(mode, (weighted.get(mode) || 0) + Math.max(1, leg.duration || 1));
    }
    if (weighted.size > 0) {
      return [...weighted.entries()].sort((a, b) => b[1] - a[1])[0][0] as TripItem['transportMode'];
    }
  }

  const title = (item.title || '').toLowerCase();
  if (title.includes('train')) return 'train';
  if (title.includes('bus')) return 'bus';
  if (title.includes('ferry')) return 'ferry';
  if (title.includes('walk') || title.includes('à pied')) return 'walking';
  return 'transit';
}

function ItemTypeIcon({
  item,
  className,
  style,
  testId,
}: {
  item: TripItem;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}) {
  const iconProps = { className, style, 'data-testid': testId } as React.SVGProps<SVGSVGElement>;

  if (TRANSPORT_UI_V2_ENABLED && item.type === 'transport') {
    const mode = getTransportModeForItem(item);
    if (mode === 'train') return <TrainFront {...iconProps} />;
    if (mode === 'bus') return <Bus {...iconProps} />;
    if (mode === 'car') return <Car {...iconProps} />;
    if (mode === 'ferry') return <Ship {...iconProps} />;
    if (mode === 'walking') return <Footprints {...iconProps} />;
    return <TramFront {...iconProps} />;
  }

  switch (item.type) {
    case 'activity':
      return <MapPin {...iconProps} />;
    case 'restaurant':
      return <Utensils {...iconProps} />;
    case 'hotel':
      return <Bed {...iconProps} />;
    case 'flight':
      return <Plane {...iconProps} />;
    case 'parking':
      return <ParkingCircle {...iconProps} />;
    case 'checkin':
      return <LogIn {...iconProps} />;
    case 'checkout':
      return <LogOut {...iconProps} />;
    case 'luggage':
      return <Briefcase {...iconProps} />;
    case 'free_time':
      return <Coffee {...iconProps} />;
    case 'transport':
      return <Bus {...iconProps} />;
    default:
      return <MapPin {...iconProps} />;
  }
}

/** Types that can display a hero image */
const IMAGE_TYPES: TripItemType[] = ['activity', 'restaurant', 'hotel', 'checkout', 'flight', 'transport'];

/** Gradient backgrounds per type (used when no image available) — dark, muted tones */
const TYPE_GRADIENTS: Record<string, string> = {
  activity: 'from-slate-700 to-slate-900',
  restaurant: 'from-stone-700 to-stone-900',
  hotel: 'from-slate-600 to-slate-800',
  checkin: 'from-slate-600 to-slate-800',
  checkout: 'from-slate-600 to-slate-800',
  flight: 'from-slate-700 to-slate-900',
  transport: 'from-slate-700 to-slate-900',
};

/** Photo carousel for hero-type cards with multiple photos */
function PhotoCarousel({
  photos,
  alt,
  className,
}: {
  photos: string[];
  alt: string;
  className?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(new Set([0]));

  const goTo = (idx: number) => {
    const newIdx = ((idx % photos.length) + photos.length) % photos.length;
    setCurrentIndex(newIdx);
    setLoadedIndices(prev => new Set([...prev, newIdx]));
  };

  if (photos.length <= 1) {
    return photos[0] ? (
      <img src={photos[0]} alt={alt} className={className} loading="lazy" />
    ) : null;
  }

  return (
    <div className="relative group/carousel">
      <img
        src={photos[currentIndex]}
        alt={`${alt} (${currentIndex + 1}/${photos.length})`}
        className={cn(className, 'transition-opacity duration-300')}
        loading="lazy"
      />
      {/* Navigation dots */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
        {photos.map((_, idx) => (
          <button
            key={idx}
            onClick={(e) => { e.stopPropagation(); goTo(idx); }}
            className={cn(
              'w-1.5 h-1.5 rounded-full transition-all',
              idx === currentIndex ? 'bg-white w-3' : 'bg-white/50'
            )}
          />
        ))}
      </div>
      {/* Prev/Next arrows - visible on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); goTo(currentIndex - 1); }}
        className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/30 text-white flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity text-xs z-10"
      >
        &#8249;
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); goTo(currentIndex + 1); }}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/30 text-white flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity text-xs z-10"
      >
        &#8250;
      </button>
    </div>
  );
}

export const ActivityCard = memo(function ActivityCard({
  item,
  orderNumber,
  isSelected,
  isDragging,
  onSelect,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  onMouseEnter,
  onMouseLeave,
  dragHandleProps,
  onSwapClick,
  onEditTime,
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
  onDurationChange,
  showPriceComparison = false,
  hotelAlternatives,
  voteData,
  onVote,
  alternative,
  onSwapAlternative,
}: ActivityCardProps) {
  const { t } = useTranslation();
  const [showPriceComparisonDrawer, setShowPriceComparisonDrawer] = useState(false);
  const [showActionsDrawer, setShowActionsDrawer] = useState(false);
  const transportMode = item.type === 'transport' ? getTransportModeForItem(item) : undefined;
  const transportIconTestId = transportMode ? `transport-icon-${transportMode}` : undefined;
  const color = TRIP_ITEM_COLORS[item.type];
  const imageUrl = normalizeImageUrl(item.type === 'restaurant'
    ? (getRestaurantGooglePhoto(item.restaurant) || item.imageUrl)
    : item.type === 'flight'
    ? undefined
    : item.imageUrl);
  const hasImage = imageUrl && IMAGE_TYPES.includes(item.type);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Reset error state when image URL changes
  useEffect(() => { setImgError(false); setImgLoaded(false); }, [imageUrl]);
  const [showAlternative, setShowAlternative] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTimeEdit, setShowTimeEdit] = useState(false);
  const [editStartTime, setEditStartTime] = useState(item.startTime || '');
  const [editEndTime, setEditEndTime] = useState(item.endTime || '');

  useEffect(() => {
    if (!showDeleteConfirm) return;
    const timer = setTimeout(() => setShowDeleteConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [showDeleteConfirm]);

  const isLocked = item.type === 'flight' || item.type === 'checkin' || item.type === 'checkout';
  const hasActions = !isLocked && (onSwapClick || onEdit || onDelete || onEditTime);
  const estimatedCostLabel = formatEstimatedCostLabel(item.estimatedCost);
  const userDescription = sanitizeUserFacingDescription(item.description);

  const showImage = hasImage && !imgError;
  // Restaurant with alternatives: render as flat card with 3 equal suggestion cards
  const hasRestaurantAlternatives = item.type === 'restaurant' && item.restaurant && item.restaurantAlternatives && item.restaurantAlternatives.length > 0;
  // Hotel with alternatives: show flat carousel of options below the main card
  const hasHotelAlternatives = (item.type === 'hotel' || item.type === 'checkin') && hotelAlternatives && hotelAlternatives.length > 0;
  const isHeroType = IMAGE_TYPES.includes(item.type);
  // Hero cards always use the "image" style (white text, overlay) — either with a real image or a gradient fallback
  const useHeroStyle = isHeroType;
  const isCompactCheckin = item.type === 'checkin';

  return (
    <Card
      className={cn(
        'relative group cursor-pointer overflow-hidden active:scale-[0.97] transition-transform rounded-2xl !p-0 !gap-0',
        'border-0 bg-[#0A1628] shadow-none',
        'hover:brightness-110',
        isSelected && 'ring-2 ring-gold/50 border-gold/30 shadow-gold/10',
        isDragging && 'shadow-2xl rotate-2 scale-[1.05] z-50',
      )}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Compact checkin: premium minimalist feel */}
      {isCompactCheckin && (
        <div className="flex items-center gap-4 px-4 py-3 bg-gradient-to-r from-indigo-950/40 via-[#0A1628] to-[#0A1628] relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-purple-600 rounded-l-2xl opacity-80" />
          
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shrink-0">
            <LogIn className="h-5 w-5 text-indigo-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold tracking-tight text-white truncate">
                {item.title}
              </h4>
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-black text-gold-gradient bg-gold/5 px-2 py-1 rounded-lg border border-gold/10 shadow-sm shrink-0">
                <Clock className="h-3 w-3 text-gold" />
                {item.startTime}
              </div>
            </div>
            {userDescription && (
              <p className="text-xs text-white/40 line-clamp-1 italic mt-0.5 font-serif">
                {userDescription}
              </p>
            )}
          </div>
          
          <ChevronRight className="h-4 w-4 text-white/10 group-hover:text-gold/40 transition-colors shrink-0" />
        </div>
      )}

      {/* Horizontal Magazine-Style Card */}
      {!isCompactCheckin && (
        <div className="flex items-stretch w-full min-h-0">
          {/* Left Side: Photo with Badge Overlay */}
          <div className="relative w-28 shrink-0 overflow-hidden min-h-[7rem] rounded-l-2xl">
            {/* Gradient base if image fails */}
            <div className={cn("absolute inset-0 bg-gradient-to-br", TYPE_GRADIENTS[item.type] || 'from-slate-800 to-slate-950')} />
            
            {showImage ? (
              <img
                src={imageUrl}
                alt={item.title}
                className="absolute inset-0 w-full h-full object-cover z-[1]"
                loading="eager"
                onError={() => setImgError(true)}
                onLoad={() => setImgLoaded(true)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gold/10">
                <ItemTypeIcon item={item} className="h-8 w-8 text-gold/30" />
              </div>
            )}
            
            {/* Top left time badge */}
            <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-1">
              <Clock className="h-2.5 w-2.5 text-gold" />
              <span className="text-[10px] font-black text-white">{item.startTime}</span>
            </div>
            
            {/* Bottom rating badge (on gold bg, black text is OK here as background is bright gold) */}
            {item.rating && (
              <div className="absolute bottom-2 left-2 z-10 bg-gold-gradient px-1.5 py-0.5 rounded shadow-lg flex items-center gap-0.5">
                <Star className="h-2.5 w-2.5 fill-black stroke-black" />
                <span className="text-[10px] font-black text-black">{item.rating.toFixed(1)}</span>
                <span className="text-[8px] font-bold text-black/60 ml-0.5">Google</span>
              </div>
            )}
          </div>

          {/* Right Side: Content */}
          <div className={cn(
            'flex-1 min-w-0 px-2.5 py-1.5 flex flex-col justify-between bg-gradient-to-r from-[#0A1628] to-[#0D1F35]',
            hasActions && 'pr-11'
          )}>
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2 mb-0.5 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-gold-gradient shrink-0 max-w-[70%] truncate">
                  {t(`tripItem.type.${item.type}` as any)}
                </span>
                {estimatedCostLabel && (
                  <span className="inline-flex shrink-0 min-w-[54px] justify-center items-center rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[11px] font-black text-gold shadow-sm shadow-black/20">
                    {estimatedCostLabel}
                  </span>
                )}
              </div>
              
              <h4 className="text-base font-bold text-white tracking-tight leading-tight truncate">
                {item.title}
              </h4>
              
              {userDescription && (
                <p className="text-xs text-white/50 line-clamp-2 leading-snug mt-1 italic font-serif">
                  {userDescription}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between mt-auto">
              <div className="flex items-center gap-1.5 flex-wrap">
                <BookingButtons item={item} isCompact={true} />
                {item.type === 'activity' && voteData && onVote && (
                  <ActivityVote {...voteData} onVote={onVote} />
                )}
              </div>
              
              {!isHeroType && (
                <div className="h-7 w-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                  <ItemTypeIcon item={item} className="h-3.5 w-3.5 text-gold" />
                </div>
              )}
            </div>

            {/* Inline alternative badge & swap view */}
            <AnimatePresence mode="wait">
              {alternative && !showAlternative && (
                <motion.button
                  key="alt-badge"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-gold/30 bg-gold/5 text-gold text-[11px] font-bold tracking-wide hover:bg-gold/10 active:scale-[0.97] transition-all"
                  onClick={(e) => { e.stopPropagation(); setShowAlternative(true); hapticImpactLight(); }}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  Alternative disponible
                </motion.button>
              )}
              {alternative && showAlternative && (
                <motion.div
                  key="alt-view"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="mt-2 rounded-xl border border-gold/20 bg-black/40 p-3 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-3">
                    {alternative.optionB.imageUrl && (
                      <img
                        src={alternative.optionB.imageUrl}
                        alt={alternative.optionB.name}
                        className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{alternative.optionB.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {alternative.optionB.rating && (
                          <span className="flex items-center gap-0.5 text-[11px] text-gold">
                            <Star className="h-3 w-3 fill-gold text-gold" />
                            {alternative.optionB.rating.toFixed(1)}
                          </span>
                        )}
                        {alternative.optionB.cuisineOrType && (
                          <span className="text-[11px] text-white/50">{alternative.optionB.cuisineOrType}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="flex-1 h-8 rounded-xl bg-gold-gradient text-black font-bold text-xs shadow-md shadow-gold/20"
                      onClick={() => { onSwapAlternative?.(alternative); hapticImpactMedium(); }}
                    >
                      ✓ Choisir
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 h-8 rounded-xl text-white/60 font-bold text-xs border border-white/10 hover:bg-white/5"
                      onClick={() => { setShowAlternative(false); hapticImpactLight(); }}
                    >
                      ← Revenir
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Restaurant alternatives overlay */}
      {hasRestaurantAlternatives && (
        <RestaurantAlternativesOverlay
          item={item}
          onSelectRestaurantAlternative={onSelectRestaurantAlternative}
        />
      )}

      {/* Flight alternatives */}
      {item.type === 'flight' && item.flightAlternatives && item.flightAlternatives.length > 0 && (
        <div className="px-4 pb-3">
          <FlightAlternatives alternatives={item.flightAlternatives} />
        </div>
      )}

      {/* Hotel alternatives carousel */}
      {hasHotelAlternatives && (
        <HotelAlternativesFlat
          alternatives={hotelAlternatives!}
          selectedId={item.accommodation?.id}
        />
      )}

      {/* Action Drawer (Mobile First) */}
      {hasActions && (
        <div className="absolute top-3 right-3 z-10">
          <Drawer open={showActionsDrawer} onOpenChange={setShowActionsDrawer}>
            <DrawerTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 bg-black/60 hover:bg-black/80 rounded-full border border-white/10"
                aria-label="Plus d'options"
                onClick={(e) => {
                  e.stopPropagation();
                  hapticImpactLight();
                }}
              >
                <MoreHorizontal className="h-5 w-5 text-white" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHandle />
              <DrawerHeader className="pb-4">
                <DrawerTitle className="text-xl font-black text-white flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gold/10 border border-gold/20">
                    <ItemTypeIcon item={item} className="h-5 w-5 text-gold" />
                  </div>
                  {item.title}
                </DrawerTitle>
              </DrawerHeader>
              
              <div className="p-6 pt-0 space-y-3">
                {onSwapClick && (item.type === 'activity' || item.type === 'free_time') && (
                  <button 
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white font-bold"
                    onClick={(e) => { e.stopPropagation(); onSwapClick(); setShowActionsDrawer(false); hapticImpactMedium(); }}
                  >
                    <ArrowLeftRight className="h-5 w-5 text-gold" />
                    Remplacer l&apos;activité
                  </button>
                )}
                
                {onEditTime && (
                  <button 
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white font-bold"
                    onClick={(e) => { e.stopPropagation(); setShowTimeEdit(true); setShowActionsDrawer(false); hapticImpactLight(); }}
                  >
                    <Clock className="h-5 w-5 text-gold" />
                    Modifier l&apos;horaire
                  </button>
                )}
                
                {onEdit && (
                  <button 
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all text-white font-bold"
                    onClick={(e) => { e.stopPropagation(); onEdit(); setShowActionsDrawer(false); hapticImpactLight(); }}
                  >
                    <Pencil className="h-5 w-5 text-gold" />
                    Modifier les détails
                  </button>
                )}
                
                {onDelete && (
                  <button 
                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 active:scale-95 transition-all text-red-400 font-bold"
                    onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); setShowActionsDrawer(false); hapticImpactMedium(); }}
                  >
                    <Trash2 className="h-5 w-5" />
                    Supprimer du voyage
                  </button>
                )}
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      )}

      {/* Time Edit Drawer (separate from main actions for focus) */}
      <Drawer open={showTimeEdit} onOpenChange={setShowTimeEdit}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle className="text-white">Modifier l&apos;horaire</DrawerTitle>
          </DrawerHeader>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gold">Début</label>
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="w-full h-14 px-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg focus:border-gold/50 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gold">Fin</label>
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="w-full h-14 px-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg focus:border-gold/50 outline-none transition-all"
                />
              </div>
            </div>
            <Button
              className="w-full h-14 rounded-2xl bg-gold-gradient text-black font-black text-lg shadow-xl shadow-gold/20"
              onClick={() => {
                onEditTime!(item, editStartTime, editEndTime);
                setShowTimeEdit(false);
                hapticImpactMedium();
              }}
            >
              Appliquer
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Price Comparison Drawer */}
      <Drawer open={showPriceComparisonDrawer} onOpenChange={setShowPriceComparisonDrawer}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle className="text-white">Comparaison des prix</DrawerTitle>
          </DrawerHeader>
          <div className="p-6 max-h-[70vh] overflow-y-auto scrollbar-hide">
            <PriceComparisonCard
              type="activity"
              params={{
                activityName: item.title,
                city: item.locationName,
              }}
              currentPrice={item.estimatedCost}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Delete confirmation overlay */}
      {showDeleteConfirm && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center gap-3 rounded-[inherit] bg-destructive/95 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-medium text-white">Supprimer ?</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs bg-white/20 border-white/30 text-white hover:bg-white/30"
            onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-white text-destructive hover:bg-white/90"
            onClick={(e) => { e.stopPropagation(); onDelete?.(); setShowDeleteConfirm(false); }}
          >
            Confirmer
          </Button>
        </div>
      )}
    </Card>
  );
}, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.startTime === next.item.startTime &&
    prev.item.endTime === next.item.endTime &&
    prev.item.title === next.item.title &&
    prev.item.type === next.item.type &&
    prev.isSelected === next.isSelected &&
    prev.isDragging === next.isDragging &&
    prev.orderNumber === next.orderNumber &&
    prev.canMoveUp === next.canMoveUp &&
    prev.canMoveDown === next.canMoveDown &&
    prev.showPriceComparison === next.showPriceComparison &&
    prev.voteData?.wantCount === next.voteData?.wantCount &&
    prev.voteData?.skipCount === next.voteData?.skipCount &&
    prev.voteData?.userVote === next.voteData?.userVote &&
    prev.alternative?.id === next.alternative?.id
  );
});

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function DurationBadge({
  duration,
  onDurationChange,
  isHero,
}: {
  duration: number;
  onDurationChange: (newDuration: number) => void;
  isHero: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(duration);

  // Sync when duration prop changes
  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setValue(duration);
    setOpen(isOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-0.5 font-semibold leading-none rounded cursor-pointer transition-colors",
            isHero
              ? "px-2 py-1 text-xs bg-white/20 text-white/90 hover:bg-white/30"
              : "px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary hover:bg-primary/20"
          )}
          onClick={(e) => e.stopPropagation()}
          title="Modifier la durée de visite"
        >
          <Clock className={cn(isHero ? "h-3 w-3" : "h-2.5 w-2.5")} />
          {formatDuration(duration)}
          <Pencil className={cn(isHero ? "h-2.5 w-2.5 opacity-60" : "h-2 w-2 opacity-50")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <label className="text-sm font-medium">Durée de visite</label>
          <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              const clamped = Math.max(15, Math.min(480, value));
              onDurationChange(clamped);
              setOpen(false);
            }}
          >
            Appliquer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Booking buttons — Clean, subtle style with branded accents
 */
function BookingButtons({ item, isCompact = false }: { item: TripItem; isCompact?: boolean }) {
  const buttons: { label: string; url: string; variant: 'primary' | 'secondary' | 'ghost'; icon: React.ReactNode }[] = [];
  const bookingUrl = item.bookingUrl || '';
  const isLocalTransport = item.type === 'transport' && item.transportRole === 'inter_item';

  // Flight — single Aviasales button (prefer aviasalesUrl which includes return date)
  if (item.type === 'flight') {
    const flightUrl = item.aviasalesUrl || bookingUrl;
    if (flightUrl) {
      buttons.push({
        label: 'Aviasales',
        url: flightUrl,
        variant: 'primary',
        icon: <Plane className="h-3 w-3" />,
      });
    }
  }

  // Hotel
  if ((item.type === 'hotel' || item.type === 'checkin' || item.type === 'checkout') && bookingUrl) {
    const label = bookingUrl.includes('airbnb.com') ? 'Airbnb' : bookingUrl.includes('booking.com') ? 'Booking' : 'Réserver';
    buttons.push({ label, url: bookingUrl, variant: 'primary', icon: <Bed className="h-3 w-3" /> });
  }

  // Transport
  if (item.type === 'transport' && bookingUrl) {
    const transportMode = getTransportModeForItem(item) || 'transit';
    const TransportIcon = TRANSPORT_MODE_ICONS[transportMode] || TrainFront;
    if (!isLocalTransport) {
      const label = bookingUrl.includes('omio') || bookingUrl.includes('sjv.io') ? 'Omio'
        : bookingUrl.includes('trainline') ? 'Trainline'
        : bookingUrl.includes('flixbus') ? 'FlixBus'
        : 'Réserver';
      buttons.push({ label, url: bookingUrl, variant: 'primary', icon: <TransportIcon className="h-3 w-3" /> });
    }
  }

  if (isLocalTransport) {
    const transportMode = getTransportModeForItem(item) || 'transit';
    const TransportIcon = TRANSPORT_MODE_ICONS[transportMode] || TrainFront;
    const itineraryUrl = item.googleMapsUrl || item.googleMapsPlaceUrl;
    if (itineraryUrl) {
      buttons.push({ label: 'Itinéraire', url: itineraryUrl, variant: 'primary', icon: <TransportIcon className="h-3 w-3" /> });
    }
  }

  // Activity
  if (item.type === 'activity') {
    const officialBookingUrl = item.officialBookingUrl || (bookingUrl && !bookingUrl.includes('viator.com') ? bookingUrl : '');
    const viatorBookingUrl = item.viatorUrl || (bookingUrl.includes('viator.com') ? bookingUrl : '');
    const tiqetsBookingUrl = item.tiqetsUrl;

    if (officialBookingUrl) {
      buttons.push({
        label: 'Billetterie officielle',
        url: officialBookingUrl,
        variant: 'primary',
        icon: <Globe className="h-3 w-3" />,
      });
    }

    if (viatorBookingUrl && !item.viatorImageUrl) {
      buttons.push({
        label: 'Option guidée Viator',
        url: viatorBookingUrl,
        variant: officialBookingUrl ? 'secondary' : 'primary',
        icon: <Ticket className="h-3 w-3" />,
      });
    }

    if (tiqetsBookingUrl) {
      buttons.push({
        label: 'Billets Tiqets',
        url: tiqetsBookingUrl,
        variant: 'secondary',
        icon: <Ticket className="h-3 w-3" />,
      });
    }
  }

  // Google Maps
  const mapsUrl = item.googleMapsPlaceUrl || item.googleMapsUrl ||
    (item.latitude && item.longitude ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null);
  if (mapsUrl && !isLocalTransport) {
    buttons.push({ label: 'Maps', url: mapsUrl, variant: 'ghost', icon: <MapIcon className="h-3 w-3" /> });
  }

  if (buttons.length === 0) return null;

  return (
    <>
      {buttons.map((btn, i) => (
        <a
          key={`${btn.label}-${i}`}
          href={btn.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex items-center gap-1 transition-colors font-bold',
            isCompact ? 'px-2 py-1 rounded-lg bg-black/40 backdrop-blur-md text-white/90 border border-white/10 text-[10px]' : 'px-2.5 py-1 rounded-md text-[11px]',
            !isCompact && btn.variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm',
            !isCompact && btn.variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50',
            !isCompact && btn.variant === 'ghost' && 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent hover:border-border/40',
          )}
        >
          {btn.icon}
          {(!isCompact || (btn.label !== 'Billetterie officielle')) && btn.label}
          {isCompact && btn.label === 'Billetterie officielle' && 'Billets'}
        </a>
      ))}
    </>
  );
}

function TransportCard({ item }: { item: TripItem }) {
  if (item.type !== 'transport' || item.transportRole === 'inter_item') return null;

  const bookingUrl = item.bookingUrl || '';
  const isOmio = bookingUrl.includes('omio') || bookingUrl.includes('sjv.io');
  const legs = item.transitLegs;
  const hasRealData = legs && legs.length > 0;
  const isRealTime = item.transitDataSource === 'api';

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const fmtDur = (min: number) => {
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }
    return `${min}min`;
  };

  const cleanLineName = (leg: { line?: string; operator?: string }) => {
    const raw = leg.line || leg.operator || 'Train';
    if (raw.includes('->') || /^[A-Z]{3,}[0-9]*$/.test(raw)) return leg.operator || 'Train';
    return raw;
  };

  return (
    <div className="mt-2.5 space-y-2 p-2.5 rounded-lg bg-muted/20 border border-border/40" onClick={(e) => e.stopPropagation()}>
      {hasRealData ? (
        <div className="space-y-1.5">
          {legs.map((leg, idx) => {
            const legMode = normalizeTransportModeForUi(leg.mode) || 'transit';
            const LegIcon = TRANSPORT_MODE_ICONS[legMode] || TrainFront;
            return (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-primary font-semibold min-w-[90px]">
                  {formatTime(leg.departure)} → {formatTime(leg.arrival)}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-primary/20 bg-primary/5 font-medium">
                  <LegIcon className="h-2.5 w-2.5 text-primary" />
                  {cleanLineName(leg)}
                </span>
                <span className="text-muted-foreground">{fmtDur(leg.duration)}</span>
                {idx < legs.length - 1 && (
                  <span className="text-[10px] text-primary/50 ml-auto">↓ corresp.</span>
                )}
              </div>
            );
          })}
          {legs.length > 1 && (
            <div className="text-[10px] text-muted-foreground">
              {legs.length - 1} correspondance{legs.length > 2 ? 's' : ''} · ~{item.duration ? fmtDur(item.duration) : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {item.startTime && item.endTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.startTime} → {item.endTime}
            </span>
          )}
          {item.duration && item.duration > 0 && <span>~{fmtDur(item.duration)}</span>}
        </div>
      )}

      {!hasRealData && item.transitInfo?.lines && item.transitInfo.lines.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.transitInfo.lines.map((line, idx) => {
            const LineIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
            return (
              <span
                key={`${line.mode}-${line.number}-${idx}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-primary/20 bg-primary/5 text-muted-foreground"
              >
                <LineIcon className="h-2.5 w-2.5" />
                {line.number}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div>
          {item.priceRange ? (
            <span className="text-xs">
              <span className="font-semibold text-primary">{item.priceRange[0]}€ – {item.priceRange[1]}€</span>
              <span className="text-muted-foreground ml-1">/ pers.</span>
            </span>
          ) : item.estimatedCost != null && item.estimatedCost > 0 ? (
            <span className="text-xs">
              <span className="font-semibold text-primary">~{item.estimatedCost}€</span>
              <span className="text-muted-foreground ml-1">(estimé)</span>
            </span>
          ) : null}
        </div>
        {bookingUrl ? (
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold hover:opacity-90 transition-opacity ${isOmio ? 'bg-[#1B8EE0] text-white shadow-md' : 'bg-primary text-primary-foreground'}`}
          >
            <ExternalLink className="h-3 w-3" />
            {isRealTime ? 'Réserver' : `Voir sur ${isOmio ? 'Omio' : 'le site'}`}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function FlightAlternatives({ alternatives }: { alternatives: Flight[] }) {
  const [expanded, setExpanded] = useState(false);
  if (alternatives.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border/40 pt-2.5" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        {alternatives.length} autre{alternatives.length > 1 ? 's' : ''} vol{alternatives.length > 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground sm:hidden">
            <ChevronsLeftRight className="h-3 w-3" />
            Faites glisser pour voir tous les vols
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-5 bg-gradient-to-r from-background to-transparent sm:hidden" />
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 w-5 bg-gradient-to-l from-background to-transparent sm:hidden" />
            <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
              {alternatives.map((alt) => (
                <a
                  key={alt.id}
                  href={alt.bookingUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-[140px] flex-shrink-0 rounded-lg border border-border/50 bg-card p-2.5 text-xs transition-all hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="font-medium">{alt.airline}</div>
                  <div className="text-muted-foreground text-[10px]">{alt.flightNumber}</div>
                  <div className="mt-1.5 font-mono text-[11px]">
                    {alt.departureTimeDisplay || alt.departureTime?.split('T')[1]?.slice(0, 5)} → {alt.arrivalTimeDisplay || alt.arrivalTime?.split('T')[1]?.slice(0, 5)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-semibold text-primary">{alt.pricePerPerson || alt.price}€</span>
                    <span className="text-muted-foreground text-[10px]">
                      {formatDuration(alt.duration)} · {alt.stops === 0 ? 'Direct' : `${alt.stops} esc.`}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Flat restaurant layout: 3 equal cards side-by-side.
 * This replaces the old "big hero card + nested suggestions" layout.
 */
function RestaurantSuggestionsFlat({
  item,
  onSelectRestaurantAlternative,
}: {
  item: TripItem;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
}) {
  const current = item.restaurant;
  if (!current) return null;

  const uniqueById = new Map<string, Restaurant>();
  [current, ...(item.restaurantAlternatives || [])].forEach((r) => {
    if (r?.id) uniqueById.set(r.id, r);
  });
  const rankRestaurant = (r: Restaurant): number => {
    const ratingScore = (r.rating || 0) * 22;
    const reviewScore = Math.min(Math.log10((r.reviewCount || 0) + 1) * 10, 25);
    const distancePenalty = Math.min((r.distance || 0) * 12, 28);
    const fallbackPenalty = r.latitude === 0 || r.longitude === 0 ? 6 : 0;
    return ratingScore + reviewScore - distancePenalty - fallbackPenalty;
  };

  const suggestions = Array.from(uniqueById.values())
    .sort((a, b) => rankRestaurant(b) - rankRestaurant(a))
    .slice(0, 3);
  if (suggestions.length === 0) return null;

  const getCuisineLabel = (r: Restaurant): string => {
    const text = `${r.name || ''} ${(r.cuisineTypes || []).join(' ')}`.toLowerCase();

    // 1) D\u00e9tecter la nationalit\u00e9 / origine
    const NATIONALITIES: [string[], string][] = [
      [['sushi', 'ramen', 'japonais', 'japanese', 'izakaya', 'yakitori', 'udon', 'tempura'], 'japonais'],
      [['italien', 'italian', 'pizza', 'pizzeria', 'trattoria', 'osteria', 'ristorante', 'pasta'], 'italien'],
      [['chinois', 'chinese', 'dim sum', 'cantonais', 'wok', 'szechuan'], 'chinois'],
      [['indien', 'indian', 'curry', 'tandoori', 'masala', 'naan'], 'indien'],
      [['thai', 'tha\u00ef', 'tha\u00eflandais', 'pad thai'], 'tha\u00eflandais'],
      [['vietnamien', 'vietnamese', 'pho', 'banh mi', 'bo bun'], 'vietnamien'],
      [['cor\u00e9en', 'korean', 'bibimbap', 'kimchi'], 'cor\u00e9en'],
      [['mexicain', 'mexican', 'tacos', 'taqueria', 'burrito'], 'mexicain'],
      [['libanais', 'lebanese', 'mezze', 'falafel', 'shawarma'], 'libanais'],
      [['marocain', 'moroccan', 'tagine', 'couscous', 'marocaine'], 'marocain'],
      [['grec', 'greek', 'taverna', 'gyros', 'souvlaki'], 'grec'],
      [['turc', 'turkish', 'kebab', 'd\u00f6ner'], 'turc'],
      [['espagnol', 'spanish', 'tapas', 'paella', 'catalan'], 'espagnol'],
      [['p\u00e9ruvien', 'peruvian', 'ceviche'], 'p\u00e9ruvien'],
      [['burger', 'american', 'am\u00e9ricain', 'bbq', 'barbecue', 'diner'], 'am\u00e9ricain'],
      [['portugais', 'portuguese'], 'portugais'],
      [['rome', 'romano', 'roman'], 'romain'],
      [['m\u00e9diterran\u00e9en', 'mediterranean', 'mediterran\u00e9en'], 'm\u00e9diterran\u00e9en'],
      [['proven\u00e7al', 'provencal'], 'proven\u00e7al'],
      [['lyonnais', 'bouchon'], 'lyonnais'],
      [['breton'], 'breton'],
      [['alsacien'], 'alsacien'],
      [['normand'], 'normand'],
      [['savoyard'], 'savoyard'],
      [['fran\u00e7ais', 'french', 'brasserie', 'bistro', 'bistrot', 'boulangerie', 'p\u00e2tisserie', 'patisserie'], 'fran\u00e7ais'],
    ];
    let nationality = '';
    for (const [keywords, nat] of NATIONALITIES) {
      if (keywords.some(kw => text.includes(kw))) { nationality = nat; break; }
    }

    // 2) D\u00e9tecter le type d'\u00e9tablissement (optionnel, enrichit le label)
    const TYPES: [string[], string][] = [
      [['bouchon'], 'Bouchon'],
      [['brasserie'], 'Brasserie'],
      [['bistro', 'bistrot'], 'Bistrot'],
      [['trattoria'], 'Trattoria'],
      [['osteria'], 'Osteria'],
      [['ristorante'], 'Ristorante'],
      [['izakaya'], 'Izakaya'],
      [['taverna', 'taverne'], 'Taverne'],
      [['gastronomique', 'gastro'], 'Gastronomique'],
      [['boulangerie'], 'Boulangerie'],
      [['p\u00e2tisserie', 'patisserie'], 'P\u00e2tisserie'],
      [['fruits de mer', 'seafood'], 'Fruits de mer'],
      [['steakhouse', 'grill'], 'Grill'],
      [['pizzeria'], 'Pizzeria'],
      [['taqueria'], 'Taqueria'],
      [['caf\u00e9', 'cafe', 'coffee', 'caff\u00e8'], 'Caf\u00e9'],
      [['brunch', 'breakfast'], 'Brunch'],
    ];
    let placeType = '';
    for (const [keywords, t] of TYPES) {
      if (keywords.some(kw => text.includes(kw))) { placeType = t; break; }
    }

    // 3) Combiner : "Type + nationalit\u00e9" ou juste nationalit\u00e9 capitalis\u00e9e
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (placeType && nationality) {
      // Ex: "Brasserie fran\u00e7aise", "Trattoria italienne", "Izakaya japonais"
      const fem = ['fran\u00e7ais', 'italien', 'espagnol', 'am\u00e9ricain', 'proven\u00e7al', 'cor\u00e9en', 'tha\u00eflandais', 'portugais', 'mexicain', 'marocain', 'libanais', 'grec', 'turc', 'p\u00e9ruvien', 'romain', 'indien', 'chinois', 'vietnamien', 'm\u00e9diterran\u00e9en', 'breton', 'alsacien', 'normand', 'savoyard', 'lyonnais'];
      const femForms: Record<string, string> = {
        'fran\u00e7ais': 'fran\u00e7aise', 'italien': 'italienne', 'espagnol': 'espagnole',
        'am\u00e9ricain': 'am\u00e9ricaine', 'proven\u00e7al': 'proven\u00e7ale', 'cor\u00e9en': 'cor\u00e9enne',
        'tha\u00eflandais': 'tha\u00eflandaise', 'portugais': 'portugaise', 'mexicain': 'mexicaine',
        'marocain': 'marocaine', 'libanais': 'libanaise', 'grec': 'grecque',
        'turc': 'turque', 'p\u00e9ruvien': 'p\u00e9ruvienne', 'romain': 'romaine',
        'indien': 'indienne', 'chinois': 'chinoise', 'vietnamien': 'vietnamienne',
        'm\u00e9diterran\u00e9en': 'm\u00e9diterran\u00e9enne', 'breton': 'bretonne', 'alsacien': 'alsacienne',
        'normand': 'normande', 'savoyard': 'savoyarde', 'lyonnais': 'lyonnaise',
      };
      // Types f\u00e9minins en fran\u00e7ais
      const femTypes = ['Brasserie', 'Trattoria', 'Osteria', 'Taverne', 'Boulangerie', 'P\u00e2tisserie', 'Pizzeria', 'Taqueria'];
      const isFem = femTypes.includes(placeType);
      const adj = isFem ? (femForms[nationality] || nationality) : nationality;
      return `${placeType} ${adj}`;
    }
    if (placeType) return placeType; // "Caf\u00e9", "Brunch" etc. sans nationalit\u00e9
    if (nationality) return cap(nationality); // "Fran\u00e7ais", "Italien", etc.
    return 'Restaurant';
  };

  const getRestaurantImage = (r: Restaurant): string | undefined => {
    return getRestaurantGooglePhoto(r);
  };

  return (
    <div className="px-3.5 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground sm:hidden">
        <span>{suggestions.length} choix disponibles</span>
        <span className="inline-flex items-center gap-1">
          <ChevronsLeftRight className="h-3 w-3" />
          Faites glisser
        </span>
      </div>

      {/* Carousel horizontal mobile, grille 3 colonnes desktop */}
      <div className="relative">
        <div className="pointer-events-none absolute bottom-1 left-0 top-0 w-5 bg-gradient-to-r from-background to-transparent sm:hidden" />
        <div className="pointer-events-none absolute bottom-1 right-0 top-0 w-5 bg-gradient-to-l from-background to-transparent sm:hidden" />
        <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory sm:overflow-visible sm:grid sm:grid-cols-3">
        {suggestions.map((option) => {
          const isSelected = option.id === current.id;
          const bookingUrl = option.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(option.name)}`;
          const imageUrl = getRestaurantImage(option);

          return (
            <div
              key={option.id}
              className={cn(
                "relative overflow-hidden rounded-xl border-2 transition-all duration-200 snap-center",
                "min-w-[75vw] sm:min-w-0 aspect-[4/3]",
                isSelected
                  ? "border-primary shadow-lg shadow-primary/20 ring-2 ring-primary/40"
                  : "border-border/50 hover:border-white/20 hover:shadow-md opacity-90 hover:opacity-100"
              )}
              style={{ minHeight: '160px' }}
            >
              {/* Background photo */}
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={option.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900" />
              )}
              {/* Dark gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/15" />

              {/* Badge checkmark vert en haut à droite */}
              {isSelected && (
                <div className="absolute top-2 right-2 z-20 bg-emerald-500 rounded-full p-1.5 shadow-lg">
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </div>
              )}

              {/* Card content */}
              <div className="relative z-10 h-full flex flex-col justify-between p-2.5">
                {/* Top section: cuisine badge + restaurant badges */}
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="inline-flex items-center rounded-full bg-black/40 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/90">
                      {getCuisineLabel(option)}
                    </span>
                    {/* Restaurant badges */}
                    {option.badges?.map((badge, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-white/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/80">
                        <Award className="h-2.5 w-2.5" />
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom section: name, meta, actions */}
                <div>
                  <h5 className="font-bold text-sm text-white leading-tight line-clamp-2 drop-shadow-md">
                    {option.name}
                  </h5>
                  <div className="flex items-center gap-2.5 mt-1 text-[11px] text-white/85">
                    {option.rating > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-semibold">
                        <Star className="h-3 w-3 fill-yellow-500/70 text-yellow-500/70" />
                        {option.rating.toFixed(1)}
                        {option.reviewCount > 0 && (
                          <span className="text-white/50 font-normal">({option.reviewCount})</span>
                        )}
                      </span>
                    )}
                    {option.distance != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Navigation className="h-2.5 w-2.5" />
                        {option.distance < 1 ? `${Math.round(option.distance * 1000)}m` : `${option.distance.toFixed(1)}km`}
                      </span>
                    )}
                    {option.priceLevel && (
                      <span className="text-white/60">
                        {'€'.repeat(option.priceLevel)}
                      </span>
                    )}
                  </div>
                  {/* Phone & Website */}
                  {(option.phoneNumber || option.website) && (
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      {option.phoneNumber && (
                        <a
                          href={`tel:${option.phoneNumber}`}
                          className="inline-flex items-center gap-0.5 text-white/70 hover:text-white transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-2.5 w-2.5" />
                          {option.phoneNumber}
                        </a>
                      )}
                      {option.website && (
                        <a
                          href={option.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-white/70 hover:text-white transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="h-2.5 w-2.5" />
                          Site web
                        </a>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {!isSelected && (
                      <button
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRestaurantAlternative?.(item, option);
                        }}
                      >
                        Choisir
                      </button>
                    )}
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 backdrop-blur-sm border border-white/25 text-[10px] text-white/90 hover:bg-white/25 hover:text-white transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Voir
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

/**
 * Restaurant alternatives overlay: small cards shown below the hero card.
 * The hero shows the selected restaurant's photo; alternatives appear as compact cards underneath.
 */
function RestaurantAlternativesOverlay({
  item,
  onSelectRestaurantAlternative,
}: {
  item: TripItem;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
}) {
  const current = item.restaurant;
  if (!current) return null;

  const uniqueById = new Map<string, Restaurant>();
  (item.restaurantAlternatives || []).forEach((r) => {
    if (r?.id && r.id !== current.id) uniqueById.set(r.id, r);
  });

  const rankRestaurant = (r: Restaurant): number => {
    const ratingScore = (r.rating || 0) * 22;
    const reviewScore = Math.min(Math.log10((r.reviewCount || 0) + 1) * 10, 25);
    const distancePenalty = Math.min((r.distance || 0) * 12, 28);
    return ratingScore + reviewScore - distancePenalty;
  };

  const alternatives = Array.from(uniqueById.values())
    .sort((a, b) => rankRestaurant(b) - rankRestaurant(a))
    .slice(0, 2);
  if (alternatives.length === 0) return null;

  const getCuisineShort = (r: Restaurant): string => {
    const text = `${r.name || ''} ${(r.cuisineTypes || []).join(' ')}`.toLowerCase();
    const CUISINES: [string[], string][] = [
      [['sushi', 'ramen', 'japonais', 'japanese', 'izakaya'], 'Japonais'],
      [['italien', 'italian', 'pizza', 'trattoria', 'osteria'], 'Italien'],
      [['chinois', 'chinese', 'dim sum'], 'Chinois'],
      [['indien', 'indian', 'curry', 'tandoori'], 'Indien'],
      [['thai', 'thaï', 'thaïlandais'], 'Thaï'],
      [['mexicain', 'mexican', 'tacos'], 'Mexicain'],
      [['libanais', 'lebanese', 'mezze'], 'Libanais'],
      [['grec', 'greek', 'taverna'], 'Grec'],
      [['burger', 'american', 'bbq'], 'Américain'],
      [['français', 'french', 'brasserie', 'bistrot'], 'Français'],
      [['espagnol', 'spanish', 'tapas'], 'Espagnol'],
      [['méditerranéen', 'mediterranean'], 'Méditerranéen'],
    ];
    for (const [kws, label] of CUISINES) {
      if (kws.some(kw => text.includes(kw))) return label;
    }
    return 'Restaurant';
  };

  return (
    <div className="px-3 pb-2.5 flex gap-2 overflow-x-auto scrollbar-hide" onClick={(e) => e.stopPropagation()}>
      {alternatives.map((alt) => {
        const altImage = getRestaurantGooglePhoto(alt);
        const bookingUrl = alt.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(alt.name)}`;

        return (
          <div
            key={alt.id}
            className="flex-1 min-w-0 rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden hover:border-primary/40 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2.5 p-2">
              {/* Mini photo */}
              <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-muted">
                {altImage ? (
                  <img src={altImage} alt={alt.name} className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-stone-200 to-stone-300 dark:from-stone-700 dark:to-stone-800 flex items-center justify-center">
                    <UtensilsCrossed className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-tight line-clamp-1">{alt.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground/70">{getCuisineShort(alt)}</span>
                  {alt.rating > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-yellow-500/70 text-yellow-500/70" />
                      {alt.rating.toFixed(1)}
                    </span>
                  )}
                  {alt.distance != null && (
                    <span>{alt.distance < 1 ? `${Math.round(alt.distance * 1000)}m` : `${alt.distance.toFixed(1)}km`}</span>
                  )}
                </div>
                <button
                  className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-semibold hover:bg-primary/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRestaurantAlternative?.(item, alt);
                  }}
                >
                  Choisir
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Flat hotel alternatives layout: up to 3 equal cards side-by-side.
 * Mirrors the RestaurantSuggestionsFlat pattern for visual consistency.
 */
function HotelAlternativesFlat({
  alternatives,
  selectedId,
  onSelect,
}: {
  alternatives: Accommodation[];
  selectedId?: string;
  onSelect?: (hotel: Accommodation) => void;
}) {
  const hotels = alternatives.slice(0, 3);
  if (hotels.length === 0) return null;

  const renderStars = (stars?: number) => {
    const count = Math.min(stars || 0, 5);
    if (count === 0) return null;
    return (
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: count }).map((_, i) => (
          <Star key={i} className="h-2.5 w-2.5 fill-yellow-500/70 text-yellow-500/70" />
        ))}
      </span>
    );
  };

  const getHotelTypeLabel = (type: Accommodation['type']): string => {
    const LABELS: Record<Accommodation['type'], string> = {
      hotel: 'Hotel',
      apartment: 'Appartement',
      hostel: 'Auberge',
      bnb: 'B&B',
      resort: 'Resort',
    };
    return LABELS[type] ?? 'Hébergement';
  };

  return (
    <div className="px-3.5 pb-3" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground sm:hidden">
        <span>{hotels.length} hébergements disponibles</span>
        <span className="inline-flex items-center gap-1">
          <ChevronsLeftRight className="h-3 w-3" />
          Faites glisser
        </span>
      </div>

      {/* Carousel horizontal mobile, grille 3 colonnes desktop */}
      <div className="relative">
        <div className="pointer-events-none absolute bottom-1 left-0 top-0 w-5 bg-gradient-to-r from-background to-transparent sm:hidden" />
        <div className="pointer-events-none absolute bottom-1 right-0 top-0 w-5 bg-gradient-to-l from-background to-transparent sm:hidden" />
        <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory sm:overflow-visible sm:grid sm:grid-cols-3">
          {hotels.map((hotel) => {
            const isSelected = hotel.id === selectedId;
            const photo = hotel.photos?.[0];

            return (
              <div
                key={hotel.id}
                className={cn(
                  "relative overflow-hidden rounded-xl border-2 transition-all duration-200 snap-center cursor-pointer",
                  "min-w-[75vw] sm:min-w-0 aspect-[4/3]",
                  isSelected
                    ? "border-primary shadow-lg shadow-primary/20 ring-2 ring-primary/40"
                    : "border-border/50 hover:border-white/20 hover:shadow-md opacity-90 hover:opacity-100"
                )}
                style={{ minHeight: '160px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(hotel);
                }}
              >
                {/* Background photo or gradient */}
                {photo ? (
                  <img
                    src={photo}
                    alt={hotel.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-600 to-slate-800" />
                )}
                {/* Dark gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/15" />

                {/* Selected checkmark */}
                {isSelected && (
                  <div className="absolute top-2 right-2 z-20 bg-emerald-500 rounded-full p-1.5 shadow-lg">
                    <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                  </div>
                )}

                {/* Card content */}
                <div className="relative z-10 h-full flex flex-col justify-between p-2.5">
                  {/* Top: type badge + breakfast badge */}
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-black/40 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/90">
                        {getHotelTypeLabel(hotel.type)}
                      </span>
                      {hotel.breakfastIncluded && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/30 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                          Petit-déj inclus
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom: name, stars, rating, price, booking */}
                  <div>
                    <h5 className="font-bold text-sm text-white leading-tight line-clamp-2 drop-shadow-md">
                      {hotel.name}
                    </h5>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-white/85">
                      {renderStars(hotel.stars)}
                      {hotel.rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 font-semibold">
                          <Star className="h-3 w-3 fill-yellow-500/70 text-yellow-500/70" />
                          {hotel.rating.toFixed(1)}
                          {hotel.reviewCount > 0 && (
                            <span className="text-white/50 font-normal">({hotel.reviewCount})</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-white/85">
                      <span className="font-bold text-white">{hotel.pricePerNight}€</span>
                      <span className="text-white/60 font-normal">/nuit</span>
                      {hotel.totalPrice && hotel.totalPrice > 0 && (
                        <span className="text-white/55 text-[10px]">· Total: {hotel.totalPrice}€</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {hotel.bookingUrl && (
                        <a
                          href={hotel.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          Réserver
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RestaurantSuggestions({
  item,
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
}: {
  item: TripItem;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
}) {
  const current = item.restaurant;
  if (!current) return null;

  const uniqueById = new Map<string, Restaurant>();
  [current, ...(item.restaurantAlternatives || [])].forEach((r) => {
    if (r?.id) uniqueById.set(r.id, r);
  });
  const rankRestaurant = (r: Restaurant): number => {
    const ratingScore = (r.rating || 0) * 22;
    const reviewScore = Math.min(Math.log10((r.reviewCount || 0) + 1) * 10, 25);
    const distancePenalty = Math.min((r.distance || 0) * 12, 28);
    const fallbackPenalty = r.latitude === 0 || r.longitude === 0 ? 6 : 0;
    return ratingScore + reviewScore - distancePenalty - fallbackPenalty;
  };

  const suggestions = Array.from(uniqueById.values())
    .sort((a, b) => rankRestaurant(b) - rankRestaurant(a))
    .slice(0, 3);
  if (suggestions.length <= 1) return null;

  const getCuisineLabel = (r: Restaurant): string => {
    const text = `${r.name || ''} ${(r.cuisineTypes || []).join(' ')}`.toLowerCase();

    // 1) D\u00e9tecter la nationalit\u00e9 / origine
    const NATIONALITIES: [string[], string][] = [
      [['sushi', 'ramen', 'japonais', 'japanese', 'izakaya', 'yakitori', 'udon', 'tempura'], 'japonais'],
      [['italien', 'italian', 'pizza', 'pizzeria', 'trattoria', 'osteria', 'ristorante', 'pasta'], 'italien'],
      [['chinois', 'chinese', 'dim sum', 'cantonais', 'wok', 'szechuan'], 'chinois'],
      [['indien', 'indian', 'curry', 'tandoori', 'masala', 'naan'], 'indien'],
      [['thai', 'tha\u00ef', 'tha\u00eflandais', 'pad thai'], 'tha\u00eflandais'],
      [['vietnamien', 'vietnamese', 'pho', 'banh mi', 'bo bun'], 'vietnamien'],
      [['cor\u00e9en', 'korean', 'bibimbap', 'kimchi'], 'cor\u00e9en'],
      [['mexicain', 'mexican', 'tacos', 'taqueria', 'burrito'], 'mexicain'],
      [['libanais', 'lebanese', 'mezze', 'falafel', 'shawarma'], 'libanais'],
      [['marocain', 'moroccan', 'tagine', 'couscous', 'marocaine'], 'marocain'],
      [['grec', 'greek', 'taverna', 'gyros', 'souvlaki'], 'grec'],
      [['turc', 'turkish', 'kebab', 'd\u00f6ner'], 'turc'],
      [['espagnol', 'spanish', 'tapas', 'paella', 'catalan'], 'espagnol'],
      [['p\u00e9ruvien', 'peruvian', 'ceviche'], 'p\u00e9ruvien'],
      [['burger', 'american', 'am\u00e9ricain', 'bbq', 'barbecue', 'diner'], 'am\u00e9ricain'],
      [['portugais', 'portuguese'], 'portugais'],
      [['rome', 'romano', 'roman'], 'romain'],
      [['m\u00e9diterran\u00e9en', 'mediterranean', 'mediterran\u00e9en'], 'm\u00e9diterran\u00e9en'],
      [['proven\u00e7al', 'provencal'], 'proven\u00e7al'],
      [['lyonnais', 'bouchon'], 'lyonnais'],
      [['breton'], 'breton'],
      [['alsacien'], 'alsacien'],
      [['normand'], 'normand'],
      [['savoyard'], 'savoyard'],
      [['fran\u00e7ais', 'french', 'brasserie', 'bistro', 'bistrot', 'boulangerie', 'p\u00e2tisserie', 'patisserie'], 'fran\u00e7ais'],
    ];
    let nationality = '';
    for (const [keywords, nat] of NATIONALITIES) {
      if (keywords.some(kw => text.includes(kw))) { nationality = nat; break; }
    }

    // 2) D\u00e9tecter le type d'\u00e9tablissement (optionnel, enrichit le label)
    const TYPES: [string[], string][] = [
      [['bouchon'], 'Bouchon'],
      [['brasserie'], 'Brasserie'],
      [['bistro', 'bistrot'], 'Bistrot'],
      [['trattoria'], 'Trattoria'],
      [['osteria'], 'Osteria'],
      [['ristorante'], 'Ristorante'],
      [['izakaya'], 'Izakaya'],
      [['taverna', 'taverne'], 'Taverne'],
      [['gastronomique', 'gastro'], 'Gastronomique'],
      [['boulangerie'], 'Boulangerie'],
      [['p\u00e2tisserie', 'patisserie'], 'P\u00e2tisserie'],
      [['fruits de mer', 'seafood'], 'Fruits de mer'],
      [['steakhouse', 'grill'], 'Grill'],
      [['pizzeria'], 'Pizzeria'],
      [['taqueria'], 'Taqueria'],
      [['caf\u00e9', 'cafe', 'coffee', 'caff\u00e8'], 'Caf\u00e9'],
      [['brunch', 'breakfast'], 'Brunch'],
    ];
    let placeType = '';
    for (const [keywords, t] of TYPES) {
      if (keywords.some(kw => text.includes(kw))) { placeType = t; break; }
    }

    // 3) Combiner : "Type + nationalit\u00e9" ou juste nationalit\u00e9 capitalis\u00e9e
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (placeType && nationality) {
      // Ex: "Brasserie fran\u00e7aise", "Trattoria italienne", "Izakaya japonais"
      const fem = ['fran\u00e7ais', 'italien', 'espagnol', 'am\u00e9ricain', 'proven\u00e7al', 'cor\u00e9en', 'tha\u00eflandais', 'portugais', 'mexicain', 'marocain', 'libanais', 'grec', 'turc', 'p\u00e9ruvien', 'romain', 'indien', 'chinois', 'vietnamien', 'm\u00e9diterran\u00e9en', 'breton', 'alsacien', 'normand', 'savoyard', 'lyonnais'];
      const femForms: Record<string, string> = {
        'fran\u00e7ais': 'fran\u00e7aise', 'italien': 'italienne', 'espagnol': 'espagnole',
        'am\u00e9ricain': 'am\u00e9ricaine', 'proven\u00e7al': 'proven\u00e7ale', 'cor\u00e9en': 'cor\u00e9enne',
        'tha\u00eflandais': 'tha\u00eflandaise', 'portugais': 'portugaise', 'mexicain': 'mexicaine',
        'marocain': 'marocaine', 'libanais': 'libanaise', 'grec': 'grecque',
        'turc': 'turque', 'p\u00e9ruvien': 'p\u00e9ruvienne', 'romain': 'romaine',
        'indien': 'indienne', 'chinois': 'chinoise', 'vietnamien': 'vietnamienne',
        'm\u00e9diterran\u00e9en': 'm\u00e9diterran\u00e9enne', 'breton': 'bretonne', 'alsacien': 'alsacienne',
        'normand': 'normande', 'savoyard': 'savoyarde', 'lyonnais': 'lyonnaise',
      };
      // Types f\u00e9minins en fran\u00e7ais
      const femTypes = ['Brasserie', 'Trattoria', 'Osteria', 'Taverne', 'Boulangerie', 'P\u00e2tisserie', 'Pizzeria', 'Taqueria'];
      const isFem = femTypes.includes(placeType);
      const adj = isFem ? (femForms[nationality] || nationality) : nationality;
      return `${placeType} ${adj}`;
    }
    if (placeType) return placeType; // "Caf\u00e9", "Brunch" etc. sans nationalit\u00e9
    if (nationality) return cap(nationality); // "Fran\u00e7ais", "Italien", etc.
    return 'Restaurant';
  };

  const getRestaurantImage = (r: Restaurant): string | undefined => {
    return getRestaurantGooglePhoto(r);
  };

  return (
    <div className="mt-3 border-t border-border/40 pt-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-medium text-muted-foreground mb-2">Top {suggestions.length} restaurants suggérés</div>
      {/* Side-by-side cards: flex row on sm+, column on mobile */}
      <div className="flex flex-col sm:flex-row gap-2">
        {suggestions.map((option, idx) => {
          const isSelected = option.id === current.id;
          const bookingUrl = option.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(option.name)}`;
          const imageUrl = getRestaurantImage(option);

          return (
            <div
              key={option.id}
              className={cn(
                "relative overflow-hidden rounded-xl border-2 transition-all duration-200",
                "aspect-video sm:aspect-video",
                isSelected
                  ? "border-primary shadow-lg shadow-primary/20 ring-2 ring-primary/40"
                  : "border-border/50 hover:border-white/20 hover:shadow-md opacity-90 hover:opacity-100"
              )}
              style={{
                flex: isSelected ? '1.3 1 0%' : '1 1 0%',
                minHeight: '140px',
              }}
            >
              {/* Background photo */}
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={option.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900" />
              )}
              {/* Dark gradient overlay — heavier at bottom for text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/15" />

              {/* Badge checkmark vert en haut à droite */}
              {isSelected && (
                <div className="absolute top-2 right-2 z-20 bg-emerald-500 rounded-full p-1.5 shadow-lg">
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                </div>
              )}

              {/* Card content — positioned at bottom via flex */}
              <div className="relative z-10 h-full flex flex-col justify-between p-2.5">
                {/* Top section: cuisine badge + restaurant badges */}
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="inline-flex items-center rounded-full bg-black/40 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/90">
                      {getCuisineLabel(option)}
                    </span>
                    {/* Restaurant badges */}
                    {option.badges?.map((badge, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-white/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/80">
                        <Award className="h-2.5 w-2.5" />
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom section: name, meta, actions */}
                <div>
                  {/* Restaurant name */}
                  <h5 className="font-bold text-sm text-white leading-tight line-clamp-2 drop-shadow-md">
                    {option.name}
                  </h5>

                  {/* Meta row: rating + distance */}
                  <div className="flex items-center gap-2.5 mt-1 text-[11px] text-white/85">
                    {option.rating > 0 && (
                      <span className="inline-flex items-center gap-0.5 font-semibold">
                        <Star className="h-3 w-3 fill-yellow-500/70 text-yellow-500/70" />
                        {option.rating.toFixed(1)}
                        {option.reviewCount > 0 && (
                          <span className="text-white/50 font-normal">({option.reviewCount})</span>
                        )}
                      </span>
                    )}
                    {option.distance != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Navigation className="h-2.5 w-2.5" />
                        {option.distance < 1 ? `${Math.round(option.distance * 1000)}m` : `${option.distance.toFixed(1)}km`}
                      </span>
                    )}
                    {option.priceLevel && (
                      <span className="text-white/60">
                        {'€'.repeat(option.priceLevel)}
                      </span>
                    )}
                  </div>

                  {/* Phone & Website */}
                  {(option.phoneNumber || option.website) && (
                    <div className="flex items-center gap-2 mt-1 text-[10px]">
                      {option.phoneNumber && (
                        <a
                          href={`tel:${option.phoneNumber}`}
                          className="inline-flex items-center gap-0.5 text-white/70 hover:text-white transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-2.5 w-2.5" />
                          {option.phoneNumber}
                        </a>
                      )}
                      {option.website && (
                        <a
                          href={option.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-white/70 hover:text-white transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="h-2.5 w-2.5" />
                          Site web
                        </a>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {!isSelected && (
                      <button
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectRestaurantAlternative?.(item, option);
                        }}
                      >
                        Choisir
                      </button>
                    )}
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/15 backdrop-blur-sm border border-white/25 text-[10px] text-white/90 hover:bg-white/25 hover:text-white transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      Voir
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onSelectSelfMeal?.(item);
          }}
        >
          Manger par ses moyens (pique-nique / maison / libre)
        </button>
      </div>
    </div>
  );
}
