'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Upload, Check, AlertCircle } from 'lucide-react';
import { parseBookingText, ParsedBooking } from '@/lib/services/bookingParser';

interface ImportBookingProps {
  onImport: (booking: ParsedBooking) => void;
  trigger?: React.ReactNode;
}

export function ImportBooking({ onImport, trigger }: ImportBookingProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedBooking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const booking = await parseBookingText(text);
    setLoading(false);

    if (booking) {
      setResult(booking);
    } else {
      setError('Impossible d\'extraire les informations. Vérifiez le texte collé.');
    }
  };

  const handleConfirm = () => {
    if (result) {
      onImport(result);
      setOpen(false);
      setText('');
      setResult(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Importer une réservation
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importer une réservation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Collez le texte de votre email de confirmation (vol, hôtel, activité).
          </p>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Collez votre confirmation de réservation ici..."
            className="min-h-[150px] text-xs"
          />

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Réservation détectée</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Type: <strong>{result.type}</strong> — {result.name}
              </p>
              {result.date && <p className="text-xs text-muted-foreground">Date: {result.date}</p>}
              {result.confirmationCode && <p className="text-xs text-muted-foreground">Réf: {result.confirmationCode}</p>}
              {result.price && <p className="text-xs text-muted-foreground">Prix: {result.price} {result.currency}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2">
            {!result ? (
              <Button onClick={handleParse} disabled={loading || !text.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Analyser
              </Button>
            ) : (
              <Button onClick={handleConfirm}>
                Ajouter au voyage
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
