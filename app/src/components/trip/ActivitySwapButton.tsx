'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeftRight,
  ArrowUpDown,
  PenLine,
  Coffee,
  Clock,
  Star,
  CheckCircle2,
} from 'lucide-react';
import { TripItem, TripDay } from '@/lib/types';
import { Attraction } from '@/lib/services/attractions';
import { getUnusedAttractions } from '@/lib/services/itineraryCalculator';
import { cn } from '@/lib/utils';

interface ActivitySwapButtonProps {
  item: TripItem;
  days: TripDay[];
  attractionPool: Attraction[];
  onSwap: (oldItem: TripItem, newAttraction: Attraction) => void;
  onReorder?: (itemA: TripItem, itemB: TripItem) => void;
  onAddCustom?: (dayNumber: number, startTime: string) => void;
  onSetFreeTime?: (item: TripItem) => void;
  onEditTime?: (item: TripItem, startTime: string, endTime: string) => void;
}

// Duration options for the custom activity form
const DURATION_OPTIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 heure' },
  { value: '90', label: '1h 30' },
  { value: '120', label: '2 heures' },
  { value: '180', label: '3 heures' },
  { value: '240', label: '4 heures' },
];

export function ActivitySwapButton({
  item,
  days,
  attractionPool,
  onSwap,
  onReorder,
  onAddCustom,
  onSetFreeTime,
  onEditTime,
}: ActivitySwapButtonProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('alternatives');

  // --- Tab 3: Personnaliser state ---
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customDuration, setCustomDuration] = useState('60');

  // --- Tab 5: Horaires state ---
  const [editStartTime, setEditStartTime] = useState(item.startTime || '');
  const [editEndTime, setEditEndTime] = useState(item.endTime || '');

  // --- Tab 1: Alternatives (existing logic, unchanged) ---
  const alternatives = useMemo(() => {
    const unused = getUnusedAttractions(attractionPool, days);
    const sameType = unused.filter(a => a.type === item.type as string);
    const others = unused.filter(a => a.type !== item.type as string);
    return [...sameType.slice(0, 5), ...others.slice(0, 3)];
  }, [attractionPool, days, item.type]);

  // --- Tab 2: Reorganiser — all activities from other days ---
  const otherActivities = useMemo(() => {
    return days.flatMap(day =>
      day.items
        .filter(
          other =>
            other.id !== item.id &&
            other.type === 'activity'
        )
        .map(other => ({ ...other, dayNumber: day.dayNumber }))
    );
  }, [days, item.id]);

  // Build the list of visible tabs based on which handlers are provided
  type TabId = 'alternatives' | 'reorganiser' | 'personnaliser' | 'temps-libre' | 'horaires';

  const visibleTabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'alternatives',
      label: 'Alternatives',
      icon: <ArrowLeftRight className="h-3.5 w-3.5" />,
    },
    ...(onReorder
      ? [
          {
            id: 'reorganiser' as TabId,
            label: 'Réorganiser',
            icon: <ArrowUpDown className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(onAddCustom
      ? [
          {
            id: 'personnaliser' as TabId,
            label: 'Personnaliser',
            icon: <PenLine className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(onSetFreeTime
      ? [
          {
            id: 'temps-libre' as TabId,
            label: 'Temps libre',
            icon: <Coffee className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(onEditTime
      ? [
          {
            id: 'horaires' as TabId,
            label: 'Horaires',
            icon: <Clock className="h-3.5 w-3.5" />,
          },
        ]
      : []),
  ];

  const handleClose = () => {
    setOpen(false);
    // Reset custom form on close
    setCustomTitle('');
    setCustomDescription('');
    setCustomDuration('60');
    setEditStartTime(item.startTime || '');
    setEditEndTime(item.endTime || '');
    setActiveTab('alternatives');
  };

  const handleCustomSubmit = () => {
    if (!customTitle.trim() || !onAddCustom) return;
    onAddCustom(item.dayNumber, item.startTime || '10:00');
    handleClose();
  };

  const handleFreeTimeConfirm = () => {
    if (!onSetFreeTime) return;
    onSetFreeTime(item);
    handleClose();
  };

  const handleEditTimeConfirm = () => {
    if (!onEditTime) return;
    onEditTime(item, editStartTime, editEndTime);
    handleClose();
  };

  // Don't render at all if there are no alternatives and no optional handlers
  const hasAnythingToShow =
    alternatives.length > 0 ||
    onReorder ||
    onAddCustom ||
    onSetFreeTime ||
    onEditTime;

  if (!hasAnythingToShow) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            setEditStartTime(item.startTime || '');
            setEditEndTime(item.endTime || '');
          }}
          title="Modifier cette activité"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-sm font-medium leading-tight">
            Modifier{' '}
            <span className="text-muted-foreground font-normal">
              &quot;{item.title}&quot;
            </span>
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-col"
        >
          {/* Tab list — horizontally scrollable on narrow widths */}
          <div className="overflow-x-auto border-b">
            <TabsList
              className={cn(
                'h-auto w-full rounded-none bg-transparent p-0',
                'inline-flex min-w-full'
              )}
            >
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={cn(
                    'flex-1 flex-col gap-0.5 rounded-none border-b-2 border-transparent',
                    'px-2 py-2 text-[10px] font-medium leading-tight',
                    'data-[state=active]:border-primary data-[state=active]:bg-transparent',
                    'data-[state=active]:text-primary data-[state=active]:shadow-none',
                    'hover:text-foreground transition-colors'
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ── Tab 1: Alternatives ── */}
          <TabsContent value="alternatives" className="mt-0">
            {alternatives.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aucune alternative disponible dans le pool.
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto divide-y">
                {alternatives.map((attraction) => (
                  <button
                    key={attraction.id}
                    className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 items-start"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSwap(item, attraction);
                      handleClose();
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {attraction.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {attraction.rating > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-amber-600">
                            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                            {attraction.rating.toFixed(1)}
                            {attraction.reviewCount ? (
                              <span className="text-muted-foreground">
                                (
                                {attraction.reviewCount > 1000
                                  ? `${(attraction.reviewCount / 1000).toFixed(1)}k`
                                  : attraction.reviewCount}
                                )
                              </span>
                            ) : null}
                          </span>
                        )}
                        {attraction.duration > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {attraction.duration >= 60
                              ? `${Math.floor(attraction.duration / 60)}h${attraction.duration % 60 > 0 ? (attraction.duration % 60).toString().padStart(2, '0') : ''}`
                              : `${attraction.duration}min`}
                          </span>
                        )}
                        {attraction.estimatedCost > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {attraction.estimatedCost}&euro;
                          </span>
                        )}
                        {attraction.estimatedCost === 0 && (
                          <span className="text-xs text-green-600 font-medium">
                            Gratuit
                          </span>
                        )}
                      </div>
                      {attraction.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {attraction.description}
                        </p>
                      )}
                    </div>
                    {attraction.mustSee && (
                      <span className="shrink-0 text-[10px] font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                        Top
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Tab 2: Réorganiser ── */}
          {onReorder && (
            <TabsContent value="reorganiser" className="mt-0">
              {otherActivities.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Aucune autre activité disponible pour l&apos;échange.
                </div>
              ) : (
                <div className="max-h-[50vh] overflow-y-auto divide-y">
                  {otherActivities.map((other) => (
                    <div
                      key={other.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <Badge
                        variant="outline"
                        className="shrink-0 text-[10px] px-1.5 py-0.5 font-medium"
                      >
                        J{other.dayNumber}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {other.title}
                        </p>
                        {(other.startTime || other.endTime) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {other.startTime}
                            {other.endTime ? ` – ${other.endTime}` : ''}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-xs px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReorder(item, other);
                          handleClose();
                        }}
                      >
                        Echanger
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          {/* ── Tab 3: Personnaliser ── */}
          {onAddCustom && (
            <TabsContent value="personnaliser" className="mt-0">
              <div className="max-h-[50vh] overflow-y-auto px-4 py-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="custom-title" className="text-xs">
                    Titre <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="custom-title"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Nom de l'activité personnalisée"
                    className="h-8 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="custom-description" className="text-xs">
                    Description
                  </Label>
                  <Textarea
                    id="custom-description"
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="Description optionnelle"
                    rows={2}
                    className="text-sm resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="custom-duration" className="text-xs">
                    Durée estimée
                  </Label>
                  <Select
                    value={customDuration}
                    onValueChange={setCustomDuration}
                  >
                    <SelectTrigger id="custom-duration" className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-sm">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleCustomSubmit}
                    disabled={!customTitle.trim()}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Ajouter l&apos;activité
                  </Button>
                </div>
              </div>
            </TabsContent>
          )}

          {/* ── Tab 4: Temps libre ── */}
          {onSetFreeTime && (
            <TabsContent value="temps-libre" className="mt-0">
              <div className="px-4 py-8 flex flex-col items-center gap-5 max-h-[50vh] overflow-y-auto">
                <div className="rounded-full bg-muted p-4">
                  <Coffee className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">
                    Remplacer par du temps libre&nbsp;?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    L&apos;activité &quot;{item.title}&quot; sera remplacée par un
                    créneau de temps libre.
                  </p>
                </div>
                <Button
                  onClick={handleFreeTimeConfirm}
                  className="gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmer
                </Button>
              </div>
            </TabsContent>
          )}

          {/* ── Tab 5: Horaires ── */}
          {onEditTime && (
            <TabsContent value="horaires" className="mt-0">
              <div className="px-4 py-4 space-y-4 max-h-[50vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-start-time" className="text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Heure de début
                    </Label>
                    <Input
                      id="edit-start-time"
                      type="time"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-end-time" className="text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Heure de fin
                    </Label>
                    <Input
                      id="edit-end-time"
                      type="time"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    onClick={handleEditTimeConfirm}
                    disabled={!editStartTime || !editEndTime}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Modifier les horaires
                  </Button>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
