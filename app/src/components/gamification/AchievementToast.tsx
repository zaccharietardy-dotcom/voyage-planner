'use client';

import { toast } from 'sonner';
import { Badge } from '@/lib/constants/badges';
import { motion } from 'framer-motion';
import { Trophy, Sparkles } from 'lucide-react';

// Show achievement toast notification
export function showAchievementToast(badge: Badge) {
  toast.custom(
    (t) => (
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.8 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative bg-gradient-to-br from-yellow-500 to-orange-600 text-white rounded-xl shadow-2xl p-4 pr-12 max-w-md overflow-hidden"
      >
        {/* Shimmer effect */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
          animate={{
            x: ['-100%', '200%'],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'linear',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex items-center gap-4">
          {/* Badge icon */}
          <motion.div
            initial={{ rotate: -180, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-4xl shadow-lg"
          >
            {badge.icon}
          </motion.div>

          {/* Text */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">
                Nouveau badge !
              </span>
            </div>
            <h3 className="font-bold text-lg">{badge.name}</h3>
            <p className="text-sm text-white/90">{badge.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">+{badge.xpReward} XP</span>
            </div>
          </div>
        </div>

        {/* Decorative sparkles */}
        <div className="absolute top-2 right-2">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              rotate: [0, 180, 360],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <Sparkles className="w-5 h-5 text-white/60" />
          </motion.div>
        </div>

        <div className="absolute bottom-2 right-8">
          <motion.div
            animate={{
              scale: [1, 1.3, 1],
              rotate: [0, -180, -360],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <Sparkles className="w-4 h-4 text-white/40" />
          </motion.div>
        </div>
      </motion.div>
    ),
    {
      duration: 5000,
      position: 'top-center',
    }
  );
}

// Show level up toast
export function showLevelUpToast(level: number, title: string) {
  toast.custom(
    (t) => (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-xl shadow-2xl p-4 max-w-md"
      >
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ rotate: -360 }}
            animate={{ rotate: 0 }}
            transition={{ duration: 0.6, type: 'spring' }}
            className="text-5xl"
          >
            ⬆️
          </motion.div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide opacity-90">
              Niveau supérieur !
            </p>
            <h3 className="text-2xl font-bold">Niveau {level}</h3>
            <p className="text-sm opacity-90">{title}</p>
          </div>
        </div>
      </motion.div>
    ),
    {
      duration: 4000,
      position: 'top-center',
    }
  );
}

// Show XP gain toast (subtle)
export function showXpGainToast(xp: number, reason: string) {
  toast.custom(
    (t) => (
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 50 }}
        className="bg-background border-2 border-primary/30 rounded-lg shadow-lg p-3 flex items-center gap-3"
      >
        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-sm">+{xp} XP</p>
          <p className="text-xs text-muted-foreground">{reason}</p>
        </div>
      </motion.div>
    ),
    {
      duration: 3000,
      position: 'bottom-right',
    }
  );
}
