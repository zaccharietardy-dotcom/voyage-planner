'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding } from '@/hooks/useOnboarding';
import { Button } from '@/components/ui/button';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';

// ─── Tour step definitions ─────────────────────────────────

interface TourStep {
  target: string;       // data-tour attribute value
  title: string;
  description: string;
  desktopOnly?: boolean;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: 'view-toggle',
    title: 'Vue planning',
    description: 'Basculez entre la vue timeline et calendrier pour organiser votre itinéraire.',
  },
  {
    target: 'edit-mode',
    title: 'Mode édition',
    description: 'Activez le mode édition pour réorganiser vos activités par glisser-déposer.',
  },
  {
    target: 'map-panel',
    title: 'Carte interactive',
    description: 'Visualisez toutes vos activités sur la carte interactive.',
    desktopOnly: true,
  },
  {
    target: 'chat-button',
    title: 'Assistant IA',
    description: 'Demandez à l\'IA de modifier votre voyage en langage naturel.',
  },
  {
    target: 'tabs',
    title: 'Onglets',
    description: 'Retrouvez vos réservations, photos et informations pratiques ici.',
  },
  {
    target: 'share-button',
    title: 'Partager',
    description: 'Partagez votre voyage ou invitez des amis à collaborer.',
  },
];

const STORAGE_KEY = 'voyage-onboarding-trip-done';

// ─── Component ──────────────────────────────────────────────

export function TripOnboarding() {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Filter steps based on device
  const filteredSteps = TOUR_STEPS.filter(
    (step) => !step.desktopOnly || isDesktop
  );

  const {
    isActive,
    step: currentStep,
    totalSteps: _,
    next,
    prev,
    dismiss,
  } = useOnboarding(STORAGE_KEY, filteredSteps.length);

  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const tooltipRef = useRef<HTMLDivElement>(null);

  // Position the tooltip relative to the target element
  const updatePosition = useCallback(() => {
    if (!isActive || currentStep >= filteredSteps.length) return;

    const step = filteredSteps[currentStep];
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) {
      // Element not found — skip this step
      return;
    }

    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Decide placement: if element is in top half, show tooltip below; else above
    const placement = rect.top < viewportHeight / 2 ? 'bottom' : 'top';

    setTooltipPos({
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
      placement,
    });
  }, [isActive, currentStep, filteredSteps]);

  useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  // Also update on step change with slight delay for DOM updates
  useEffect(() => {
    const timer = setTimeout(updatePosition, 100);
    return () => clearTimeout(timer);
  }, [currentStep, updatePosition]);

  if (!isActive || !tooltipPos) return null;

  const currentTourStep = filteredSteps[currentStep];
  const isLast = currentStep === filteredSteps.length - 1;
  const isFirst = currentStep === 0;

  // Spotlight dimensions with padding
  const pad = 6;
  const spotX = tooltipPos.left - pad;
  const spotY = tooltipPos.top - pad;
  const spotW = tooltipPos.width + pad * 2;
  const spotH = tooltipPos.height + pad * 2;
  const spotR = 10;

  // Tooltip position
  const tooltipTop = tooltipPos.placement === 'bottom'
    ? tooltipPos.top + tooltipPos.height + 16
    : tooltipPos.top - 16;
  const tooltipLeft = Math.max(
    12,
    Math.min(
      tooltipPos.left + tooltipPos.width / 2 - 160,
      (typeof window !== 'undefined' ? window.innerWidth : 800) - 332
    )
  );

  return (
    <>
      {/* Backdrop with spotlight cutout */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9998]"
        onClick={dismiss}
        style={{ pointerEvents: 'auto' }}
      >
        <svg className="w-full h-full" style={{ position: 'absolute', top: 0, left: 0 }}>
          <defs>
            <mask id="onboarding-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={spotX}
                y={spotY}
                width={spotW}
                height={spotH}
                rx={spotR}
                ry={spotR}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.5)"
            mask="url(#onboarding-mask)"
          />
          {/* Highlight ring around target */}
          <rect
            x={spotX}
            y={spotY}
            width={spotW}
            height={spotH}
            rx={spotR}
            ry={spotR}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="2"
            opacity="0.8"
          />
        </svg>
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          ref={tooltipRef}
          initial={{ opacity: 0, y: tooltipPos.placement === 'bottom' ? -8 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: tooltipPos.placement === 'bottom' ? -8 : 8 }}
          transition={{ duration: 0.25 }}
          className="fixed z-[9999] w-[320px]"
          style={{
            top: tooltipTop,
            left: tooltipLeft,
            transform: tooltipPos.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-card border border-border rounded-xl shadow-xl p-4">
            {/* Close button */}
            <button
              onClick={dismiss}
              className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Content */}
            <div className="pr-6">
              <h3 className="text-sm font-semibold mb-1">{currentTourStep.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {currentTourStep.description}
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {filteredSteps.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === currentStep
                        ? 'w-4 bg-primary'
                        : idx < currentStep
                          ? 'w-1.5 bg-primary/40'
                          : 'w-1.5 bg-muted-foreground/20'
                    }`}
                  />
                ))}
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={dismiss}
                >
                  Passer
                </Button>
                {!isFirst && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={prev}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={next}
                >
                  {isLast ? 'Terminer' : 'Suivant'}
                  {!isLast && <ChevronRight className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Arrow pointer */}
          <div
            className="absolute w-3 h-3 bg-card border border-border rotate-45"
            style={{
              left: Math.min(
                Math.max(
                  tooltipPos.left + tooltipPos.width / 2 - tooltipLeft - 6,
                  16
                ),
                288
              ),
              ...(tooltipPos.placement === 'bottom'
                ? { top: -7, borderBottom: 'none', borderRight: 'none' }
                : { bottom: -7, borderTop: 'none', borderLeft: 'none' }),
            }}
          />
        </motion.div>
      </AnimatePresence>
    </>
  );
}
