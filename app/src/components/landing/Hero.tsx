'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, MapPin, ShieldCheck, Compass, Star, Utensils, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

// Mini timeline items for the product preview mockup
const mockTimeline = [
  { time: '09:00', label: 'Petit-déjeuner', place: 'Café de Flore', type: 'meal' as const, rating: 4.5 },
  { time: '10:30', label: 'Visite', place: 'Musée du Louvre', type: 'activity' as const, rating: 4.8 },
  { time: '13:00', label: 'Déjeuner', place: 'Le Bouillon Chartier', type: 'meal' as const, rating: 4.3 },
  { time: '14:45', label: 'Promenade', place: 'Jardin des Tuileries', type: 'activity' as const, rating: 4.6 },
  { time: '16:30', label: 'Visite', place: 'Tour Eiffel', type: 'activity' as const, rating: 4.7 },
  { time: '19:30', label: 'Dîner', place: 'Le Comptoir du Panthéon', type: 'meal' as const, rating: 4.4 },
];

const typeStyles = {
  meal: 'bg-[#d4a853]/15 text-[#b8923d] dark:bg-[#d4a853]/20',
  activity: 'bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-[#1e3a5f]/25 dark:text-[#9bc4f4]',
};

export function Hero() {
  const { t } = useTranslation();

  const trustPoints = [
    { icon: Clock3, label: t('hero.trustPlan') },
    { icon: Users2, label: t('hero.trustSocial') },
    { icon: ShieldCheck, label: t('hero.trustLinks') },
  ];

  return (
    <section className="relative overflow-hidden pt-20 md:pt-28 pb-16 md:pb-24">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-[radial-gradient(circle_at_center,rgba(197,160,89,0.08)_0%,transparent_70%)]" />
        <motion.div
          className="absolute -top-40 -right-20 h-[500px] w-[500px] rounded-full bg-[#c5a059]/10 blur-[100px]"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 -left-20 h-[400px] w-[400px] rounded-full bg-[#0f172a]/5 blur-[100px] dark:bg-[#c5a059]/5"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="container relative z-10 mx-auto px-4">
        <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-white/50 dark:bg-white/5 px-4 py-1.5 text-sm font-medium text-gold-dark backdrop-blur-md shadow-sm"
            >
              <Compass className="h-4 w-4" />
              <span className="tracking-wide uppercase text-[10px]">{t('hero.badge')}</span>
            </motion.div>

            <h1 className="font-display text-5xl font-bold leading-[1.1] tracking-tight md:text-7xl lg:text-8xl">
              {t('hero.title1')}{" "}
              <span className="text-gold-gradient block mt-1">
                {t('hero.title2')}
              </span>
            </h1>

            <p className="mt-8 max-w-xl text-lg text-muted-foreground/90 md:text-xl leading-relaxed">
              {t('hero.subtitle')}
            </p>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Button asChild size="lg" className="h-16 rounded-2xl bg-gold-gradient px-10 text-base font-semibold text-white shadow-xl shadow-gold/20 hover:scale-[1.02] transition-all active:scale-[0.98]">
                <Link href="/plan">
                  {t('hero.cta')}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-16 rounded-2xl border-gold/30 bg-white/10 dark:bg-white/5 px-10 text-base font-medium backdrop-blur-md hover:bg-gold/5 hover:border-gold/50 transition-all">
                <Link href="/explore">{t('hero.ctaSecondary')}</Link>
              </Button>
            </div>

            <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
              {trustPoints.map((point) => (
                <span key={point.label} className="inline-flex items-center gap-2">
                  <point.icon className="h-4 w-4 text-gold" />
                  {point.label}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* Main Mockup */}
            <div className="premium-surface rounded-[40px] p-1 shadow-2xl overflow-hidden relative group">
              <div className="bg-white dark:bg-card rounded-[38px] p-6 md:p-8">
                {/* Header bar */}
                <div className="mb-8 flex items-center justify-between border-b border-border/50 pb-6">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold mb-1">Itinéraire Premium</p>
                    <h3 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
                      Paris &mdash; {t('hero.previewDay')}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gold/10 flex items-center justify-center">
                      <MapPin className="h-5 w-5 text-gold" />
                    </div>
                  </div>
                </div>

                {/* Mini timeline */}
                <div className="relative space-y-4">
                  {/* Timeline line */}
                  <div className="absolute bottom-4 left-[34px] top-4 w-[2px] bg-gradient-to-b from-gold/50 via-border/50 to-gold/50" />

                  {mockTimeline.slice(0, 5).map((item, index) => (
                    <motion.div
                      key={item.time}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                      className="relative flex items-center gap-5 group/item cursor-default"
                    >
                      <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground/60 tracking-tighter">
                        {item.time}
                      </span>

                      <div className={`relative z-10 h-4 w-4 shrink-0 rounded-full border-2 border-background shadow-sm transition-transform group-hover/item:scale-125 ${item.type === 'meal' ? 'bg-gold' : 'bg-[#0f172a]'}`} />

                      <div className="flex-1 rounded-2xl border border-transparent p-3 transition-all group-hover/item:border-gold/20 group-hover/item:bg-gold/5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-foreground tracking-tight">{item.place}</p>
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 fill-gold text-gold" />
                            <span className="text-[10px] font-bold text-muted-foreground">{item.rating}</span>
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{item.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Footer stats */}
                <div className="mt-8 grid grid-cols-3 gap-4 rounded-2xl bg-muted/30 p-4 border border-border/50">
                  <div className="text-center">
                    <p className="text-sm font-bold text-foreground">4.2 km</p>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground/60">Distance</p>
                  </div>
                  <div className="text-center border-x border-border/50">
                    <p className="text-sm font-bold text-foreground">~85 &euro;</p>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground/60">Budget</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-foreground">10h30</p>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground/60">Durée</p>
                  </div>
                </div>
              </div>

              {/* Decorative elements */}
              <div className="absolute top-1/2 -right-4 w-24 h-24 bg-gold/10 blur-2xl rounded-full" />
              <div className="absolute -bottom-4 left-1/4 w-32 h-32 bg-gold/5 blur-3xl rounded-full" />
            </div>
            
            {/* Floating Badge */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -top-6 -right-6 md:-right-10 bg-white dark:bg-card border border-gold/20 p-4 rounded-2xl shadow-2xl z-20 hidden sm:block"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-widest">Optimisation Experte</p>
                  <p className="text-xs font-bold">Vérifié à 100%</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

