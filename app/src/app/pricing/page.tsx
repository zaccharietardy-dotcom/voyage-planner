import { Suspense } from 'react';
import { PricingContent } from './PricingContent';

export default function PricingPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 max-w-4xl text-center">Chargement...</div>}>
      <PricingContent />
    </Suspense>
  );
}
