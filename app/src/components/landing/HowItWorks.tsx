'use client';

import { motion } from 'framer-motion';
import { MapPin, Wand2, Share2 } from 'lucide-react';

const steps = [
  {
    icon: MapPin,
    title: 'Dis-nous ta destination',
    description: 'Choisis où tu veux aller, tes dates et tes préférences de voyage.',
    color: 'from-blue-500 to-blue-600',
  },
  {
    icon: Wand2,
    title: 'L\'IA génère ton itinéraire',
    description: 'En quelques secondes, obtiens un planning jour par jour personnalisé.',
    color: 'from-[#c9a227] to-[#f4d03f]',
  },
  {
    icon: Share2,
    title: 'Personnalise et partage',
    description: 'Ajuste ton voyage, invite tes amis et partez à l\'aventure !',
    color: 'from-green-500 to-green-600',
  },
];

export function HowItWorks() {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Comment ça marche ?</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Trois étapes simples pour créer le voyage parfait
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {steps.map((step, index) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative"
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-1/2 w-full h-0.5 bg-gradient-to-r from-border to-border/50" />
              )}

              <div className="relative bg-background rounded-2xl p-8 shadow-sm border hover:shadow-md transition-shadow">
                {/* Step number */}
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                  {index + 1}
                </div>

                {/* Icon */}
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-6`}>
                  <step.icon className="h-8 w-8 text-white" />
                </div>

                <h3 className="text-xl font-semibold mb-3">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
