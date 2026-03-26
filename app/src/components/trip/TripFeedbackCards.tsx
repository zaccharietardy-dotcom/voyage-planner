'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { FeedbackCard } from '@/lib/types/pipelineQuestions';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';

interface TripFeedbackCardsProps {
  cards: FeedbackCard[];
  onSelectA: (card: FeedbackCard) => void;
  onSelectB: (card: FeedbackCard) => void;
  onDismiss: () => void;
}

export function TripFeedbackCards({ cards, onSelectA, onSelectB, onDismiss }: TripFeedbackCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answered, setAnswered] = useState<Set<number>>(new Set());

  const card = cards[currentIndex];
  if (!card) return null;

  const isLast = currentIndex === cards.length - 1;
  const allAnswered = answered.size === cards.length;

  const handleSelectA = () => {
    hapticImpactLight();
    onSelectA(card);
    setAnswered(prev => new Set(prev).add(currentIndex));
    if (!isLast) {
      setTimeout(() => setCurrentIndex(i => i + 1), 300);
    }
  };

  const handleSelectB = () => {
    hapticImpactMedium();
    onSelectB(card);
    setAnswered(prev => new Set(prev).add(currentIndex));
    if (!isLast) {
      setTimeout(() => setCurrentIndex(i => i + 1), 300);
    }
  };

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-[2rem] border-t border-white/10 bg-[#0a0f1c]/95 backdrop-blur-xl shadow-[0_-20px_50px_rgba(0,0,0,0.5)] safe-area-bottom"
    >
      {/* Handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="h-1 w-10 rounded-full bg-white/20" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pb-3">
        <div>
          <h3 className="text-base font-bold text-white">
            Personnalisez votre voyage
          </h3>
          <p className="text-xs text-white/40 mt-0.5">
            {currentIndex + 1}/{cards.length} — {card.slotLabel}
          </p>
        </div>
        <button
          onClick={() => { hapticImpactLight(); onDismiss(); }}
          className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* A/B Card */}
      <div className="px-6 pb-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-2 gap-3"
          >
            {/* Option A — current choice */}
            <OptionButton
              option={card.optionA}
              label="Actuel"
              isSelected={answered.has(currentIndex)}
              onClick={handleSelectA}
            />

            {/* Option B — alternative */}
            <OptionButton
              option={card.optionB}
              label="Alternative"
              isSelected={false}
              onClick={handleSelectB}
              highlight
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-6 pb-6">
        <button
          onClick={() => { hapticImpactLight(); setCurrentIndex(i => Math.max(0, i - 1)); }}
          disabled={currentIndex === 0}
          className="h-9 px-3 rounded-xl bg-white/5 text-white/40 text-sm font-medium flex items-center gap-1 disabled:opacity-30 hover:bg-white/10 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Précédent
        </button>

        {allAnswered || isLast ? (
          <button
            onClick={() => { hapticImpactMedium(); onDismiss(); }}
            className="h-9 px-5 rounded-xl bg-gold/20 text-gold text-sm font-bold flex items-center gap-1.5 hover:bg-gold/30 transition-colors"
          >
            <Check className="h-4 w-4" />
            Terminer
          </button>
        ) : (
          <button
            onClick={() => { hapticImpactLight(); setCurrentIndex(i => Math.min(cards.length - 1, i + 1)); }}
            className="h-9 px-3 rounded-xl bg-white/5 text-white/40 text-sm font-medium flex items-center gap-1 hover:bg-white/10 transition-colors"
          >
            Suivant
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: individual option button
// ---------------------------------------------------------------------------

function OptionButton({
  option,
  label,
  isSelected,
  onClick,
  highlight,
}: {
  option: FeedbackCard['optionA'];
  label: string;
  isSelected: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative flex flex-col rounded-2xl border p-3 text-left transition-all duration-200
        active:scale-[0.97] min-h-[120px]
        ${highlight
          ? 'border-gold/30 bg-gold/5 hover:border-gold/50'
          : 'border-white/10 bg-white/5 hover:border-white/20'
        }
      `}
    >
      {/* Image */}
      {option.imageUrl && (
        <div className="w-full h-16 rounded-lg overflow-hidden mb-2 bg-white/5">
          <img
            src={option.imageUrl}
            alt={option.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Badge */}
      <span className={`
        text-[9px] font-black uppercase tracking-widest mb-1
        ${highlight ? 'text-gold/60' : 'text-white/30'}
      `}>
        {label}
      </span>

      {/* Name */}
      <p className="text-sm font-semibold text-white leading-tight line-clamp-2">
        {option.name}
      </p>

      {/* Rating + type */}
      <div className="mt-auto pt-2 flex items-center gap-2">
        {option.rating && (
          <span className="flex items-center gap-0.5 text-xs text-white/50">
            <Star className="h-3 w-3 fill-gold text-gold" />
            {option.rating.toFixed(1)}
          </span>
        )}
        {option.cuisineOrType && (
          <span className="text-[10px] text-white/30 truncate">
            {option.cuisineOrType}
          </span>
        )}
      </div>
    </button>
  );
}
