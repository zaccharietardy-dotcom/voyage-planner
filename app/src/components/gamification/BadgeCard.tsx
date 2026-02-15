'use client';

import { Badge, TIER_COLORS } from '@/lib/constants/badges';
import { motion } from 'framer-motion';
import { Lock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface BadgeCardProps {
  badge: Badge;
  isEarned: boolean;
  earnedAt?: Date;
  progress?: number; // 0-100
  showProgress?: boolean;
  className?: string;
}

export function BadgeCard({
  badge,
  isEarned,
  earnedAt,
  progress = 0,
  showProgress = false,
  className,
}: BadgeCardProps) {
  const colors = TIER_COLORS[badge.tier];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: isEarned ? 1.05 : 1.02 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'relative p-4 rounded-xl border-2 transition-all duration-300',
        isEarned
          ? `${colors.bg} ${colors.border} shadow-lg ${colors.glow}`
          : 'bg-muted/30 border-muted-foreground/20 opacity-60',
        className
      )}
    >
      {/* Badge icon */}
      <div className="flex flex-col items-center gap-2">
        <div
          className={cn(
            'relative w-16 h-16 rounded-full flex items-center justify-center text-4xl transition-all',
            isEarned ? 'bg-white/10 backdrop-blur-sm' : 'bg-muted/50 grayscale'
          )}
        >
          <span>{badge.icon}</span>
          {!isEarned && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full backdrop-blur-sm">
              <Lock className="w-6 h-6 text-white" />
            </div>
          )}
          {isEarned && (
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center border-2 border-background"
            >
              <Check className="w-4 h-4 text-white" />
            </motion.div>
          )}
        </div>

        {/* Badge name */}
        <h3
          className={cn(
            'font-bold text-center text-sm',
            isEarned ? colors.text : 'text-muted-foreground'
          )}
        >
          {badge.name}
        </h3>

        {/* Tier indicator */}
        <div
          className={cn(
            'text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold',
            isEarned
              ? `${colors.text} bg-white/10`
              : 'text-muted-foreground bg-muted/50'
          )}
        >
          {badge.tier}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-center text-muted-foreground mt-2 min-h-[32px]">
        {badge.description}
      </p>

      {/* Progress bar (if not earned and showProgress) */}
      {!isEarned && showProgress && progress > 0 && (
        <div className="mt-3">
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className={cn('h-full rounded-full', colors.text.replace('text-', 'bg-'))}
            />
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1">
            {progress}%
          </p>
        </div>
      )}

      {/* Earned date */}
      {isEarned && earnedAt && (
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          Obtenu le {format(earnedAt, 'd MMM yyyy', { locale: fr })}
        </p>
      )}

      {/* XP reward */}
      <div className="absolute top-2 right-2">
        <div
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded',
            isEarned
              ? 'bg-white/20 text-foreground'
              : 'bg-muted/50 text-muted-foreground'
          )}
        >
          +{badge.xpReward} XP
        </div>
      </div>

      {/* Glow effect for newly earned badges */}
      {isEarned && earnedAt && Date.now() - earnedAt.getTime() < 10000 && (
        <motion.div
          className={cn(
            'absolute inset-0 rounded-xl pointer-events-none',
            colors.glow
          )}
          animate={{
            opacity: [0.5, 0, 0.5],
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.div>
  );
}
