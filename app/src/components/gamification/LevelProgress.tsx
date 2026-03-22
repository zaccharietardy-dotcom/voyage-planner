'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserLevel, calculateUserLevel } from '@/lib/services/gamificationService';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LevelProgressProps {
  totalXp: number;
  className?: string;
  showAnimation?: boolean;
}

export function LevelProgress({ totalXp, className, showAnimation = true }: LevelProgressProps) {
  const [displayXp, setDisplayXp] = useState(0);
  const [levelData, setLevelData] = useState<UserLevel>(calculateUserLevel(0));
  const [showLevelUp, setShowLevelUp] = useState(false);

  useEffect(() => {
    if (!showAnimation) {
      setDisplayXp(totalXp);
      setLevelData(calculateUserLevel(totalXp));
      return;
    }

    // Animated XP gain
    const duration = 1500;
    const steps = 60;
    const increment = totalXp / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentStep++;
      const newXp = Math.min(totalXp, currentStep * increment);
      setDisplayXp(Math.floor(newXp));

      const newLevelData = calculateUserLevel(Math.floor(newXp));
      const oldLevel = levelData.level;

      setLevelData(newLevelData);

      // Level up celebration
      if (newLevelData.level > oldLevel && showAnimation) {
        setShowLevelUp(true);
        triggerLevelUpAnimation();
        setTimeout(() => setShowLevelUp(false), 3000);
      }

      if (currentStep >= steps) {
        clearInterval(interval);
      }
    }, duration / steps);

    return () => clearInterval(interval);
  }, [totalXp]);

  const triggerLevelUpAnimation = () => {
    // Simple celebration (no external confetti library needed)
    // Could be enhanced with canvas-based confetti if desired
  };

  // Level color gradient
  const getLevelGradient = (level: number) => {
    if (level >= 31) return 'from-purple-500 to-pink-500';
    if (level >= 21) return 'from-blue-500 to-cyan-500';
    if (level >= 11) return 'from-green-500 to-emerald-500';
    if (level >= 6) return 'from-yellow-500 to-orange-500';
    return 'from-gray-400 to-gray-500';
  };

  const gradient = getLevelGradient(levelData.level);

  return (
    <div className={cn('relative', className)}>
      {/* Level up notification */}
      <AnimatePresence>
        {showLevelUp && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.8 }}
            className="absolute -top-16 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 font-bold"
          >
            <TrendingUp className="w-5 h-5" />
            Niveau {levelData.level}!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Level badge */}
      <div className="flex items-center gap-4 mb-3">
        <motion.div
          whileHover={{ scale: 1.1, rotate: 5 }}
          className={cn(
            'relative w-16 h-16 rounded-full flex flex-col items-center justify-center text-white font-bold shadow-lg bg-gradient-to-br',
            gradient
          )}
        >
          <span className="text-xs uppercase tracking-wide opacity-80">Lvl</span>
          <span className="text-2xl">{levelData.level}</span>
          {/* Ring animation */}
          <motion.div
            className={cn(
              'absolute inset-0 rounded-full border-4 border-white/30'
            )}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </motion.div>

        <div className="flex-1">
          <h3 className="font-bold text-lg">{levelData.title}</h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>
              {displayXp.toLocaleString()} / {levelData.nextLevelXp.toLocaleString()} XP
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="w-full bg-muted rounded-full h-3 overflow-hidden shadow-inner">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${levelData.progress}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className={cn(
              'h-full rounded-full bg-gradient-to-r shadow-lg',
              gradient
            )}
          >
            {/* Shimmer effect */}
            <motion.div
              className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
              animate={{
                x: ['-100%', '200%'],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          </motion.div>
        </div>

        {/* Progress percentage */}
        <div className="absolute -top-6 right-0 text-xs font-semibold text-muted-foreground">
          {levelData.progress}%
        </div>
      </div>

      {/* Next level info */}
      <p className="text-xs text-muted-foreground text-center mt-2">
        {levelData.nextLevelXp - displayXp > 0
          ? `${(levelData.nextLevelXp - displayXp).toLocaleString()} XP pour niveau ${levelData.level + 1}`
          : 'Niveau maximum atteint!'}
      </p>
    </div>
  );
}
