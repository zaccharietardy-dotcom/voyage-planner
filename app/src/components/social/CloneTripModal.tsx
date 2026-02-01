'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Users, Wallet, Copy, Loader2 } from 'lucide-react';
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
  const [endDate, setEndDate] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [budgetLevel, setBudgetLevel] = useState<string>('');
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
          end_date: endDate || undefined,
          group_size: groupSize,
          budget_level: budgetLevel || undefined,
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
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5" /> Cloner ce voyage
          </DialogTitle>
          <DialogDescription>{tripTitle} · {originalDuration} jours</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Départ</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div>
              <Label className="text-xs">Retour (optionnel)</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
              />
            </div>
          </div>

          {/* Group size */}
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5" /> Voyageurs
            </Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setGroupSize(n)}
                  className={cn(
                    'w-10 h-10 rounded-lg font-medium text-sm transition-all border',
                    groupSize === n
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {n === 6 ? '6+' : n}
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-2">
              <Wallet className="w-3.5 h-3.5" /> Budget (optionnel)
            </Label>
            <div className="flex gap-2">
              {[
                { id: 'economic', label: 'Eco' },
                { id: 'moderate', label: 'Modéré' },
                { id: 'luxury', label: 'Luxe' },
              ].map(b => (
                <button
                  key={b.id}
                  onClick={() => setBudgetLevel(budgetLevel === b.id ? '' : b.id)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm transition-all border',
                    budgetLevel === b.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button onClick={handleClone} disabled={loading || !startDate} className="w-full gap-2">
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Clonage en cours...</>
            ) : (
              <><Copy className="w-4 h-4" /> Cloner le voyage</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
