'use client';

import { Hero, HowItWorks, Features, PopularDestinations, Testimonials, CTASection } from '@/components/landing';
import { Footer } from '@/components/layout';

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <HowItWorks />
      <Features />
      <PopularDestinations />
      <Testimonials />
      <CTASection />
      <Footer />
    </div>
  );
}
