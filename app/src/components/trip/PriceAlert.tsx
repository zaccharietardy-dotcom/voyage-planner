'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingDown, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface PriceAlertProps {
  savingsPercent: number;
  savingsAmount: number;
  platform: string;
  platformUrl?: string;
  onDismiss?: () => void;
  onViewComparison?: () => void;
}

export function PriceAlert({
  savingsPercent,
  savingsAmount,
  platform,
  platformUrl,
  onDismiss,
  onViewComparison,
}: PriceAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -10, height: 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
        <div
          className={cn(
            'relative rounded-lg p-3 mb-2',
            'bg-gradient-to-r from-emerald-500/10 to-emerald-500/5',
            'border border-emerald-500/20',
            'shadow-sm'
          )}
        >
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div className="flex-shrink-0">
              <div className="p-1.5 rounded-full bg-emerald-500/20">
                <TrendingDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0">
                  Prix trouvé {savingsPercent}% moins cher
                </Badge>
              </div>
              <p className="text-sm font-medium text-foreground">
                Économisez {savingsAmount}€ sur {platform}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {platformUrl && (
                <a
                  href={platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex items-center gap-1 px-3 py-1.5 rounded-md',
                    'bg-emerald-500 text-white text-xs font-medium',
                    'hover:bg-emerald-600 transition-colors'
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  Voir l'offre
                </a>
              )}

              {onViewComparison && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onViewComparison}
                  className="text-xs h-7 px-2"
                >
                  Comparer
                </Button>
              )}

              {onDismiss && (
                <button
                  onClick={handleDismiss}
                  className={cn(
                    'p-1 rounded-md',
                    'text-muted-foreground hover:text-foreground',
                    'hover:bg-muted transition-colors'
                  )}
                  title="Fermer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
