'use client';

import { motion } from 'framer-motion';
import { Zap, Users, Utensils, Leaf, FileDown, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: Zap,
    title: 'Planification rapide',
    description: 'Créez votre itinéraire personnalisé en quelques minutes avec tous les détails pratiques.',
    color: 'from-[#1e3a5f]/15 to-[#1e3a5f]/5 text-[#1e3a5f] dark:text-[#9bc4f4]',
  },
  {
    icon: Users,
    title: 'Collaboration',
    description: 'Planifiez à plusieurs, votez sur les activités et créez ensemble le voyage parfait.',
    color: 'from-[#0f7a6a]/15 to-[#0f7a6a]/5 text-[#0f7a6a] dark:text-[#71d2bd]',
  },
  {
    icon: Utensils,
    title: 'Restaurants Authentiques',
    description: 'Découvrez des adresses locales recommandées, loin des chaînes et pièges à touristes.',
    color: 'from-[#d2833f]/15 to-[#d2833f]/5 text-[#d2833f] dark:text-[#f2be8b]',
  },
  {
    icon: Leaf,
    title: 'Éco-responsable',
    description: 'Calculez l\'empreinte carbone de votre voyage et faites des choix éclairés.',
    color: 'from-[#2f8f53]/15 to-[#2f8f53]/5 text-[#2f8f53] dark:text-[#9cdbb2]',
  },
  {
    icon: FileDown,
    title: 'Export PDF',
    description: 'Téléchargez votre itinéraire complet en PDF pour l\'avoir toujours avec vous.',
    color: 'from-[#a64f45]/15 to-[#a64f45]/5 text-[#a64f45] dark:text-[#eab0a8]',
  },
  {
    icon: Globe,
    title: 'Partage Social',
    description: 'Suivez des profils, commentez les itinéraires et transformez l’inspiration en plans concrets.',
    color: 'from-[#257e9f]/15 to-[#257e9f]/5 text-[#257e9f] dark:text-[#8bcde6]',
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-20 md:py-24">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-[#1e3a5f]/5 to-transparent" />
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#b8923d]">
            Stack Voyage Premium
          </p>
          <h2 className="font-display mb-4 text-4xl font-semibold md:text-5xl">
            Tout ce qu&apos;il faut pour voyager sereinement
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Des outils puissants pour planifier, organiser et profiter de chaque instant
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="premium-surface premium-ring h-full border-0 p-0 transition-all hover:-translate-y-1 hover:shadow-2xl">
                <CardContent className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${feature.color}`}>
                      <feature.icon className="h-6 w-6" />
                    </div>
                    <span className="font-display text-3xl leading-none text-[#d4a853]/55">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                  <div className="mt-6 h-px w-full bg-gradient-to-r from-[#d4a853]/30 via-[#1e3a5f]/20 to-transparent" />
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
