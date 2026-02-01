'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFilteredTips, PROGRESS_STEPS, type GenerationTip } from '@/lib/data/generationTips';

interface GeneratingOverlayProps {
  isOpen: boolean;
  destination: string;
  origin: string;
  startDate: string;
  durationDays: number;
}

export function GeneratingOverlay({
  isOpen,
  destination,
  startDate,
}: GeneratingOverlayProps) {
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Filter tips based on destination and season
  const tips: GenerationTip[] = useMemo(() => {
    if (!destination) return [];
    return getFilteredTips(destination, startDate);
  }, [destination, startDate]);

  // Rotate tips every 7 seconds
  useEffect(() => {
    if (!isOpen || tips.length === 0) return;
    const interval = setInterval(() => {
      setCurrentTipIndex(prev => (prev + 1) % tips.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [isOpen, tips.length]);

  // Track elapsed time for progress steps
  useEffect(() => {
    if (!isOpen) {
      setElapsed(0);
      setCurrentStepIndex(0);
      setCurrentTipIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(prev => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Update progress step based on elapsed time
  useEffect(() => {
    for (let i = PROGRESS_STEPS.length - 1; i >= 0; i--) {
      if (elapsed >= PROGRESS_STEPS[i].delay) {
        setCurrentStepIndex(i);
        break;
      }
    }
  }, [elapsed]);

  const currentTip = tips[currentTipIndex];
  const currentStep = PROGRESS_STEPS[currentStepIndex];

  // Progress bar: slow fill over ~90s
  const progressPercent = Math.min(95, (elapsed / 90000) * 95);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="generating-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="w-full max-w-md mx-4 text-center"
        >
          {/* Animated plane icon */}
          <motion.div
            animate={{
              y: [0, -8, 0],
              rotate: [0, 3, -3, 0],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="text-5xl mb-6"
          >
            ✈️
          </motion.div>

          {/* Title */}
          <h2 className="text-xl font-bold text-white mb-1">
            Création de votre voyage
          </h2>
          <p className="text-white/70 mb-8">
            à <span className="text-white font-semibold">{destination}</span>
          </p>

          {/* Progress bar */}
          <div className="w-full bg-white/10 rounded-full h-2 mb-3 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>

          {/* Progress step text */}
          <AnimatePresence mode="wait">
            <motion.p
              key={currentStepIndex}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-white/60 mb-10"
            >
              {currentStep.icon} {currentStep.text}
            </motion.p>
          </AnimatePresence>

          {/* Tip card */}
          {currentTip && (
            <div className="relative min-h-[140px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentTipIndex}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.4 }}
                  className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-5 text-left"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{currentTip.icon}</span>
                    <span className="text-sm font-semibold text-white/90">
                      {currentTip.title}
                    </span>
                  </div>
                  <p className="text-sm text-white/70 leading-relaxed">
                    {currentTip.text}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Dot indicators */}
              {tips.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-4">
                  {tips.slice(0, Math.min(tips.length, 8)).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                        i === currentTipIndex % Math.min(tips.length, 8)
                          ? 'bg-white w-4'
                          : 'bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
