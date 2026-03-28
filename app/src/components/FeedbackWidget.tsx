'use client';

import { useState } from 'react';
import { MessageSquarePlus, X, Send, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function FeedbackWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'bug' | 'idea' | 'other'>('idea');
  const [isSending, setIsSending] = useState(false);

  if (!user) return null;

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setIsSending(true);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim(), page: window.location.pathname }),
      });

      if (!res.ok) throw new Error();

      toast.success('Merci pour votre retour !');
      setMessage('');
      setIsOpen(false);
    } catch {
      toast.error('Erreur lors de l\'envoi');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 md:bottom-6 right-4 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
          aria-label="Donner un avis"
        >
          <MessageSquarePlus className="h-5 w-5" />
        </button>
      )}

      {/* Feedback form */}
      {isOpen && (
        <div className="fixed bottom-24 md:bottom-6 right-4 z-50 w-80 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">Votre avis compte</h3>
            <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {/* Type selector */}
            <div className="flex gap-2">
              {([
                { value: 'bug' as const, label: 'Bug' },
                { value: 'idea' as const, label: 'Idée' },
                { value: 'other' as const, label: 'Autre' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    type === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={type === 'bug' ? 'Décrivez le problème...' : 'Partagez votre idée...'}
              className="w-full h-24 px-3 py-2 rounded-xl bg-muted border-0 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              maxLength={1000}
            />

            <button
              onClick={handleSubmit}
              disabled={!message.trim() || isSending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
