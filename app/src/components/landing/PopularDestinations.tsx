'use client';

import { useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const destinations = [
  {
    name: 'Paris',
    country: 'France',
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&h=700&fit=crop',
    days: '3-5 jours',
    gradient: 'from-[#12345a]/85 via-[#1d4c7e]/45 to-transparent',
  },
  {
    name: 'Tokyo',
    country: 'Japon',
    image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&h=700&fit=crop',
    days: '7-10 jours',
    gradient: 'from-[#102a45]/85 via-[#17517f]/45 to-transparent',
  },
  {
    name: 'New York',
    country: 'États-Unis',
    image: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=900&h=700&fit=crop',
    days: '4-6 jours',
    gradient: 'from-[#1d2b42]/85 via-[#2d4f7c]/45 to-transparent',
  },
  {
    name: 'Barcelone',
    country: 'Espagne',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=900&h=700&fit=crop',
    days: '3-4 jours',
    gradient: 'from-[#3f3a2c]/80 via-[#9a7443]/40 to-transparent',
  },
  {
    name: 'Bali',
    country: 'Indonésie',
    image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=900&h=700&fit=crop',
    days: '7-14 jours',
    gradient: 'from-[#0f4b46]/80 via-[#1b8a80]/35 to-transparent',
  },
  {
    name: 'Lisbonne',
    country: 'Portugal',
    image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=900&h=700&fit=crop',
    days: '3-4 jours',
    gradient: 'from-[#5a3f1d]/80 via-[#b57e3f]/35 to-transparent',
  },
  {
    name: 'Rome',
    country: 'Italie',
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=900&h=700&fit=crop',
    days: '3-5 jours',
    gradient: 'from-[#3d2d26]/80 via-[#9f6d56]/35 to-transparent',
  },
  {
    name: 'Marrakech',
    country: 'Maroc',
    image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=900&h=700&fit=crop',
    days: '3-5 jours',
    gradient: 'from-[#4f2f1e]/80 via-[#b06b3f]/35 to-transparent',
  },
];

export function PopularDestinations() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;

    const scrollAmount = 340;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="relative py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-10 flex items-end justify-between"
        >
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#b8923d]">Inspiration</p>
            <h2 className="font-display mb-3 text-4xl font-semibold md:text-5xl">Destinations signatures</h2>
            <p className="text-lg text-muted-foreground">Des city-breaks élégants aux voyages plus immersifs.</p>
          </div>
          <div className="hidden gap-2 md:flex">
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('left')}
              className="h-10 w-10 rounded-full border-[#1e3a5f]/25 bg-background/70 hover:bg-[#1e3a5f]/5"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('right')}
              className="h-10 w-10 rounded-full border-[#1e3a5f]/25 bg-background/70 hover:bg-[#1e3a5f]/5"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        <div
          ref={scrollRef}
          className="scrollbar-hide flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {destinations.map((destination, index) => (
            <motion.div
              key={destination.name}
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              className="shrink-0 snap-start"
            >
              <Link href={`/plan?destination=${encodeURIComponent(destination.name)}`}>
                <Card className="group premium-ring w-[300px] overflow-hidden border border-[#1e3a5f]/10 p-0 shadow-lg transition-all hover:-translate-y-1 hover:shadow-2xl">
                  <CardContent className="relative p-0">
                    <div className="relative h-[220px] overflow-hidden">
                      <Image
                        src={destination.image}
                        alt={destination.name}
                        fill
                        className="object-cover transition-transform duration-700 group-hover:scale-110"
                        sizes="(max-width: 768px) 300px, 300px"
                      />
                      <div className={`absolute inset-0 bg-gradient-to-t ${destination.gradient}`} />
                      <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                        <h3 className="font-display text-2xl font-semibold">{destination.name}</h3>
                        <div className="mt-1 flex items-center gap-1 text-sm text-white/85">
                          <MapPin className="h-3.5 w-3.5" />
                          {destination.country}
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-white/10 bg-background/95 px-5 py-4 backdrop-blur">
                      <p className="text-sm text-muted-foreground">
                        Durée conseillée: <span className="font-semibold text-foreground">{destination.days}</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
