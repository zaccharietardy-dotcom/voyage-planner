'use client';

import React, { useEffect, useState } from 'react';
import { Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  duration?: number; // Durée en ms (défaut: 5000)
}

export function UndoToast({
  message,
  onUndo,
  onDismiss,
  duration = 5000,
}: UndoToastProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Animation de la barre de progression
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleDismiss();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300); // Attendre l'animation de sortie
  };

  const handleUndo = () => {
    setIsVisible(false);
    onUndo();
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300',
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
      )}
    >
      <div className="bg-foreground text-background rounded-lg shadow-lg overflow-hidden">
        {/* Barre de progression */}
        <div className="h-1 bg-muted/30">
          <div
            className="h-full bg-primary transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Contenu */}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-sm">{message}</span>

          <Button
            onClick={handleUndo}
            variant="secondary"
            size="sm"
            className="gap-1.5"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Annuler
          </Button>

          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-muted/20 rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook pour gérer l'affichage du toast
export function useUndoToast() {
  const [toastState, setToastState] = useState<{
    isVisible: boolean;
    message: string;
    onUndo: () => void;
  } | null>(null);

  const showUndoToast = (message: string, onUndo: () => void) => {
    setToastState({ isVisible: true, message, onUndo });
  };

  const hideUndoToast = () => {
    setToastState(null);
  };

  const UndoToastComponent = toastState ? (
    <UndoToast
      message={toastState.message}
      onUndo={() => {
        toastState.onUndo();
        hideUndoToast();
      }}
      onDismiss={hideUndoToast}
    />
  ) : null;

  return { showUndoToast, hideUndoToast, UndoToastComponent };
}
