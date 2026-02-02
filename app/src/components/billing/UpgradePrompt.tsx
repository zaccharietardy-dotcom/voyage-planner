'use client';

import { useState } from 'react';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradePromptProps {
  message?: string;
}

export function UpgradePrompt({ message = 'Tu as atteint la limite de 2 voyages/mois.' }: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  if (dismissed) return null;

  const handleUpgrade = async () => {
    setLoading('pro');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'yearly' }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setLoading(null);
    }
  };

  const handleOneTime = async () => {
    setLoading('one-time');
    try {
      const res = await fetch('/api/billing/one-time', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('One-time checkout error:', error);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="relative rounded-xl border border-[#d4a853]/30 bg-[#d4a853]/5 p-4 flex items-center gap-4">
      <Sparkles className="h-5 w-5 text-[#d4a853] shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Passe à Pro pour des voyages illimités.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handleOneTime}
          disabled={!!loading}
        >
          {loading === 'one-time' ? <Loader2 className="h-4 w-4 animate-spin" /> : '0.99€ ce voyage'}
        </Button>
        <Button
          size="sm"
          className="bg-[#d4a853] hover:bg-[#b8923d] text-white"
          onClick={handleUpgrade}
          disabled={!!loading}
        >
          {loading === 'pro' ? <Loader2 className="h-4 w-4 animate-spin" /> : '9.99€/an'}
        </Button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
