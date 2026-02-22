'use client';

import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useTranslation } from '@/lib/i18n';

const testimonials = [
  {
    name: 'Marie L.',
    initials: 'ML',
    color: 'bg-[#1e3a5f] text-white',
    rating: 5,
    text: "J'ai planifié mon voyage au Japon en 10 minutes. L'itinéraire était cohérent et les restaurants vraiment solides.",
    trip: 'Tokyo, 10 jours',
  },
  {
    name: 'Thomas B.',
    initials: 'TB',
    color: 'bg-[#d4a853] text-[#102a45]',
    rating: 5,
    text: 'Le mode collaboratif est net: chacun propose, on vote, et la décision owner reste claire.',
    trip: 'Barcelone, 4 jours',
  },
  {
    name: 'Sophie M.',
    initials: 'SM',
    color: 'bg-[#0f7a6a] text-white',
    rating: 5,
    text: 'Les recommandations collent à mon profil. Je gagne du temps sans sacrifier la qualité du voyage.',
    trip: 'Lisbonne, 5 jours',
  },
];

export function Testimonials() {
  const { t } = useTranslation();

  return (
    <section className="relative py-20 md:py-24">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <p className="mb-3 text-xs uppercase tracking-[0.22em] text-[#b8923d]">{t('testimonials.badge')}</p>
          <h2 className="font-display mb-4 text-3xl font-semibold md:text-4xl">{t('testimonials.title')}</h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            {t('testimonials.subtitle')}
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: index * 0.08 }}
            >
              <Card className="premium-surface h-full border-0 p-0">
                <CardContent className="p-6">
                  <Quote className="mb-4 h-8 w-8 text-[#d4a853]/40" />
                  <div className="mb-4 flex gap-1">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star key={`${testimonial.name}-${i}`} className="h-4 w-4 fill-[#f4d03f] text-[#f4d03f]" />
                    ))}
                  </div>
                  <p className="mb-6 text-sm leading-relaxed text-muted-foreground">&ldquo;{testimonial.text}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-[#d4a853]/30">
                      <AvatarFallback className={`text-xs font-semibold ${testimonial.color}`}>
                        {testimonial.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-semibold">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.trip}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
