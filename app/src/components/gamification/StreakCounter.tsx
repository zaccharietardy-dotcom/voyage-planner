'use client';

import { motion } from 'framer-motion';
import { Flame, Award } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreakCounterProps {
  currentStreak: number;
  longestStreak: number;
  recentDays?: boolean[]; // Last 7 days (true = active)
  className?: string;
}

export function StreakCounter({
  currentStreak,
  longestStreak,
  recentDays = [true, true, false, true, true, true, true],
  className,
}: StreakCounterProps) {
  const isOnFire = currentStreak >= 3;

  return (
    <div className={cn('bg-gradient-to-br from-orange-500/10 to-red-500/10 rounded-xl p-4 border border-orange-500/20', className)}>
      {/* Current streak */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <motion.div
            animate={isOnFire ? {
              scale: [1, 1.2, 1],
              rotate: [0, 5, -5, 0],
            } : {}}
            transition={{
              duration: 0.5,
              repeat: isOnFire ? Infinity : 0,
              repeatDelay: 1,
            }}
          >
            <Flame className={cn(
              'w-8 h-8',
              isOnFire ? 'text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 'text-muted-foreground'
            )} />
          </motion.div>

          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{currentStreak}</span>
              <span className="text-sm text-muted-foreground">jours</span>
            </div>
            <p className="text-xs text-muted-foreground">Série en cours</p>
          </div>
        </div>

        {/* Longest streak record */}
        <div className="text-right">
          <div className="flex items-center gap-1 justify-end text-sm text-muted-foreground">
            <Award className="w-3.5 h-3.5" />
            <span>Record</span>
          </div>
          <p className="text-xl font-bold text-orange-600 dark:text-orange-400">
            {longestStreak}
          </p>
        </div>
      </div>

      {/* Weekly calendar dots */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">7 derniers jours</p>
        <div className="flex justify-between gap-1">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => {
            const isActive = recentDays[index];
            return (
              <div key={index} className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{day}</span>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center transition-all',
                    isActive
                      ? 'bg-gradient-to-br from-orange-500 to-red-500 shadow-md shadow-orange-500/30'
                      : 'bg-muted border border-muted-foreground/20'
                  )}
                >
                  {isActive && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: index * 0.05 + 0.2 }}
                    >
                      <Flame className="w-3 h-3 text-white" />
                    </motion.div>
                  )}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Motivational message */}
      {currentStreak > 0 && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-center text-muted-foreground mt-3 pt-3 border-t border-orange-500/20"
        >
          {currentStreak === 1 && "C'est parti ! Continue demain 🚀"}
          {currentStreak >= 2 && currentStreak < 5 && "Tu prends de l'élan ! 💪"}
          {currentStreak >= 5 && currentStreak < 7 && "Impressionnant ! Continue comme ça 🔥"}
          {currentStreak >= 7 && currentStreak < 14 && "Une semaine ! Tu es incroyable 🌟"}
          {currentStreak >= 14 && currentStreak < 30 && "Série légendaire ! 🏆"}
          {currentStreak >= 30 && "Maître de la constance ! 👑"}
        </motion.p>
      )}
    </div>
  );
}
