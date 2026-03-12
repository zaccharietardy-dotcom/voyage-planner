'use client';

import { useAuth } from '@/components/auth';
import { QuickSearch } from '@/components/home/QuickSearch';
import { TravelGuides } from '@/components/home/TravelGuides';
import { MyTrips } from '@/components/home/MyTrips';
import { Footer } from '@/components/layout';

export default function Home() {
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
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-serif font-bold">
            {greeting}{displayName ? `, ${displayName.split(' ')[0]}` : ''} !
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prêt pour votre prochaine aventure ?
          </p>
        </div>

        {/* Search bar */}
        <QuickSearch />

        {/* Destinations carousel */}
        <TravelGuides />

        {/* My trips */}
        <MyTrips />
      </div>

      <Footer />
    </div>
  );
}
