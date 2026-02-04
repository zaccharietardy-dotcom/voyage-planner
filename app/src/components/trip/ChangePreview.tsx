'use client';

import React from 'react';
import { Check, X, Plus, Minus, ArrowRight, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripChange, TripDay } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ChangePreviewProps {
  changes: TripChange[];
  currentDays: TripDay[];
  previewDays: TripDay[];
  onConfirm: () => void;
  onReject: () => void;
  isProcessing: boolean;
}

export function ChangePreview({
  changes,
  currentDays,
  previewDays,
  onConfirm,
  onReject,
  isProcessing,
}: ChangePreviewProps) {
  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">Modifications proposées</h4>
        <span className="text-xs text-muted-foreground">
          {changes.length} changement{changes.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Liste des changements */}
      <div className="space-y-2">
        {changes.map((change, index) => (
          <ChangeItem key={index} change={change} />
        ))}
      </div>

      {/* Boutons d'action */}
      <div className="flex gap-2 pt-2">
        <Button
          onClick={onConfirm}
          disabled={isProcessing}
          size="sm"
          className="flex-1 gap-2"
        >
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Appliquer
        </Button>
        <Button
          onClick={onReject}
          disabled={isProcessing}
          variant="outline"
          size="sm"
          className="flex-1 gap-2"
        >
          <X className="h-4 w-4" />
          Annuler
        </Button>
      </div>
    </div>
  );
}

function ChangeItem({ change }: { change: TripChange }) {
  const getIcon = () => {
    switch (change.type) {
      case 'add':
        return <Plus className="h-4 w-4 text-green-500" />;
      case 'remove':
        return <Minus className="h-4 w-4 text-red-500" />;
      case 'update':
      case 'move':
        return <ArrowRight className="h-4 w-4 text-blue-500" />;
      default:
        return null;
    }
  };

  const getBgColor = () => {
    switch (change.type) {
      case 'add':
        return 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800';
      case 'remove':
        return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800';
      case 'update':
      case 'move':
        return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-muted border-border';
    }
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-md border text-sm',
        getBgColor()
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{change.description}</p>

        {/* Détails du changement */}
        {change.type === 'update' && change.before && change.after && (
          <div className="mt-1 text-xs text-muted-foreground">
            {change.before.startTime && change.after.startTime && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{change.before.startTime}</span>
                <ArrowRight className="h-3 w-3" />
                <span>{change.after.startTime}</span>
              </div>
            )}
            {change.before.title && change.after.title && change.before.title !== change.after.title && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="line-through">{change.before.title}</span>
                <ArrowRight className="h-3 w-3" />
                <span>{change.after.title}</span>
              </div>
            )}
          </div>
        )}

        {/* Info du jour */}
        <p className="text-xs text-muted-foreground mt-1">
          Jour {change.dayNumber}
        </p>
      </div>
    </div>
  );
}

// Composant pour afficher un résumé compact des changements
export function ChangesSummary({ changes }: { changes: TripChange[] }) {
  const adds = changes.filter(c => c.type === 'add').length;
  const removes = changes.filter(c => c.type === 'remove').length;
  const updates = changes.filter(c => c.type === 'update' || c.type === 'move').length;

  return (
    <div className="flex items-center gap-3 text-xs">
      {adds > 0 && (
        <span className="flex items-center gap-1 text-green-600">
          <Plus className="h-3 w-3" />
          {adds} ajout{adds > 1 ? 's' : ''}
        </span>
      )}
      {removes > 0 && (
        <span className="flex items-center gap-1 text-red-600">
          <Minus className="h-3 w-3" />
          {removes} suppression{removes > 1 ? 's' : ''}
        </span>
      )}
      {updates > 0 && (
        <span className="flex items-center gap-1 text-blue-600">
          <ArrowRight className="h-3 w-3" />
          {updates} modification{updates > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
