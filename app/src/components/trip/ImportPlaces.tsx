'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Upload,
  Link as LinkIcon,
  MapPin,
  FileJson,
  FileCode,
  Loader2,
  Check,
  X,
  AlertCircle,
  Map as MapIconLucide,
  Share2,
  Instagram,
  Compass,
} from 'lucide-react';
import { parseImportedPlaces, ImportedPlace, detectCategory } from '@/lib/services/googleMapsImport';
import { geocodeAddress } from '@/lib/services/geocoding';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n/translations';

interface ImportPlacesProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (places: ImportedPlace[]) => void;
  destinationCoords?: { lat: number; lng: number };
}

const CATEGORY_ICONS: Record<string, string> = {
  restaurant: '🍽️',
  cafe: '☕',
  bar: '🍺',
  museum: '🏛️',
  monument: '🗿',
  church: '⛪',
  park: '🌳',
  beach: '🏖️',
  viewpoint: '👁️',
  shopping: '🛍️',
  market: '🏪',
  hotel: '🏨',
  theater: '🎭',
  cinema: '🎬',
  stadium: '🏟️',
  zoo: '🦁',
  attraction: '🎢',
  castle: '🏰',
  other: '📍',
  unknown: '❓',
};

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  restaurant: 'places.category.restaurant',
  cafe: 'places.category.cafe',
  bar: 'places.category.bar',
  museum: 'places.category.museum',
  monument: 'places.category.monument',
  church: 'places.category.church',
  park: 'places.category.park',
  beach: 'places.category.beach',
  viewpoint: 'places.category.viewpoint',
  shopping: 'places.category.shopping',
  market: 'places.category.market',
  hotel: 'places.category.hotel',
  theater: 'places.category.theater',
  cinema: 'places.category.cinema',
  stadium: 'places.category.stadium',
  zoo: 'places.category.zoo',
  attraction: 'places.category.attraction',
  castle: 'places.category.castle',
  other: 'places.category.other',
  unknown: 'places.category.unknown',
};

