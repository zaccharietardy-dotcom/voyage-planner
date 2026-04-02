'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/components/auth';
import { Trip } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MapPin, Calendar, Users, Plane, Loader2, Globe, Lock, Users2, ChevronDown, Camera, Navigation, Clock, Trash2, Settings2, ArrowRight } from 'lucide-react';
import { TripTemplates } from '@/components/TripTemplates';
import Link from 'next/link';
import { format } from 'date-fns';
import { fr, enUS, es, de, it, pt } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useConnectivity } from '@/hooks/useConnectivity';
import { cacheTripsList, readCachedTripsList } from '@/lib/mobile/offline-cache';
import { useTranslation } from '@/lib/i18n';

type TripVisibility = 'public' | 'friends' | 'private';
type MemberRole = 'owner' | 'editor' | 'viewer';

interface TripListItem extends Trip {
  userRole?: MemberRole;
  isInvited?: boolean;
  member_joined_at?: string | null;
}

const dateFnsLocales = { fr, en: enUS, es, de, it, pt };

const DESTINATION_IMAGES: Record<string, string> = {
  'paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
  'tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80',
  'london': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80',
  'londres': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80',
  'rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80',
  'barcelone': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
  'lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=800&q=80',
  'amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800&q=80',
  'marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=800&q=80',
  'madrid': 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=800&q=80',
};

function getDestinationImage(destination: string): string {
  const normalized = destination.toLowerCase();
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (normalized.includes(key)) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80';
}

function getTripStatus(startDate: string, durationDays: number): { label: string; color: string; dot: string } {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);
  const now = new Date();

  if (now < start) return { label: 'À venir', color: 'text-blue-400 bg-blue-500/10', dot: 'bg-blue-400' };
  if (now >= start && now <= end) return { label: 'En cours', color: 'text-green-400 bg-green-500/10', dot: 'bg-green-400' };
  return { label: 'Passé', color: 'text-slate-400 bg-slate-500/10', dot: 'bg-slate-400' };
}

