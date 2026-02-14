'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, ShieldCheck, Sparkles, Users2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const trustPoints = [
  { icon: Clock3, label: 'Plan en 2 min' },
  { icon: Users2, label: 'Mode collaboratif' },
  { icon: ShieldCheck, label: 'Liens fiables' },
];

const stats = [
  { value: '120k+', label: 'itinéraires créés' },
  { value: '4.8/5', label: 'note moyenne' },
  { value: '78%', label: 'temps gagné' },
];

export function Hero() {
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
              Planification IA haut de gamme, en français
            </div>

            <h1 className="font-display text-5xl font-semibold leading-[1.06] tracking-tight md:text-6xl lg:text-7xl">
              Ton agence de voyage
              <span className="block bg-gradient-to-r from-[#d4a853] via-[#f4d03f] to-[#c08f32] bg-clip-text text-transparent">
                personnelle et premium
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
              Narae compose un itinéraire précis, élégant et collaboratif:
              horaires réalistes, adresses de qualité, et réservations prêtes à ouvrir.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-14 rounded-xl bg-[#102a45] px-8 text-base text-white hover:bg-[#173a5f] dark:bg-[#d4a853] dark:text-[#102a45] dark:hover:bg-[#e8c068]">
                <Link href="/plan">
                  Créer mon voyage
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-14 rounded-xl border-[#1e3a5f]/25 bg-background/70 px-8 text-base hover:bg-[#1e3a5f]/5">
                <Link href="/explore">Voir des exemples</Link>
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

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="premium-surface premium-ring rounded-3xl p-6 md:p-8"
          >
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.18em] text-muted-foreground">
                Expérience Premium
              </p>
              <div className="rounded-full border border-[#c9a227]/40 bg-[#c9a227]/10 px-3 py-1 text-xs font-medium text-[#b8923d]">
                Version V2
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.2 + index * 0.08 }}
                  className="rounded-2xl border border-white/40 bg-background/70 p-4 text-center dark:border-white/10"
                >
                  <p className="font-display text-3xl font-semibold text-[#102a45] dark:text-[#f4d03f]">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
                </motion.div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-[#1e3a5f]/20 bg-gradient-to-r from-[#1e3a5f]/10 to-[#d4a853]/10 p-4 text-sm text-muted-foreground">
              Chaque itinéraire inclut activités, restaurants, transports, budget et partage collaboratif.
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
