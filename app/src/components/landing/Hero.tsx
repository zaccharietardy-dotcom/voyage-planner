'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, MapPin, ShieldCheck, Sparkles, Star, Utensils, Users2 } from 'lucide-react';
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
    <section className="relative overflow-hidden pt-12 md:pt-16">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0f2744]/5 via-transparent to-[#c9a227]/10" />
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-28 right-[8%] h-72 w-72 rounded-full bg-[#c9a227]/20 blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.4, 0.6, 0.4],
          }}
          transition={{
            duration: 9,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{ willChange: 'transform, opacity' }}
        />
        <motion.div
          className="absolute -bottom-24 left-[6%] h-80 w-80 rounded-full bg-[#1e3a5f]/20 blur-3xl"
          animate={{
            scale: [1, 1.15, 1],
            opacity: [0.35, 0.55, 0.35],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{ willChange: 'transform, opacity' }}
        />
      </div>

      <div className="container relative z-10 mx-auto px-4 pb-16 pt-10 md:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#c9a227]/35 bg-background/75 px-4 py-2 text-sm text-[#1e3a5f] shadow-sm backdrop-blur dark:text-[#f4d03f]">
              <Sparkles className="h-4 w-4" />
              {t('hero.badge')}
            </div>

            <h1 className="font-display text-5xl font-semibold leading-[1.06] tracking-tight md:text-6xl lg:text-7xl">
              {t('hero.title1')}
              <span className="block bg-gradient-to-r from-[#d4a853] via-[#f4d03f] to-[#c08f32] bg-clip-text text-transparent">
                {t('hero.title2')}
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
              {t('hero.subtitle')}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-14 rounded-xl bg-[#102a45] px-8 text-base text-white hover:bg-[#173a5f] dark:bg-[#d4a853] dark:text-[#102a45] dark:hover:bg-[#e8c068]">
                <Link href="/plan">
                  {t('hero.cta')}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-14 rounded-xl border-[#1e3a5f]/25 bg-background/70 px-8 text-base hover:bg-[#1e3a5f]/5">
                <Link href="/explore">{t('hero.ctaSecondary')}</Link>
              </Button>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {trustPoints.map((point) => (
                <span key={point.label} className="inline-flex items-center gap-1.5">
                  <point.icon className="h-4 w-4 text-[#c9a227]" />
                  {point.label}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Product preview mockup — mini trip timeline */}
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="premium-surface premium-ring rounded-3xl p-5 md:p-6"
          >
            {/* Header bar */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Paris &mdash; {t('hero.previewDay')}</p>
                <p className="text-xs text-muted-foreground">3 {t('hero.previewActivities')} &middot; 3 {t('hero.previewRestaurants')}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#d4a853]" />
                <span className="text-xs font-medium text-[#b8923d]">6 {t('hero.previewSteps')}</span>
              </div>
            </div>

            {/* Mini timeline */}
            <div className="relative space-y-1.5">
              {/* Timeline line */}
              <div className="absolute bottom-3 left-[29px] top-3 w-px bg-gradient-to-b from-[#d4a853]/40 via-[#1e3a5f]/20 to-[#d4a853]/40" />

              {mockTimeline.map((item, index) => (
                <motion.div
                  key={item.time}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.25 + index * 0.07 }}
                  className="relative flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-[#1e3a5f]/10 hover:bg-background/80"
                >
                  {/* Time */}
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                    {item.time}
                  </span>

                  {/* Dot */}
                  <span className={`relative z-10 h-2.5 w-2.5 shrink-0 rounded-full ${item.type === 'meal' ? 'bg-[#d4a853]' : 'bg-[#1e3a5f] dark:bg-[#5b9bd5]'}`} />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${typeStyles[item.type]}`}>
                        {item.type === 'meal' ? <Utensils className="h-2.5 w-2.5" /> : <MapPin className="h-2.5 w-2.5" />}
                        {item.label}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Star className="h-2.5 w-2.5 fill-[#d4a853] text-[#d4a853]" />
                        <span className="text-[10px] font-medium text-muted-foreground">{item.rating}</span>
                      </div>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-medium text-foreground">{item.place}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Footer stats */}
            <div className="mt-4 flex items-center justify-between rounded-xl border border-[#1e3a5f]/10 bg-gradient-to-r from-[#1e3a5f]/5 to-[#d4a853]/5 px-4 py-2.5">
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">4.2 km</p>
                <p className="text-[10px] text-muted-foreground">Distance</p>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">~85 &euro;</p>
                <p className="text-[10px] text-muted-foreground">Budget</p>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="text-center">
                <p className="text-xs font-semibold text-foreground">10h30</p>
                <p className="text-[10px] text-muted-foreground">Durée</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
