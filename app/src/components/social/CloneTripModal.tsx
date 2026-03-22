'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Users, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface CloneTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  originalDuration: number;
}

export function CloneTripModal({ isOpen, onClose, tripId, tripTitle, originalDuration }: CloneTripModalProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClone = async () => {
    if (!startDate) {
      setError('Date de départ requise');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/trips/${tripId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          group_size: groupSize,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur lors du clonage');
      }

      const clonedTrip = await response.json();
      onClose();
      router.push(`/trip/${clonedTrip.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adapter ce voyage à vos dates</DialogTitle>
          <DialogDescription>{tripTitle} · {originalDuration} jours</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Date de départ */}
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-2">
              <Calendar className="w-3.5 h-3.5" /> Date de départ
            </Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Nombre de voyageurs */}
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5" /> Nombre de voyageurs
            </Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setGroupSize(n)}
                  className={cn(
                    'flex-1 h-10 rounded-lg font-medium text-sm transition-all border',
                    groupSize === n
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {n === 5 ? '5+' : n}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="space-y-3">
            <Button onClick={handleClone} disabled={loading || !startDate} className="w-full gap-2 h-11 text-base">
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Adaptation en cours...</>
              ) : (
                <><Zap className="w-4 h-4" /> Adapter et personnaliser</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Vous pourrez modifier l&apos;itin&eacute;raire apr&egrave;s
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
