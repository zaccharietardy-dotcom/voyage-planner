'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const destinations = [
  {
    name: 'Paris',
    country: 'France',
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400&h=300&fit=crop',
    days: '3-5 jours',
    gradient: 'from-blue-600/80 to-purple-600/80',
  },
  {
    name: 'Tokyo',
    country: 'Japon',
    image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=400&h=300&fit=crop',
    days: '7-10 jours',
    gradient: 'from-pink-600/80 to-red-600/80',
  },
  {
    name: 'New York',
    country: 'États-Unis',
    image: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400&h=300&fit=crop',
    days: '4-6 jours',
    gradient: 'from-orange-600/80 to-yellow-600/80',
  },
  {
    name: 'Barcelone',
    country: 'Espagne',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=400&h=300&fit=crop',
    days: '3-4 jours',
    gradient: 'from-red-600/80 to-orange-600/80',
  },
  {
    name: 'Bali',
    country: 'Indonésie',
    image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=400&h=300&fit=crop',
    days: '7-14 jours',
    gradient: 'from-green-600/80 to-teal-600/80',
  },
  {
    name: 'Lisbonne',
    country: 'Portugal',
    image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=400&h=300&fit=crop',
    days: '3-4 jours',
    gradient: 'from-yellow-600/80 to-orange-600/80',
  },
  {
    name: 'Rome',
    country: 'Italie',
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=400&h=300&fit=crop',
    days: '3-5 jours',
    gradient: 'from-amber-600/80 to-red-600/80',
  },
  {
    name: 'Marrakech',
    country: 'Maroc',
    image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=400&h=300&fit=crop',
    days: '3-5 jours',
    gradient: 'from-orange-600/80 to-red-700/80',
  },
];

export function PopularDestinations() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 320;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex items-end justify-between mb-10"
        >
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Destinations populaires</h2>
            <p className="text-lg text-muted-foreground">
              Inspirez-vous de nos destinations préférées
            </p>
          </div>
          <div className="hidden md:flex gap-2">
            <Button variant="outline" size="icon" onClick={() => scroll('left')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => scroll('right')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>

        <div
          ref={scrollRef}
          className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {destinations.map((destination, index) => (
            <motion.div
              key={destination.name}
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.05 }}
              className="flex-shrink-0 snap-start"
            >
              <Link href={`/plan?destination=${encodeURIComponent(destination.name)}`}>
                <Card className="w-[280px] overflow-hidden group cursor-pointer border-0 shadow-md hover:shadow-xl transition-all">
                  <CardContent className="p-0 relative">
                    <div className="relative h-[200px] overflow-hidden">
                      <img
                        src={destination.image}
                        alt={destination.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                      <div className={`absolute inset-0 bg-gradient-to-t ${destination.gradient} opacity-60`} />
                      <div className="absolute bottom-4 left-4 right-4 text-white">
                        <h3 className="text-xl font-bold">{destination.name}</h3>
                        <div className="flex items-center gap-1 text-sm opacity-90">
                          <MapPin className="h-3 w-3" />
                          {destination.country}
                        </div>
                      </div>
                    </div>
                    <div className="p-4 bg-background">
                      <p className="text-sm text-muted-foreground">
                        À partir de <span className="font-medium text-foreground">{destination.days}</span>
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
