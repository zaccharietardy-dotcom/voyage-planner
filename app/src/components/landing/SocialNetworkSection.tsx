'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { BadgeCheck, Heart, MessageCircle, Rocket, Share2, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const socialPillars = [
  {
    icon: UserPlus,
    title: 'Suivre des voyageurs',
    description: 'Découvre les profils qui partagent ton style et construis ton réseau.',
    color: 'from-[#1e3a5f]/20 to-[#1e3a5f]/5 text-[#1e3a5f] dark:text-[#9bc4f4]',
  },
  {
    icon: Share2,
    title: 'Publier tes itinéraires',
    description: 'Expose tes meilleurs voyages et inspire la communauté avec du concret.',
    color: 'from-[#b8923d]/20 to-[#b8923d]/5 text-[#b8923d] dark:text-[#f4d03f]',
  },
  {
    icon: MessageCircle,
    title: 'Échanger en direct',
    description: 'Passe de l’inspiration à la discussion en quelques secondes.',
    color: 'from-[#0f7a6a]/20 to-[#0f7a6a]/5 text-[#0f7a6a] dark:text-[#78d6c3]',
  },
];

const socialFlow = [
  { icon: Users, label: 'Créer ton cercle' },
  { icon: Heart, label: 'Aimer et suivre' },
  { icon: BadgeCheck, label: 'Proposer et voter' },
  { icon: Rocket, label: 'Partir ensemble' },
];

export function SocialNetworkSection() {
  return (
    <section className="relative py-20 md:py-24">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0f2744]/5 via-transparent to-[#0f7a6a]/5" />
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#b8923d]">Réseau social voyage</p>
          <h2 className="font-display mb-4 text-4xl font-semibold md:text-5xl">
            Narae n’est pas qu’un planificateur
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Tu peux suivre, discuter, proposer et co-construire des voyages avec une logique claire.
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {socialPillars.map((pillar, index) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: index * 0.08 }}
              >
                <Card className="premium-surface premium-ring h-full border-0 p-0">
                  <CardContent className="p-6">
                    <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${pillar.color}`}>
                      <pillar.icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">{pillar.title}</h3>
                    <p className="text-sm text-muted-foreground">{pillar.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="premium-surface rounded-3xl border-0 p-6 md:p-7"
          >
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">Workflow social</p>
            <div className="space-y-3">
              {socialFlow.map((step) => (
                <div key={step.label} className="flex items-center gap-3 rounded-xl border border-[#1e3a5f]/12 bg-background/70 px-3 py-2.5">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#102a45] text-white dark:bg-[#d4a853] dark:text-[#102a45]">
                    <step.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button asChild className="h-11 rounded-xl bg-[#102a45] text-white hover:bg-[#173a5f] dark:bg-[#d4a853] dark:text-[#102a45] dark:hover:bg-[#e8c068]">
                <Link href="/community">Voir la communauté</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-xl border-[#1e3a5f]/20 bg-background/60 hover:bg-[#1e3a5f]/5">
                <Link href="/messages">Ouvrir les messages</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
