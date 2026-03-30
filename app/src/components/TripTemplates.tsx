'use client';

import { TRIP_TEMPLATES, buildTemplatePreferences, type TripTemplate } from '@/lib/tripTemplates';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles, Calendar } from 'lucide-react';

interface TripTemplatesProps {
  title?: string;
  maxItems?: number;
  className?: string;
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffDays = Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return 'Ce week-end';
  if (diffDays <= 14) return 'Dans 2 semaines';
  if (diffDays <= 21) return 'Dans 3 semaines';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function TripTemplates({ title = 'Inspirations populaires', maxItems = 6, className }: TripTemplatesProps) {
  const router = useRouter();

  const handleSelect = (template: TripTemplate) => {
    const prefs = buildTemplatePreferences(template);
    sessionStorage.setItem('narae-template', JSON.stringify(prefs));
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
        {templates.map((t, i) => {
          const prefs = buildTemplatePreferences(t);
          const dateLabel = prefs.startDate ? formatRelativeDate(prefs.startDate as Date) : '';

          return (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => handleSelect(t)}
              className="group relative overflow-hidden rounded-2xl border border-white/10 hover:border-gold/30 transition-all text-left"
            >
              <div className="relative h-32">
                <img
                  src={t.image}
                  alt={t.title}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/50 to-transparent" />
                <div className="absolute top-2 left-2 text-xl">{t.emoji}</div>
                {/* Date badge */}
                {dateLabel && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/50 backdrop-blur-sm text-white/90 text-[9px] font-bold px-2 py-1 rounded-md">
                    <Calendar className="h-2.5 w-2.5" />
                    {dateLabel}
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-bold group-hover:text-gold transition-colors">{t.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{t.subtitle}</p>
                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {t.tags.map((tag) => (
                    <span key={tag} className="text-[9px] font-bold text-gold/70 bg-gold/10 px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="h-4 w-4 text-gold" />
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
