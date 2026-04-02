'use client';

import { useAuth } from '@/components/auth';
import { QuickSearch } from '@/components/home/QuickSearch';
import { TravelGuides } from '@/components/home/TravelGuides';
import { MyTrips } from '@/components/home/MyTrips';
import { Footer } from '@/components/layout';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import Link from 'next/link';
import { ArrowRight, Compass, Map, Users2, Star, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { trackEvent } from '@/lib/analytics';

const TESTIMONIALS = [
  {
    name: 'Marie L.',
    trip: 'Rome, 5 jours',
    text: "L'itinéraire était parfait — chaque restaurant était une découverte et les temps de trajet étaient réalistes. On n'a rien eu à modifier.",
  },
  {
    name: 'Thomas & Sarah',
    trip: 'Tokyo, 7 jours',
    text: "On partait en famille avec 2 enfants. Narae a proposé des activités adaptées et des restos kid-friendly. Un gain de temps énorme.",
  },
  {
    name: 'Alexandre D.',
    trip: 'Lisbonne, 3 jours',
    text: "J'ai testé 3 planificateurs avant. Narae est le seul qui donne des horaires d'ouverture corrects et des restaurants à proximité des activités.",
  },
];

function SocialProof() {
  const [stats, setStats] = useState<{ trips: number; users: number; destinations: number } | null>(null);

  useEffect(() => {
    fetch('/api/stats/public')
      .then((r) => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Stats */}
        {stats && (stats.trips > 0 || stats.users > 0) && (
          <div className="grid grid-cols-3 gap-8 mb-20 max-w-2xl mx-auto text-center">
            {[
              { value: stats.trips, label: 'Voyages générés' },
              { value: stats.users, label: 'Voyageurs' },
              { value: stats.destinations, label: 'Destinations' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="text-3xl md:text-4xl font-display font-bold text-gold">
                  {stat.value.toLocaleString('fr-FR')}+
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mt-1">
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Testimonials */}
        <div className="text-center mb-12">
          <h2 className="text-sm uppercase tracking-[0.3em] text-gold font-bold mb-4">Ils nous font confiance</h2>
          <p className="text-3xl md:text-4xl font-display font-bold">Ce qu&apos;en disent nos voyageurs</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
            >
              <Quote className="h-6 w-6 text-gold/30 mb-4" />
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">&quot;{t.text}&quot;</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.trip}</p>
                </div>
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-3.5 w-3.5 fill-gold text-gold" />
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingPage() {
  const [ctaVariant, setCtaVariant] = useState<'default' | 'action'>('default');

  useEffect(() => {
    const stored = document.cookie.match(/narae-cta=(\w+)/)?.[1];
    if (stored === 'action' || stored === 'default') {
      setCtaVariant(stored);
      return;
    }

    const variant = Math.random() > 0.5 ? 'action' : 'default';
    document.cookie = `narae-cta=${variant};path=/;max-age=${60 * 60 * 24 * 30};SameSite=Lax`;
    setCtaVariant(variant);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Hero />

      {/* Value proposition — Enhanced Premium Section */}
      <section className="section-padding relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
        
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-sm uppercase tracking-[0.3em] text-gold font-bold mb-4">
              L&apos;excellence du voyage
            </h2>
            <p className="text-4xl md:text-5xl font-display font-bold leading-tight">
              Une expérience sur-mesure, à chaque étape
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-10 max-w-6xl mx-auto">
            <motion.div 
              whileHover={{ y: -10 }}
              className="premium-card p-10 flex flex-col items-center text-center group"
            >
              <div className="w-20 h-20 rounded-3xl bg-gold/10 flex items-center justify-center mb-8 group-hover:bg-gold-gradient transition-all duration-500">
                <Compass className="h-10 w-10 text-gold group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-2xl font-display font-bold mb-4">Exploration Illimitée</h3>
              <p className="text-muted-foreground leading-relaxed">
                Parcourez des milliers d&apos;itinéraires créés par notre communauté de voyageurs experts. L&apos;inspiration n&apos;a plus de limites.
              </p>
            </motion.div>

            <motion.div 
              whileHover={{ y: -10 }}
              className="premium-card p-10 flex flex-col items-center text-center group border-gold/20 shadow-xl shadow-gold/5"
            >
              <div className="w-20 h-20 rounded-3xl bg-gold/10 flex items-center justify-center mb-8 group-hover:bg-gold-gradient transition-all duration-500">
                <Map className="h-10 w-10 text-gold group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-2xl font-display font-bold mb-4">Adaptation Précise</h3>
              <p className="text-muted-foreground leading-relaxed">
                Personnalisez chaque détail selon vos envies. Narae ajuste les temps de trajet et les réservations en temps réel.
              </p>
            </motion.div>

            <motion.div 
              whileHover={{ y: -10 }}
              className="premium-card p-10 flex flex-col items-center text-center group"
            >
              <div className="w-20 h-20 rounded-3xl bg-gold/10 flex items-center justify-center mb-8 group-hover:bg-gold-gradient transition-all duration-500">
                <Users2 className="h-10 w-10 text-gold group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-2xl font-display font-bold mb-4">Partage Privilégié</h3>
              <p className="text-muted-foreground leading-relaxed">
                Invitez vos proches, collaborez sur l&apos;itinéraire et centralisez tous vos documents de voyage en un seul lieu sécurisé.
              </p>
            </motion.div>
          </div>
          
          <div className="flex justify-center mt-20">
            <Link href="/explore">
              <Button size="lg" className="h-14 gap-3 rounded-full px-10 bg-gold-gradient text-white font-bold shadow-lg shadow-gold/20 transition-all hover:scale-105 active:scale-95">
                Découvrir les horizons
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <SocialProof />

      {/* CTA Section - Dark & Gold */}
      <section className="py-24 bg-[#020617] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(197,160,89,0.1),transparent_50%)]" />
        <div className="container mx-auto px-4 relative z-10 text-center max-w-4xl">
          <h2 className="text-4xl md:text-6xl font-display font-bold mb-8">
            Prêt pour votre prochaine <span className="text-gold-gradient italic">aventure ?</span>
          </h2>
          <p className="text-xl text-slate-400 mb-12 leading-relaxed">
            Rejoignez des milliers de voyageurs qui font confiance à Narae pour planifier des moments inoubliables.
          </p>
          <Link href="/register">
            <Button
              size="lg"
              className="h-16 rounded-2xl bg-white text-[#020617] px-12 text-lg font-bold hover:bg-gold-light transition-all shadow-2xl"
              onClick={() => trackEvent('landing_cta_click', { variant: ctaVariant })}
            >
              {ctaVariant === 'action' ? 'Planifier mon voyage' : 'Commencer gratuitement'}
            </Button>
          </Link>
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
