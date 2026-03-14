'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { filterDestinations } from '@/lib/services/exploreDestinations';
import { MapPin, Plane, Euro, Calendar } from 'lucide-react';
import Link from 'next/link';

const ExploreMap = dynamic(
  () => import('@/components/explore/ExploreMap').then(m => m.ExploreMap),
  { ssr: false, loading: () => <div className="w-full h-[60vh] bg-muted animate-pulse rounded-lg" /> }
);

export default function ExploreAnywherePage() {
  const [budget, setBudget] = useState(1500);
  const [duration, setDuration] = useState(7);
  const [origin, setOrigin] = useState('Paris');

  const destinations = useMemo(
    () => filterDestinations(budget, duration),
    [budget, duration]
  );

  const affordableCount = destinations.filter(d => d.affordable).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-serif font-bold">Explorer des destinations</h1>
          <p className="text-sm text-muted-foreground">D&eacute;couvrez o&ugrave; partir selon votre budget</p>
        </div>

        {/* Controls */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Plane className="h-3 w-3" /> Ville de d&eacute;part
                </label>
                <Input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="Paris" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Euro className="h-3 w-3" /> Budget total: {budget}&euro;
                </label>
                <Slider value={[budget]} onValueChange={([v]) => setBudget(v)} min={300} max={5000} step={100} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Dur&eacute;e: {duration} jours
                </label>
                <Slider value={[duration]} onValueChange={([v]) => setDuration(v)} min={2} max={21} step={1} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {affordableCount} destination{affordableCount > 1 ? 's' : ''} dans votre budget
            </p>
          </CardContent>
        </Card>

        {/* Map */}
        <div className="rounded-xl overflow-hidden border mb-6">
          <ExploreMap destinations={destinations} />
        </div>

        {/* Destination list */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {destinations.filter(d => d.affordable).map(dest => (
            <Link
              key={dest.city}
              href={`/plan?destination=${encodeURIComponent(dest.city)}&origin=${encodeURIComponent(origin)}&duration=${duration}`}
            >
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-sm">{dest.city}</h3>
                      <p className="text-xs text-muted-foreground">{dest.country}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">~{dest.totalEstimate}&euro;</p>
                      <p className="text-[10px] text-muted-foreground">{dest.dailyCost}&euro;/jour</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
