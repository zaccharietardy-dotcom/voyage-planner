'use client';

import { TRIP_TEMPLATES, type TripTemplate } from '@/lib/tripTemplates';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

interface TripTemplatesProps {
  title?: string;
  maxItems?: number;
  className?: string;
}

export function TripTemplates({ title = 'Inspirations populaires', maxItems = 6, className }: TripTemplatesProps) {
  const router = useRouter();

  const handleSelect = (template: TripTemplate) => {
    // Store template preferences and redirect to plan page
    sessionStorage.setItem('narae-template', JSON.stringify(template.preferences));
    router.push('/plan?template=' + template.id);
  };

  const templates = TRIP_TEMPLATES.slice(0, maxItems);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-gold">{title}</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {templates.map((t, i) => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            onClick={() => handleSelect(t)}
            className="group relative overflow-hidden rounded-2xl border border-white/10 hover:border-gold/30 transition-all text-left"
          >
            <div className="relative h-28">
              <img
                src={t.image}
                alt={t.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/40 to-transparent" />
              <div className="absolute top-2 left-2 text-xl">{t.emoji}</div>
            </div>
            <div className="p-3">
              <p className="text-sm font-bold group-hover:text-gold transition-colors">{t.title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t.subtitle}</p>
            </div>
            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <ArrowRight className="h-4 w-4 text-gold" />
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
