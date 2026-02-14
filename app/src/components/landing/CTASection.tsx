'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const bulletPoints = [
  'Génération V2 stable',
  'Collaboration propriétaire',
  'Réservations prêtes à l\'emploi',
];

export function CTASection() {
  return (
    <section className="relative overflow-hidden px-4 py-20 md:py-24">
      <div className="absolute inset-0 -z-20 bg-gradient-to-b from-transparent via-[#102a45] to-[#08182b]" />
      <motion.div
        className="absolute -left-20 top-16 -z-10 h-80 w-80 rounded-full bg-[#d4a853]/20 blur-3xl"
        animate={{ opacity: [0.3, 0.5, 0.3], scale: [1, 1.2, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-24 right-[-5%] -z-10 h-96 w-96 rounded-full bg-[#1d4c7e]/30 blur-3xl"
        animate={{ opacity: [0.25, 0.45, 0.25], scale: [1.1, 1, 1.1] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl border border-white/15 bg-white/5 p-8 text-white backdrop-blur-xl md:p-12">
          <div className="grid items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#e8c068]/40 bg-[#e8c068]/15 px-4 py-2 text-xs uppercase tracking-[0.14em] text-[#f8e3b2]">
                <Sparkles className="h-4 w-4" />
                Prêt pour la version premium
              </div>

              <h2 className="font-display text-4xl font-semibold leading-tight md:text-5xl">
                Passez de l&apos;idée au départ
                <span className="block text-[#f4d03f]">sans perte de temps</span>
              </h2>

              <p className="mt-5 max-w-xl text-lg text-white/80">
                Lance ton prochain itinéraire avec un rendu propre, des décisions collaboratives cadrées, et des liens d&apos;action fiables.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="h-14 rounded-xl bg-gradient-to-r from-[#d4a853] to-[#f4d03f] px-8 text-base font-semibold text-[#102a45] hover:from-[#e1ba62] hover:to-[#f8de7a]"
                >
                  <Link href="/plan">
                    Créer mon premier voyage
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-14 rounded-xl border-white/30 bg-transparent px-8 text-base text-white hover:bg-white/10"
                >
                  <Link href="/pricing">Voir les offres</Link>
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="rounded-2xl border border-white/20 bg-[#0b1d31]/70 p-6"
            >
              <p className="mb-5 text-sm uppercase tracking-[0.18em] text-white/65">Inclus dès maintenant</p>
              <ul className="space-y-4">
                {bulletPoints.map((point) => (
                  <li key={point} className="flex items-center gap-3 text-sm text-white/85">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#f4d03f]" />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-8 rounded-xl border border-[#f4d03f]/30 bg-[#f4d03f]/10 p-4 text-sm text-[#f8e3b2]">
                Active en moins de 2 minutes. Aucune configuration complexe.
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
