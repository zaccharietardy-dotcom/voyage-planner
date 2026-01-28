'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CTASection() {
  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1e3a5f] to-[#0f2744]" />

      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute top-10 left-10 w-64 h-64 bg-[#c9a227]/10 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute bottom-10 right-10 w-64 h-64 bg-[#f4d03f]/10 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#c9a227]/20 mb-6"
          >
            <Sparkles className="h-8 w-8 text-[#f4d03f]" />
          </motion.div>

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
            Prêt à partir ?
          </h2>

          <p className="text-lg text-white/70 mb-10 max-w-xl mx-auto">
            Rejoignez des milliers de voyageurs qui planifient leurs aventures avec Narae.
            C&apos;est gratuit et ça prend 2 minutes.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              asChild
              size="lg"
              className="h-14 px-8 text-base bg-gradient-to-r from-[#c9a227] to-[#f4d03f] hover:from-[#d4ad32] hover:to-[#f5d54a] text-[#1e3a5f] font-semibold"
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
              className="h-14 px-8 text-base border-white/20 text-white hover:bg-white/10"
            >
              <Link href="/explore">Découvrir les voyages</Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
