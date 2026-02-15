'use client';

import { useState } from 'react';
import { Star, Send, Loader2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';

interface WriteReviewProps {
  activityTitle: string;
  city: string;
  placeId?: string;
  tripId?: string;
  onReviewSubmitted?: () => void;
}

export function WriteReview({
  activityTitle,
  city,
  placeId,
  tripId,
  onReviewSubmitted,
}: WriteReviewProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tips, setTips] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error('Vous devez être connecté pour laisser un avis');
      return;
    }

    if (rating === 0) {
      toast.error('Veuillez sélectionner une note');
      return;
    }

    if (title.trim().length < 5) {
      toast.error('Le titre doit faire au moins 5 caractères');
      return;
    }

    if (content.trim().length < 50) {
      toast.error('Le contenu doit faire au moins 50 caractères');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId,
          tripId,
          activityTitle,
          city,
          rating,
          title: title.trim(),
          content: content.trim(),
          tips: tips.trim() || undefined,
          visitDate: visitDate || undefined,
        }),
      });

      if (res.ok) {
        toast.success('Avis publié avec succès !');
        // Reset form
        setRating(0);
        setTitle('');
        setContent('');
        setTips('');
        setVisitDate('');
        onReviewSubmitted?.();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erreur lors de la publication');
      }
    } catch {
      toast.error('Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <Card className="p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Connectez-vous pour laisser un avis
        </p>
      </Card>
    );
  }

  const charCount = content.length;
  const minChars = 50;

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-lg mb-4">Laisser un avis</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Rating Stars */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Note <span className="text-destructive">*</span>
          </label>
          <div
            className="flex items-center gap-1"
            onMouseLeave={() => setHoverRating(0)}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={cn(
                    'h-8 w-8 transition-colors',
                    star <= (hoverRating || rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground/30'
                  )}
                />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm text-muted-foreground">
                {rating === 5
                  ? 'Excellent !'
                  : rating === 4
                  ? 'Très bien'
                  : rating === 3
                  ? 'Bien'
                  : rating === 2
                  ? 'Moyen'
                  : 'Décevant'}
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-1.5">
            Titre de votre avis <span className="text-destructive">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Résumez votre expérience en quelques mots"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            maxLength={100}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground mt-1">{title.length}/100</p>
        </div>

        {/* Content */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium mb-1.5">
            Votre avis <span className="text-destructive">*</span>
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Partagez votre expérience en détail (minimum 50 caractères)"
            rows={5}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            maxLength={1000}
            disabled={submitting}
          />
          <p
            className={cn(
              'text-xs mt-1',
              charCount < minChars ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {charCount}/{minChars} caractères minimum
          </p>
        </div>

        {/* Tips (optional) */}
        <div>
          <label htmlFor="tips" className="block text-sm font-medium mb-1.5">
            Conseils (optionnel)
          </label>
          <textarea
            id="tips"
            value={tips}
            onChange={(e) => setTips(e.target.value)}
            placeholder="Partagez vos conseils pratiques (meilleur moment, astuces, etc.)"
            rows={3}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            maxLength={500}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground mt-1">{tips.length}/500</p>
        </div>

        {/* Visit Date (optional) */}
        <div>
          <label htmlFor="visitDate" className="block text-sm font-medium mb-1.5">
            Date de visite (optionnel)
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              id="visitDate"
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full pl-10 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={submitting}
            />
          </div>
        </div>

        {/* Submit Button */}
        <Button type="submit" disabled={submitting || rating === 0 || charCount < minChars}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Publication...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Publier mon avis
            </>
          )}
        </Button>
      </form>
    </Card>
  );
}
