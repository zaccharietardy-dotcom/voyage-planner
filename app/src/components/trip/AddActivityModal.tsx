'use client';

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TripItem, TripItemType } from '@/lib/types';
import {
  Search,
  Plus,
  Loader2,
  MapPin,
  Star,
  Clock,
  Camera,
  Utensils,
  Hotel,
  Car,
  Plane,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: TripItem) => void;
  dayNumber: number;
  destination: string;
}

interface SearchResult {
  id: string;
  title: string;
  type: string;
  description: string;
  locationName: string;
  latitude?: number;
  longitude?: number;
  estimatedCost?: number;
  duration?: number;
  rating?: number;
  imageUrl?: string;
  googleMapsUrl?: string;
  source: string;
}

const ACTIVITY_TYPES: { value: TripItemType; label: string; icon: React.ReactNode }[] = [
  { value: 'activity', label: 'Activité', icon: <Camera className="h-4 w-4" /> },
  { value: 'restaurant', label: 'Restaurant', icon: <Utensils className="h-4 w-4" /> },
  { value: 'hotel', label: 'Hébergement', icon: <Hotel className="h-4 w-4" /> },
  { value: 'transport', label: 'Transport', icon: <Car className="h-4 w-4" /> },
  { value: 'luggage', label: 'Bagage', icon: <Package className="h-4 w-4" /> },
];

export function AddActivityModal({
  isOpen,
  onClose,
  onAdd,
  dayNumber,
  destination,
}: AddActivityModalProps) {
  const [tab, setTab] = useState<'search' | 'manual'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Manual form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TripItemType>('activity');
  const [description, setDescription] = useState('');
  const [locationName, setLocationName] = useState('');
  const [startTime, setStartTime] = useState('10:00');
  const [duration, setDuration] = useState(60);
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [googleMapsUrl, setGoogleMapsUrl] = useState<string | undefined>();

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setHasSearched(false);
      setTitle('');
      setType('activity');
      setDescription('');
      setLocationName('');
      setStartTime('10:00');
      setDuration(60);
      setEstimatedCost(0);
      setLatitude(undefined);
      setLongitude(undefined);
      setGoogleMapsUrl(undefined);
      setTab('search');
    }
  }, [isOpen]);

  // Load default results on open
  useEffect(() => {
    if (isOpen && destination && !hasSearched) {
      handleSearch('');
    }
  }, [isOpen, destination]);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!destination) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const params = new URLSearchParams({
        destination,
        ...(searchQuery ? { q: searchQuery } : {}),
      });
      const response = await fetch(`/api/places/search?${params}`);
      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }, [destination]);

  const selectResult = (result: SearchResult) => {
    setTitle(result.title);
    setType(result.type as TripItemType);
    setDescription(result.description);
    setLocationName(result.locationName);
    setEstimatedCost(result.estimatedCost || 0);
    setDuration(result.duration || 60);
    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setGoogleMapsUrl(result.googleMapsUrl);
    setTab('manual');
  };

  const handleAdd = () => {
    if (!title.trim()) return;

    const newItem: TripItem = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dayNumber,
      orderIndex: 0,
      type,
      title: title.trim(),
      description: description.trim(),
      locationName: locationName.trim() || destination,
      startTime,
      endTime: formatEndTime(startTime, duration),
      duration,
      estimatedCost: estimatedCost || undefined,
      latitude: latitude || 0,
      longitude: longitude || 0,
      googleMapsUrl,
      dataReliability: latitude ? 'estimated' : 'generated',
    };

    onAdd(newItem);
  };

  const formatEndTime = (start: string, dur: number): string => {
    const [h, m] = start.split(':').map(Number);
    const totalMin = h * 60 + m + dur;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
  };

  const getTypeIcon = (t: string) => {
    switch (t) {
      case 'restaurant': return <Utensils className="h-4 w-4" />;
      case 'hotel': return <Hotel className="h-4 w-4" />;
      case 'transport': return <Car className="h-4 w-4" />;
      case 'flight': return <Plane className="h-4 w-4" />;
      default: return <Camera className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter une activité - Jour {dayNumber}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'search' | 'manual')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-4 w-4" />
              Rechercher
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <Plus className="h-4 w-4" />
              Manuel
            </TabsTrigger>
          </TabsList>

          {/* Search tab */}
          <TabsContent value="search" className="space-y-3 mt-3">
            <div className="flex gap-2">
              <Input
                placeholder={`Rechercher à ${destination}...`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
              />
              <Button
                onClick={() => handleSearch(query)}
                disabled={searching}
                size="sm"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {results.length === 0 && hasSearched && !searching && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Aucun résultat. Essayez un autre terme ou ajoutez manuellement.
                </p>
              )}
              {results.map((result) => (
                <Card
                  key={result.id}
                  className="p-3 cursor-pointer hover:bg-accent transition-colors"
                  onClick={() => selectResult(result)}
                >
                  <div className="flex items-start gap-3">
                    {result.imageUrl ? (
                      <img
                        src={result.imageUrl}
                        alt={result.title}
                        className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        {getTypeIcon(result.type)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-sm truncate">{result.title}</h4>
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {result.type === 'restaurant' ? 'Restaurant' : 'Activité'}
                        </Badge>
                      </div>
                      {result.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {result.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {result.rating && (
                          <span className="flex items-center gap-0.5">
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                            {result.rating}
                          </span>
                        )}
                        {result.locationName && (
                          <span className="flex items-center gap-0.5 truncate">
                            <MapPin className="h-3 w-3" />
                            {result.locationName}
                          </span>
                        )}
                        {result.estimatedCost !== undefined && result.estimatedCost > 0 && (
                          <span>{result.estimatedCost}&euro;</span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Manual form tab */}
          <TabsContent value="manual" className="space-y-4 mt-3">
            <div className="grid gap-3">
              <div>
                <Label>Titre *</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nom de l'activité"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as TripItemType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIVITY_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <span className="flex items-center gap-2">
                            {t.icon}
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Lieu</Label>
                  <Input
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder={destination}
                  />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description optionnelle"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Heure</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Durée (min)</Label>
                  <Input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
                    min={15}
                    step={15}
                  />
                </div>
                <div>
                  <Label>Coût estimé</Label>
                  <Input
                    type="number"
                    value={estimatedCost}
                    onChange={(e) => setEstimatedCost(parseFloat(e.target.value) || 0)}
                    min={0}
                    step={5}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button onClick={handleAdd} disabled={!title.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter au Jour {dayNumber}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
