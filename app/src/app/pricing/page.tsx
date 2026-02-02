'use client';

import { useSearchParams } from 'next/navigation';
import { PricingCards } from '@/components/billing/PricingCard';
import { CheckCircle, XCircle } from 'lucide-react';

export default function PricingPage() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success');
  const canceled = searchParams.get('canceled');

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold mb-3">Choisissez votre plan</h1>
        <p className="text-muted-foreground">
          Planifiez vos voyages avec l&apos;IA. Apple Pay, Google Pay et CB acceptés.
        </p>
      </div>

      {success && (
        <div className="mb-8 rounded-xl border border-green-500/30 bg-green-500/5 p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-green-500" />
          <p className="text-sm font-medium">Abonnement activé ! Profitez de toutes les fonctionnalités Pro.</p>
        </div>
      )}

      {canceled && (
        <div className="mb-8 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-orange-500" />
          <p className="text-sm font-medium">Paiement annulé. Vous pouvez réessayer quand vous voulez.</p>
        </div>
      )}

      <PricingCards />
    </div>
  );
}