export function ImportPlaces({ open, onOpenChange, onImport, destinationCoords }: ImportPlacesProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<ImportedPlace[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Tab 1: File upload
  const [dragActive, setDragActive] = useState(false);

  // Tab 2: URLs
  const [urlsText, setUrlsText] = useState('');

  // Tab 3: Manual
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // Tab 4: Social Media
  const [socialInput, setSocialInput] = useState('');
  const [socialPlatform, setSocialPlatform] = useState<string>('unknown');
  const [socialLoading, setSocialLoading] = useState(false);

  const resetState = useCallback(() => {
    setPlaces([]);
    setSelectedIds(new Set());
    setError(null);
    setUrlsText('');
    setManualName('');
    setManualAddress('');
    setSocialInput('');
    setSocialPlatform('unknown');
  }, []);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    setError(null);

    try {
      const content = await file.text();
      const parsed = parseImportedPlaces(content, file.name);

      if (parsed.length === 0) {
        setError(t('places.noPlaceFound'));
        return;
      }

      setPlaces(parsed);
      // Sélectionner tous par défaut
      setSelectedIds(new Set(parsed.map((_, i) => i)));
      toast.success(parsed.length > 1 ? t('places.foundPlural').replace('{n}', String(parsed.length)) : t('places.found').replace('{n}', String(parsed.length)));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('places.readError');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleParseURLs = () => {
    if (!urlsText.trim()) {
      toast.error(t('places.pasteUrl'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsed = parseImportedPlaces(urlsText, undefined);

      if (parsed.length === 0) {
        setError(t('places.noPlaceInUrls'));
        return;
      }

      setPlaces(parsed);
      setSelectedIds(new Set(parsed.map((_, i) => i)));
      toast.success(parsed.length > 1 ? t('places.foundPlural').replace('{n}', String(parsed.length)) : t('places.found').replace('{n}', String(parsed.length)));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('places.parseError');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualName.trim()) {
      toast.error(t('places.enterName'));
      return;
    }

    if (!manualAddress.trim()) {
      toast.error(t('places.enterAddress'));
      return;
    }

    setManualLoading(true);

    try {
      // Géocoder l'adresse
      const result = await geocodeAddress(manualAddress);

      if (!result) {
        toast.error(t('places.addressNotFound'));
        return;
      }

      const newPlace: ImportedPlace = {
        name: manualName.trim(),
        lat: result.lat,
        lng: result.lng,
        address: result.displayName,
        source: 'manual',
        category: detectCategory(manualName, result.displayName),
      };

      setPlaces([...places, newPlace]);
      setSelectedIds(new Set([...selectedIds, places.length]));

      // Reset form
      setManualName('');
      setManualAddress('');

      toast.success(t('places.placeAdded'));
    } catch (err) {
      toast.error(t('places.geocodeError'));
    } finally {
      setManualLoading(false);
    }
  };

  const toggleSelection = (index: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIds(newSelected);
  };

  const toggleAll = () => {
    if (selectedIds.size === places.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(places.map((_, i) => i)));
    }
  };

  const handleImport = () => {
    const selected = places.filter((_, i) => selectedIds.has(i));
    if (selected.length === 0) {
      toast.error(t('places.selectAtLeast'));
      return;
    }

    onImport(selected);
    toast.success(selected.length > 1 ? t('places.addedToTripPlural').replace('{n}', String(selected.length)) : t('places.addedToTrip').replace('{n}', String(selected.length)));
    resetState();
    onOpenChange(false);
  };

  const updatePlaceCategory = (index: number, category: string) => {
    setPlaces(places.map((p, i) => (i === index ? { ...p, category } : p)));
  };

  const handleSocialExtract = async () => {
    if (!socialInput.trim()) {
      toast.error(t('places.pasteUrlOrText'));
      return;
    }

    setSocialLoading(true);
    setError(null);

    try {
      // Détecter si c'est une URL pour afficher la plateforme
      let detectedPlatform = 'unknown';
      try {
        const url = new URL(socialInput);
        const hostname = url.hostname.toLowerCase();
        if (hostname.includes('instagram.com')) detectedPlatform = 'instagram';
        else if (hostname.includes('tiktok.com')) detectedPlatform = 'tiktok';
        else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) detectedPlatform = 'youtube';
        else if (hostname.includes('blog') || hostname.includes('medium.com')) detectedPlatform = 'blog';
      } catch {
        detectedPlatform = 'text';
      }

      setSocialPlatform(detectedPlatform);

      // Appeler l'API
      const response = await fetch('/api/import/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: socialInput.startsWith('http') ? socialInput : undefined,
          text: !socialInput.startsWith('http') ? socialInput : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t('places.extractError'));
        toast.error(data.error || t('places.extractError'));
        return;
      }

      if (data.places.length === 0) {
        setError(t('places.noPlaceInContent'));
        toast.warning(t('places.noPlaceWarning'));
        return;
      }

      setPlaces(data.places);
      setSelectedIds(new Set(data.places.map((_: any, i: number) => i)));
      setSocialPlatform(data.platform || detectedPlatform);
      toast.success(data.places.length > 1 ? t('places.extractedByNaraePlural').replace('{n}', String(data.places.length)) : t('places.extractedByNarae').replace('{n}', String(data.places.length)));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('places.extractError');
      setError(message);
      toast.error(message);
    } finally {
      setSocialLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('places.importTitle')}</DialogTitle>
          <DialogDescription>
            {t('places.importDesc')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="social" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="social" className="flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              {t('places.socialTab')}
            </TabsTrigger>
            <TabsTrigger value="file" className="flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              {t('places.fileTab')}
            </TabsTrigger>
            <TabsTrigger value="urls" className="flex items-center gap-1.5">
              <LinkIcon className="h-3.5 w-3.5" />
              {t('places.linksTab')}
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {t('places.manualTab')}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Social Media */}
          <TabsContent value="social" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Compass className="h-4 w-4 text-primary" />
                <span>{t('places.autoExtract')}</span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('places.urlOrText')}</label>
                <Textarea
                  value={socialInput}
                  onChange={(e) => setSocialInput(e.target.value)}
                  placeholder={t('places.urlPlaceholder')}
                  className="min-h-[180px] font-mono text-xs"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <p className="text-xs text-muted-foreground">{t('places.supportedPlatforms')}</p>
                  <div className="flex gap-1.5">
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Instagram className="h-3 w-3" />
                      Instagram
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                      </svg>
                      TikTok
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                      YouTube
                    </Badge>
                    <Badge variant="outline">Blogs</Badge>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSocialExtract}
                disabled={socialLoading || !socialInput.trim()}
                className="w-full"
              >
                {socialLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('places.extracting')}
                  </>
                ) : (
                  <>
                    <Compass className="mr-2 h-4 w-4" />
                    {t('places.extractPlaces')}
                  </>
                )}
              </Button>

              {socialPlatform !== 'unknown' && socialPlatform !== 'text' && !socialLoading && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 text-xs">
                  <Share2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t('places.detectedPlatform')} <strong className="capitalize">{socialPlatform}</strong></span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 p-3 rounded-lg">
                <p className="font-medium">{t('places.howItWorks')}</p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  <li>Collez un lien Instagram, TikTok, YouTube ou d&apos;un blog de voyage</li>
                  <li>Ou copiez-collez directement le texte d&apos;une légende/description</li>
                  <li>Notre technologie extrait automatiquement les noms de restaurants, hôtels et attractions</li>
                  <li>Les coordonnées GPS sont géocodées automatiquement</li>
                </ul>
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: File upload */}
          <TabsContent value="file" className="space-y-4">
            <div
              className={cn(
                'relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer',
                dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
              )}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".geojson,.kml,.json"
                className="hidden"
                onChange={handleFileInput}
              />

              <div className="flex flex-col items-center gap-3 text-center">
                {loading ? (
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                ) : (
                  <Upload className="h-10 w-10 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">
                    {t('places.dragDrop')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('places.supportedFormats')}
                  </p>
                </div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline" className="flex items-center gap-1">
                    <FileJson className="h-3 w-3" />
                    GeoJSON
                  </Badge>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <FileCode className="h-3 w-3" />
                    KML
                  </Badge>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 p-3 rounded-lg">
              <p className="font-medium">{t('places.howToExport')}</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li><strong>Google Takeout:</strong> takeout.google.com → Lieux sauvegardés → Format GeoJSON</li>
                <li><strong>Google My Maps:</strong> Ouvrez votre carte → Menu (⋮) → Exporter en KML</li>
              </ul>
            </div>
          </TabsContent>

          {/* Tab 3: URLs */}
          <TabsContent value="urls" className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('places.urlsLabel')}</label>
              <Textarea
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder="https://maps.google.com/maps?q=48.8566,2.3522&#10;https://www.google.com/maps/place/Tour+Eiffel/@48.8584,2.2945,17z&#10;https://goo.gl/maps/xyz"
                className="min-h-[200px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t('places.urlsHint')}
              </p>
            </div>

            <Button onClick={handleParseURLs} disabled={loading || !urlsText.trim()} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('places.analyzing')}
                </>
              ) : (
                <>
                  <MapIconLucide className="mr-2 h-4 w-4" />
                  {t('places.analyzeUrls')}
                </>
              )}
            </Button>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </TabsContent>

          {/* Tab 4: Manual */}
          <TabsContent value="manual" className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('places.placeName')}</label>
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Tour Eiffel"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('places.addressOrCity')}</label>
                <Input
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="Champ de Mars, Paris"
                />
                <p className="text-xs text-muted-foreground">
                  {t('places.addressAutoGeocode')}
                </p>
              </div>

              <Button
                onClick={handleManualAdd}
                disabled={manualLoading || !manualName.trim() || !manualAddress.trim()}
                className="w-full"
              >
                {manualLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('places.geocoding')}
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-4 w-4" />
                    {t('places.addPlace')}
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* Preview des lieux importés */}
        {places.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {places.length} lieu{places.length > 1 ? 'x' : ''} trouvé{places.length > 1 ? 's' : ''}
              </h3>
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selectedIds.size === places.length ? (
                  <>
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    {t('places.deselectAll')}
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {t('places.selectAll')}
                  </>
                )}
              </Button>
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-2 border rounded-lg p-3 bg-muted/20">
              {places.map((place, index) => (
                <Card
                  key={index}
                  className={cn(
                    'p-3 cursor-pointer transition-all',
                    selectedIds.has(index) ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/30',
                  )}
                  onClick={() => toggleSelection(index)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selectedIds.has(index)}
                      onCheckedChange={() => toggleSelection(index)}
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg leading-none">
                          {CATEGORY_ICONS[place.category || 'other']}
                        </span>
                        <h4 className="font-medium text-sm truncate">{place.name}</h4>
                      </div>

                      {place.address && (
                        <p className="text-xs text-muted-foreground truncate">{place.address}</p>
                      )}

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <select
                          value={place.category || 'other'}
                          onChange={(e) => {
                            e.stopPropagation();
                            updatePlaceCategory(index, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs border rounded px-2 py-1 bg-background"
                        >
                          {Object.entries(CATEGORY_LABEL_KEYS).map(([key, labelKey]) => (
                            <option key={key} value={key}>
                              {CATEGORY_ICONS[key]} {t(labelKey)}
                            </option>
                          ))}
                        </select>

                        <Badge variant="outline" className="text-xs">
                          {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                        </Badge>

                        {place.sourceUrl && (
                          <a
                            href={place.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-primary hover:underline"
                          >
                            {t('places.viewOnMaps')}
                          </a>
                        )}
                      </div>

                      {place.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{place.notes}</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetState} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleImport} disabled={selectedIds.size === 0} className="flex-1">
                <Check className="mr-2 h-4 w-4" />
                {selectedIds.size > 1 ? t('places.addToTripPlural').replace('{n}', String(selectedIds.size)) : t('places.addToTrip').replace('{n}', String(selectedIds.size))}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
