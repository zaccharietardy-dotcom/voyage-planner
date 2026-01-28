'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { TripItem, TripItemType, TRIP_ITEM_COLORS } from '@/lib/types';
import {
  Clock,
  MapPin,
  Save,
  X,
  Loader2,
  RefreshCw,
  Star,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ActivityEditModalProps {
  item: TripItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedItem: TripItem) => void;
  onReplace?: (item: TripItem) => void;
  onDelete?: (item: TripItem) => void;
}

const TYPE_OPTIONS: { value: TripItemType; label: string }[] = [
  { value: 'activity', label: 'Activité' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'hotel', label: 'Hébergement' },
  { value: 'transport', label: 'Transport' },
  { value: 'flight', label: 'Vol' },
  { value: 'parking', label: 'Parking' },
  { value: 'checkin', label: 'Check-in' },
  { value: 'checkout', label: 'Check-out' },
  { value: 'luggage', label: 'Consigne bagages' },
];

export function ActivityEditModal({
  item,
  isOpen,
  onClose,
  onSave,
  onReplace,
  onDelete,
}: ActivityEditModalProps) {
  const [formData, setFormData] = useState<Partial<TripItem>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setFormData({ ...item });
    }
  }, [item]);

  const handleSave = async () => {
    if (!item || !formData.title) return;

    setIsSaving(true);
    try {
      onSave({ ...item, ...formData } as TripItem);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!item) return;
    if (confirm('Êtes-vous sûr de vouloir supprimer cette activité ?')) {
      onDelete?.(item);
      onClose();
    }
  };

  if (!item) return null;

  const color = TRIP_ITEM_COLORS[formData.type || item.type];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            Modifier l&apos;activité
          </DialogTitle>
          <DialogDescription>
            Modifiez les détails de cette activité ou remplacez-la par une alternative.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Type */}
          <div className="grid gap-2">
            <Label htmlFor="type">Type</Label>
            <Select
              value={formData.type || item.type}
              onValueChange={(value) =>
                setFormData({ ...formData, type: value as TripItemType })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="grid gap-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              value={formData.title || ''}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="Nom de l'activité"
            />
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Description de l'activité"
              rows={3}
            />
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startTime" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Début
              </Label>
              <Input
                id="startTime"
                type="time"
                value={formData.startTime || ''}
                onChange={(e) =>
                  setFormData({ ...formData, startTime: e.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endTime" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Fin
              </Label>
              <Input
                id="endTime"
                type="time"
                value={formData.endTime || ''}
                onChange={(e) =>
                  setFormData({ ...formData, endTime: e.target.value })
                }
              />
            </div>
          </div>

          {/* Location */}
          <div className="grid gap-2">
            <Label htmlFor="location" className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Lieu
            </Label>
            <Input
              id="location"
              value={formData.locationName || ''}
              onChange={(e) =>
                setFormData({ ...formData, locationName: e.target.value })
              }
              placeholder="Adresse ou lieu"
            />
          </div>

          {/* Estimated Cost */}
          <div className="grid gap-2">
            <Label htmlFor="cost">Coût estimé (€)</Label>
            <Input
              id="cost"
              type="number"
              min={0}
              value={formData.estimatedCost || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  estimatedCost: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="0"
            />
          </div>

          {/* Rating (display only) */}
          {item.rating && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              <span>{item.rating.toFixed(1)}</span>
            </div>
          )}

          {/* Links */}
          {(item.bookingUrl || item.googleMapsPlaceUrl) && (
            <div className="flex flex-wrap gap-2">
              {item.bookingUrl && (
                <a
                  href={item.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Réserver
                </a>
              )}
              {item.googleMapsPlaceUrl && (
                <a
                  href={item.googleMapsPlaceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-green-600 hover:underline"
                >
                  <MapPin className="h-3 w-3" />
                  Voir sur Maps
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            {onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
              >
                Supprimer
              </Button>
            )}
            {onReplace && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReplace(item)}
                className="gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Remplacer
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              <X className="h-4 w-4 mr-1" />
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
