'use client';

import { useState } from 'react';
import { Check, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';

const freePlan = {
  name: 'Gratuit',
  features: [
    '1 voyage par mois',
    'Itinéraire IA',
    'Réseau social complet',
    'Carte interactive',
  ],
};

const proFeatures = [
  'Voyages illimités',
  'Régénération IA illimitée',
  'Collaborateurs illimités',
  'Export PDF & calendrier',
  'Badge Pro sur le profil',
  'Support prioritaire',
];

export function PricingCards() {
  const { user } = useAuth();
  const { isPro, loading: subLoading } = useSubscription();
  const [loading, setLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'yearly' | 'monthly'>('yearly');

  const handleCheckout = async (plan: 'monthly' | 'yearly') => {
    setLoading('pro');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
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

  const handlePortal = async () => {
    setLoading('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Portal error:', error);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Billing toggle */}
      {!isPro && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setBillingPeriod('monthly')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              billingPeriod === 'monthly'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Mensuel
          </button>
          <button
            onClick={() => setBillingPeriod('yearly')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors relative',
              billingPeriod === 'yearly'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Annuel
            <span className="absolute -top-2 -right-12 text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-full font-bold">
              -58%
            </span>
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {/* Free Plan */}
        <div className={cn(
          'rounded-2xl border p-6 flex flex-col',
          !isPro && 'border-primary/50 bg-primary/5'
        )}>
          <h3 className="text-xl font-bold">{freePlan.name}</h3>
          <div className="mt-4 mb-6">
            <span className="text-4xl font-bold">0€</span>
          </div>
          <ul className="space-y-3 flex-1">
            {freePlan.features.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          {!isPro && (
            <Button variant="outline" className="mt-6 w-full" disabled>
              Plan actuel
            </Button>
          )}
        </div>

        {/* One-Time */}
        <div className="rounded-2xl border p-6 flex flex-col">
          <h3 className="text-xl font-bold">À l&apos;unité</h3>
          <div className="mt-4 mb-6">
            <span className="text-4xl font-bold">0.99€</span>
            <span className="text-muted-foreground">/voyage</span>
          </div>
          <ul className="space-y-3 flex-1">
            {['1 voyage supplémentaire', 'Itinéraire IA complet', 'Sans engagement'].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="mt-6 w-full"
            onClick={user ? handleOneTime : undefined}
            disabled={!!loading || !user || isPro}
          >
            {loading === 'one-time' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPro ? (
              'Inclus dans Pro'
            ) : !user ? (
              'Connectez-vous'
            ) : (
              'Acheter 1 voyage'
            )}
          </Button>
        </div>

        {/* Pro Plan */}
        <div className={cn(
          'rounded-2xl border p-6 flex flex-col relative overflow-hidden',
          isPro ? 'border-primary/50 bg-primary/5' : 'border-[#d4a853]/50'
        )}>
          {!isPro && (
            <div className="absolute top-4 right-4">
              <Sparkles className="h-5 w-5 text-[#d4a853]" />
            </div>
          )}
          <h3 className="text-xl font-bold">Pro</h3>
          <div className="mt-4 mb-6">
            {billingPeriod === 'yearly' ? (
              <>
                <span className="text-4xl font-bold">9.99€</span>
                <span className="text-muted-foreground">/an</span>
                <p className="text-xs text-muted-foreground mt-1">
                  soit 0.83€/mois
                </p>
              </>
            ) : (
              <>
                <span className="text-4xl font-bold">1.99€</span>
                <span className="text-muted-foreground">/mois</span>
                <p className="text-xs text-muted-foreground mt-1">
                  soit 23.88€/an
                </p>
              </>
            )}
          </div>
          <ul className="space-y-3 flex-1">
            {proFeatures.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-[#d4a853] shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          {subLoading ? (
            <Button className="mt-6 w-full" disabled>
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          ) : isPro ? (
            <Button
              variant="outline"
              className="mt-6 w-full"
              onClick={handlePortal}
              disabled={!!loading}
            >
              {loading === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gérer mon abonnement'}
            </Button>
          ) : (
            <Button
              className="mt-6 w-full bg-[#d4a853] hover:bg-[#b8923d] text-white"
              onClick={user ? () => handleCheckout(billingPeriod) : undefined}
              disabled={!!loading || !user}
            >
              {loading === 'pro' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : !user ? (
                'Connectez-vous'
              ) : billingPeriod === 'yearly' ? (
                'S\'abonner — 9.99€/an'
              ) : (
                'S\'abonner — 1.99€/mois'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
