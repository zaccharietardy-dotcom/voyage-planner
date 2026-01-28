'use client';

import { motion } from 'framer-motion';
import { Sparkles, Users, Utensils, Leaf, FileDown, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: Sparkles,
    title: 'IA Intelligente',
    description: 'Génération d\'itinéraires personnalisés en quelques secondes grâce à l\'intelligence artificielle.',
    color: 'bg-purple-500/10 text-purple-500',
  },
  {
    icon: Users,
    title: 'Collaboration',
    description: 'Planifiez à plusieurs, votez sur les activités et créez ensemble le voyage parfait.',
    color: 'bg-blue-500/10 text-blue-500',
  },
  {
    icon: Utensils,
    title: 'Restaurants Authentiques',
    description: 'Découvrez des adresses locales recommandées, loin des chaînes et pièges à touristes.',
    color: 'bg-orange-500/10 text-orange-500',
  },
  {
    icon: Leaf,
    title: 'Éco-responsable',
    description: 'Calculez l\'empreinte carbone de votre voyage et faites des choix éclairés.',
    color: 'bg-green-500/10 text-green-500',
  },
  {
    icon: FileDown,
    title: 'Export PDF',
    description: 'Téléchargez votre itinéraire complet en PDF pour l\'avoir toujours avec vous.',
    color: 'bg-red-500/10 text-red-500',
  },
  {
    icon: Globe,
    title: 'Partage Social',
    description: 'Partagez vos aventures, découvrez les voyages des autres et inspirez-vous.',
    color: 'bg-cyan-500/10 text-cyan-500',
  },
];

export function Features() {
  return (
    <section id="features" className="py-20">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Tout ce qu&apos;il faut pour voyager sereinement
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Des outils puissants pour planifier, organiser et profiter de chaque instant
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-md transition-shadow border-border/50">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
