'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { PipelineQuestion } from '@/lib/types/pipelineQuestions';
import { hapticImpactLight } from '@/lib/mobile/haptics';

interface QuestionCardProps {
  question: PipelineQuestion;
  onAnswer: (questionId: string, selectedOptionId: string) => void;
}

export function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(question.timeoutMs / 1000));
  const totalSeconds = Math.ceil(question.timeoutMs / 1000);

  // Countdown timer
  useEffect(() => {
    if (selectedId) return; // Stop counting after selection
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Auto-select default
          const defaultOption = question.options.find(o => o.isDefault) || question.options[0];
          setSelectedId(defaultOption.id);
          onAnswer(question.questionId, defaultOption.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [question, onAnswer, selectedId]);

  const handleSelect = useCallback((optionId: string) => {
    if (selectedId) return; // Already answered
    hapticImpactLight();
    setSelectedId(optionId);
    onAnswer(question.questionId, optionId);
  }, [question.questionId, onAnswer, selectedId]);

  // SVG countdown arc
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const progress = selectedId ? 0 : (timeLeft / totalSeconds);
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -40, opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header with countdown */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-gold mb-1">
            Question
          </p>
          <h3 className="text-lg font-bold text-white">
            {question.title}
          </h3>
        </div>
        {!selectedId && (
          <div className="relative flex items-center justify-center">
            <svg width="40" height="40" className="-rotate-90">
              <circle
                cx="20" cy="20" r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="2.5"
              />
              <circle
                cx="20" cy="20" r={radius}
                fill="none"
                stroke="#E2B35C"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
              />
            </svg>
            <span className="absolute text-[10px] font-bold text-white/60 tabular-nums">
              {timeLeft}
            </span>
          </div>
        )}
      </div>

      {/* Prompt */}
      <p className="text-sm text-white/70 mb-5 leading-relaxed">
        {question.prompt}
      </p>

      {/* Options */}
      <div className="space-y-2.5">
        {question.options.map((option) => {
          const isSelected = selectedId === option.id;
          const isAutoSelected = selectedId === option.id && timeLeft === 0;

          return (
            <button
              key={option.id}
              onClick={() => handleSelect(option.id)}
              disabled={!!selectedId}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-2xl
                text-left transition-all duration-200
                min-h-[44px]
                ${isSelected
                  ? 'bg-gold/20 border-gold/50 text-gold border'
                  : selectedId
                    ? 'bg-white/3 border-white/5 text-white/30 border'
                    : 'bg-white/5 border-white/10 text-white border hover:bg-white/10 hover:border-white/20 active:scale-[0.98]'
                }
              `}
            >
              {option.emoji && (
                <span className="text-lg shrink-0">{option.emoji}</span>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold block">
                  {option.label}
                </span>
                {option.subtitle && (
                  <span className="text-xs text-white/40 block mt-0.5">
                    {option.subtitle}
                  </span>
                )}
              </div>
              {isAutoSelected && (
                <span className="text-[10px] text-gold/60 font-medium shrink-0">
                  Auto
                </span>
              )}
              {isSelected && !isAutoSelected && (
                <svg className="w-4 h-4 text-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
