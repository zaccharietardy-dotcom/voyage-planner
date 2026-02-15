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
  Sparkles,
} from 'lucide-react';
import { parseImportedPlaces, ImportedPlace, detectCategory } from '@/lib/services/googleMapsImport';
import { geocodeAddress } from '@/lib/services/geocoding';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  museum: 'Musée',
  monument: 'Monument',
  church: 'Lieu de culte',
  park: 'Parc',
  beach: 'Plage',
  viewpoint: 'Point de vue',
  shopping: 'Shopping',
  market: 'Marché',
  hotel: 'Hébergement',
  theater: 'Théâtre',
  cinema: 'Cinéma',
  stadium: 'Stade',
  zoo: 'Zoo / Aquarium',
  attraction: 'Attraction',
  castle: 'Château',
  other: 'Autre',
  unknown: 'Non catégorisé',
};

export function ImportPlaces({ open, onOpenChange, onImport, destinationCoords }: ImportPlacesProps) {
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
        setError('Aucun lieu trouvé dans le fichier');
        return;
      }

      setPlaces(parsed);
      // Sélectionner tous par défaut
      setSelectedIds(new Set(parsed.map((_, i) => i)));
      toast.success(`${parsed.length} lieu${parsed.length > 1 ? 'x' : ''} trouvé${parsed.length > 1 ? 's' : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la lecture du fichier';
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
      toast.error('Veuillez coller au moins une URL Google Maps');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsed = parseImportedPlaces(urlsText, undefined);

      if (parsed.length === 0) {
        setError('Aucun lieu trouvé dans les URLs');
        return;
      }

      setPlaces(parsed);
      setSelectedIds(new Set(parsed.map((_, i) => i)));
      toast.success(`${parsed.length} lieu${parsed.length > 1 ? 'x' : ''} trouvé${parsed.length > 1 ? 's' : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du parsing des URLs';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualName.trim()) {
      toast.error('Veuillez saisir un nom de lieu');
      return;
    }

    if (!manualAddress.trim()) {
      toast.error('Veuillez saisir une adresse');
      return;
    }

    setManualLoading(true);

    try {
      // Géocoder l'adresse
      const result = await geocodeAddress(manualAddress);

      if (!result) {
        toast.error('Adresse introuvable. Vérifiez l\'orthographe.');
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

      toast.success('Lieu ajouté');
    } catch (err) {
      toast.error('Erreur lors du géocodage');
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
      toast.error('Sélectionnez au moins un lieu');
      return;
    }

    onImport(selected);
    toast.success(`${selected.length} lieu${selected.length > 1 ? 'x' : ''} ajouté${selected.length > 1 ? 's' : ''} au voyage`);
    resetState();
    onOpenChange(false);
  };

  const updatePlaceCategory = (index: number, category: string) => {
    setPlaces(places.map((p, i) => (i === index ? { ...p, category } : p)));
  };

  const handleSocialExtract = async () => {
    if (!socialInput.trim()) {
      toast.error('Veuillez coller une URL ou du texte');
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
        setError(data.error || 'Erreur lors de l\'extraction');
        toast.error(data.error || 'Erreur lors de l\'extraction');
        return;
      }

      if (data.places.length === 0) {
        setError('Aucun lieu trouvé dans ce contenu');
        toast.warning('Aucun lieu trouvé. Vérifiez que le contenu mentionne des lieux spécifiques.');
        return;
      }

      setPlaces(data.places);
      setSelectedIds(new Set(data.places.map((_: any, i: number) => i)));
      setSocialPlatform(data.platform || detectedPlatform);
      toast.success(`${data.places.length} lieu${data.places.length > 1 ? 'x' : ''} extrait${data.places.length > 1 ? 's' : ''} par l'IA`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'extraction';
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
          <DialogTitle>Importer des lieux sauvegardés</DialogTitle>
          <DialogDescription>
            Importez vos lieux favoris depuis Google Maps, My Maps, ou ajoutez-les manuellement.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="social" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="social" className="flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              Réseaux sociaux
            </TabsTrigger>
            <TabsTrigger value="file" className="flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Fichier
            </TabsTrigger>
            <TabsTrigger value="urls" className="flex items-center gap-1.5">
              <LinkIcon className="h-3.5 w-3.5" />
              Liens
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Manuel
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Social Media */}
          <TabsContent value="social" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Extraction automatique par IA</span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">URL ou texte</label>
                <Textarea
                  value={socialInput}
                  onChange={(e) => setSocialInput(e.target.value)}
                  placeholder="Collez une URL (Instagram, TikTok, YouTube, blog) ou directement le texte d'une légende/description..."
                  className="min-h-[180px] font-mono text-xs"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <p className="text-xs text-muted-foreground">Plateformes supportées:</p>
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
                    Extraction en cours avec l'IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Extraire les lieux
                  </>
                )}
              </Button>

              {socialPlatform !== 'unknown' && socialPlatform !== 'text' && !socialLoading && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 text-xs">
                  <Share2 className="h-3.5 w-3.5 text-primary" />
                  <span>Plateforme détectée: <strong className="capitalize">{socialPlatform}</strong></span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 p-3 rounded-lg">
                <p className="font-medium">Comment ça marche:</p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  <li>Collez un lien Instagram, TikTok, YouTube ou d'un blog de voyage</li>
                  <li>Ou copiez-collez directement le texte d'une légende/description</li>
                  <li>L'IA extrait automatiquement les noms de restaurants, hôtels et attractions</li>
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
                    Glissez-déposez un fichier ou cliquez pour parcourir
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Formats supportés: GeoJSON (.geojson), KML (.kml)
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
              <p className="font-medium">Comment obtenir vos données Google Maps:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li><strong>Google Takeout:</strong> takeout.google.com → Lieux sauvegardés → Format GeoJSON</li>
                <li><strong>Google My Maps:</strong> Ouvrez votre carte → Menu (⋮) → Exporter en KML</li>
              </ul>
            </div>
          </TabsContent>

          {/* Tab 3: URLs */}
          <TabsContent value="urls" className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">URLs Google Maps (une par ligne)</label>
              <Textarea
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder="https://maps.google.com/maps?q=48.8566,2.3522&#10;https://www.google.com/maps/place/Tour+Eiffel/@48.8584,2.2945,17z&#10;https://goo.gl/maps/xyz"
                className="min-h-[200px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Collez vos liens Google Maps. Formats acceptés: liens directs, liens avec coordonnées, liens courts (goo.gl).
              </p>
            </div>

            <Button onClick={handleParseURLs} disabled={loading || !urlsText.trim()} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <MapIconLucide className="mr-2 h-4 w-4" />
                  Analyser les URLs
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
                <label className="text-sm font-medium">Nom du lieu</label>
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Tour Eiffel"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Adresse ou ville</label>
                <Input
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="Champ de Mars, Paris"
                />
                <p className="text-xs text-muted-foreground">
                  L'adresse sera géocodée automatiquement
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
                    Géocodage...
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-4 w-4" />
                    Ajouter le lieu
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
                    Tout désélectionner
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Tout sélectionner
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
                          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {CATEGORY_ICONS[key]} {label}
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
                            Voir sur Maps
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
                Annuler
              </Button>
              <Button onClick={handleImport} disabled={selectedIds.size === 0} className="flex-1">
                <Check className="mr-2 h-4 w-4" />
                Ajouter {selectedIds.size} lieu{selectedIds.size > 1 ? 'x' : ''} au voyage
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
