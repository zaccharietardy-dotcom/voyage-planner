'use client';

import { useAuth } from '@/components/auth';
import { QuickSearch } from '@/components/home/QuickSearch';
import { TravelGuides } from '@/components/home/TravelGuides';
import { MyTrips } from '@/components/home/MyTrips';
import { Footer } from '@/components/layout';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import Link from 'next/link';
import { ArrowRight, Compass, Map, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero — adapted for social network messaging */}
      <Hero />

      {/* Value proposition — 3 steps */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-center mb-12">
            Comment ça marche
          </h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Compass className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Explore</h3>
              <p className="text-sm text-muted-foreground">Découvre les voyages des autres voyageurs. Scroll, like, sauvegarde tes favoris.</p>
            </div>
            <div className="text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Map className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Adapte</h3>
              <p className="text-sm text-muted-foreground">Un voyage te plaît ? Adapte-le à tes dates et ton groupe en un clic.</p>
            </div>
            <div className="text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Users2 className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Pars</h3>
              <p className="text-sm text-muted-foreground">Itinéraire optimisé, temps de trajet réels, liens de réservation. Tout est prêt.</p>
            </div>
          </div>
          <div className="flex justify-center mt-10">
            <Link href="/explore">
              <Button size="lg" className="gap-2 rounded-full px-8">
                Explorer les voyages
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <HowItWorks />
      <Footer />
    </div>
  );
}

function Dashboard() {
  const { user, profile } = useAuth();

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  })();

  const displayName = profile?.display_name || user?.user_metadata?.full_name || '';

  return (
    <div className="min-h-screen bg-background">
      <div className="container-wide py-6 space-y-8">
        <div>
          <h1 className="text-2xl font-serif font-bold">
            {greeting}{displayName ? `, ${displayName.split(' ')[0]}` : ''} !
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prêt pour votre prochaine aventure ?
          </p>
        </div>
        <QuickSearch />
        <TravelGuides />
        <MyTrips />
      </div>
      <Footer />
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <LandingPage />;
}