export default function MesVoyagesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { isOffline } = useConnectivity();
  const { t, locale } = useTranslation();

  const VISIBILITY_OPTIONS = useMemo(() => [
    { value: 'public' as TripVisibility, label: t('myTrips.public'), icon: <Globe className="h-4 w-4" />, description: t('myTrips.visibleAll') },
    { value: 'friends' as TripVisibility, label: t('myTrips.friends'), icon: <Users2 className="h-4 w-4" />, description: t('myTrips.visibleFriends') },
    { value: 'private' as TripVisibility, label: t('myTrips.private'), icon: <Lock className="h-4 w-4" />, description: t('myTrips.visibleMe') },
  ], [t]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/mes-voyages');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    async function fetchTrips() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      setError(null);
      try {
        const res = await fetch('/api/trips');
        if (!res.ok) {
          setError('Impossible de charger vos voyages.');
          const cached = readCachedTripsList<TripListItem>();
          setTrips(cached);
          return;
        }
        const tripsData = await res.json() as TripListItem[];
        setTrips(tripsData || []);
        cacheTripsList<TripListItem>(tripsData || []);
      } catch (err) {
        setError('Erreur de connexion.');
        const cached = readCachedTripsList<TripListItem>();
        if (cached.length > 0) setTrips(cached);
      } finally {
        setIsLoading(false);
      }
    }

    if (!authLoading) fetchTrips();
  }, [user, authLoading, retryCount]);

  const updateVisibility = async (tripId: string, visibility: TripVisibility) => {
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });

      if (!res.ok) throw new Error('Erreur');

      setTrips(prev => prev.map(trip => trip.id === tripId ? { ...trip, visibility } : trip));
      toast.success(t('myTrips.nowVisibility'));
    } catch (error) {
      toast.error(t('myTrips.visibilityError'));
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Premium Header */}
      <div className="relative overflow-hidden pt-16 pb-12">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-[radial-gradient(circle_at_center,rgba(197,160,89,0.05)_0%,transparent_70%)]" />
        <div className="container max-w-6xl mx-auto px-4 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Globe className="h-4 w-4 text-gold" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gold">Votre Patrimoine Voyage</span>
              </div>
              <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground leading-tight">
                Mes <span className="text-gold-gradient italic">Aventures</span>
              </h1>
              <p className="text-muted-foreground mt-4 text-lg max-w-md leading-relaxed">
                Retrouvez tous vos projets, vos souvenirs et vos explorations partagées.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex items-center gap-3"
            >
              <Button variant="outline" className="h-14 rounded-2xl border-gold/20 bg-gold/5 text-gold hover:bg-gold hover:text-white transition-all font-bold text-[10px] uppercase tracking-widest gap-2" asChild>
                <Link href="/journal/new">
                  <Camera className="h-4 w-4" />
                  Journal de bord
                </Link>
              </Button>
              <Button className="h-14 rounded-2xl bg-gold-gradient !text-[#020617] px-8 text-[10px] font-bold uppercase tracking-widest gap-2 shadow-xl shadow-gold/20 hover:scale-105 active:scale-95 transition-all" asChild>
                <Link href="/plan">
                  <Plus className="h-5 w-5" />
                  Nouveau Voyage
                </Link>
              </Button>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="container max-w-6xl mx-auto px-4">
        {isOffline && (
          <div className="mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold uppercase tracking-widest flex items-center gap-3">
            <Globe className="h-4 w-4 animate-pulse" />
            {t('myTrips.offlineNotice')}
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[400px] rounded-[2.5rem] bg-white/5 border border-white/10 animate-pulse" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-2xl mx-auto py-16"
          >
            {/* Welcome hero */}
            <div className="text-center mb-12">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
                className="w-20 h-20 mx-auto rounded-[1.5rem] bg-gold-gradient flex items-center justify-center mb-6 shadow-xl shadow-gold/20"
              >
                <Plane className="h-9 w-9 text-[#020617]" />
              </motion.div>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-3">Bienvenue sur Narae</h2>
              <p className="text-muted-foreground text-lg max-w-md mx-auto">
                Votre premier voyage est à portée de clic. Notre algorithme crée un itinéraire personnalisé en 2 minutes.
              </p>
            </div>

            {/* CTA — Voyage sur mesure */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-center mb-6"
            >
              <Button size="lg" className="h-16 px-12 rounded-2xl bg-gold-gradient !text-[#020617] text-lg font-bold shadow-xl shadow-gold/20 hover:scale-105 active:scale-95 transition-all" asChild>
                <Link href="/plan">
                  <Plus className="h-5 w-5 mr-2" />
                  Créer un voyage sur mesure
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Choisissez destination, durée, budget — itinéraire généré en 2 min
              </p>
            </motion.div>

            {/* Trip templates */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mt-12"
            >
              <TripTemplates title="Ou partez d'une inspiration" maxItems={6} />
            </motion.div>
          </motion.div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip, idx) => {
              const tripData = trip.data as Record<string, unknown>;
              const prefs = (trip.preferences || tripData?.preferences || {}) as Record<string, unknown>;
              const isPastTrip = prefs.tripType === 'past';
              const visibility = (trip as Trip & { visibility?: TripVisibility }).visibility || 'private';
              const visibilityOption = VISIBILITY_OPTIONS.find(o => o.value === visibility) || VISIBILITY_OPTIONS[2];
              const userRole = trip.userRole || 'owner';
              const isInvitedTrip = userRole !== 'owner' || trip.isInvited === true;
              const status = getTripStatus(trip.start_date, trip.duration_days);

              return (
                <motion.div
                  key={trip.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: idx * 0.1 }}
                  className="group relative"
                >
                  <div className="premium-card overflow-hidden h-full flex flex-col rounded-[2.5rem] bg-[#020617] border-white/5 hover:border-gold/30">
                    {/* Visual Header */}
                    <Link href={`/trip/${trip.id}`} className="relative h-56 overflow-hidden">
                      <img
                        src={getDestinationImage(trip.destination)}
                        alt={trip.destination}
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/20 to-transparent" />
                      
                      <div className="absolute top-4 left-4 right-4 flex justify-between items-start">
                        <div className={cn("flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest backdrop-blur-md border border-white/10", status.color)}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", status.dot)} />
                          {status.label}
                        </div>
                        
                        {isInvitedTrip && (
                          <div className="bg-white/10 backdrop-blur-md border border-white/20 px-3 py-1 rounded-full text-[9px] font-bold text-white uppercase tracking-widest">
                            Invité
                          </div>
                        )}
                      </div>

                      <div className="absolute bottom-6 left-6 right-6">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="h-3 w-3 text-gold" />
                          <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/70">{trip.destination}</span>
                        </div>
                        <h3 className="text-white font-display text-2xl font-bold leading-tight group-hover:text-gold transition-colors">{trip.title}</h3>
                      </div>
                    </Link>

                    {/* Meta Content */}
                    <div className="p-6 flex-1 flex flex-col justify-between">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 text-white/90">
                            <Calendar className="h-3.5 w-3.5 text-gold" />
                            <span className="text-sm font-bold">
                              {format(new Date(trip.start_date), 'd MMM yyyy', { locale: dateFnsLocales[locale as keyof typeof dateFnsLocales] || fr })}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1 pl-5">
                            {trip.duration_days} Jours d&apos;évasion
                          </p>
                        </div>

                        {!isPastTrip && !!prefs.groupSize && (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5">
                            <Users className="h-3.5 w-3.5 text-gold" />
                            <span className="text-xs font-bold text-white">{String(prefs.groupSize)}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-6 border-t border-white/5">
                        <div className="flex items-center gap-2">
                          {userRole === 'owner' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-gold transition-all">
                                  {visibilityOption.icon}
                                  {visibilityOption.label}
                                  <ChevronDown className="h-3 w-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="bg-[#020617] border-white/10 rounded-2xl p-2 shadow-2xl">
                                {VISIBILITY_OPTIONS.map((option) => (
                                  <DropdownMenuItem
                                    key={option.value}
                                    onClick={() => updateVisibility(trip.id, option.value)}
                                    className={cn(
                                      'flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all',
                                      visibility === option.value ? 'bg-gold/10 text-gold' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                                    )}
                                  >
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                      {option.icon}
                                    </div>
                                    <div>
                                      <div className="text-[10px] font-bold uppercase tracking-widest">{option.label}</div>
                                      <div className="text-[9px] font-medium opacity-60 mt-0.5">{option.description}</div>
                                    </div>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>

                        <Link href={`/trip/${trip.id}`} className="flex items-center gap-2 group/link">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gold group-hover/link:translate-x-[-4px] transition-transform">Consulter</span>
                          <div className="h-8 w-8 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center text-gold group-hover/link:bg-gold group-hover/link:text-[#020617] transition-all">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </Link>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
