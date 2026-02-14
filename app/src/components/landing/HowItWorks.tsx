'use client';

import { motion } from 'framer-motion';
import { MapPin, Wand2, Share2 } from 'lucide-react';

const steps = [
  {
    icon: MapPin,
    title: '1. Cadrez votre voyage',
    description: 'Destination, dates, style de séjour et budget. Narae comprend votre intention en quelques champs.',
    accent: 'from-[#1e3a5f] to-[#2f6db3]',
  },
  {
    icon: Wand2,
    title: '2. Génération intelligente',
    description: 'Le moteur V2 crée un planning réaliste avec horaires cohérents, restaurants crédibles et trajets utiles.',
    accent: 'from-[#b8923d] to-[#e8c068]',
  },
  {
    icon: Share2,
    title: '3. Finalisez en équipe',
    description: 'Partage, propositions et validation owner. Votre voyage avance sans chaos ni modifications sauvages.',
    accent: 'from-[#0f7a6a] to-[#2db6a0]',
  },
];

export function HowItWorks() {
  return (
    <section className="relative py-20 md:py-24">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#1e3a5f]/5 via-transparent to-[#d4a853]/5" />
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#b8923d]">Méthode</p>
          <h2 className="font-display mb-4 text-4xl font-semibold md:text-5xl">Un workflow clair, sans friction</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Une expérience premium doit être simple: moins de clics, plus de valeur à chaque étape.
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
              className="relative"
            >
              {index < steps.length - 1 && (
                <div className="absolute right-[-1.3rem] top-12 hidden h-px w-8 bg-gradient-to-r from-[#d4a853]/70 to-transparent md:block" />
              )}

              <div className="premium-surface rounded-3xl p-7">
                <div className={`mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${step.accent}`}>
                  <step.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="mb-3 text-xl font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
