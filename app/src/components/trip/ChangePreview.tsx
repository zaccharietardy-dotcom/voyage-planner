'use client';

import React, { useState, useMemo } from 'react';
import { Check, X, Plus, Minus, ArrowRight, Clock, Loader2, MessageSquarePlus, List, Columns2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripChange, TripDay, TripItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ChangePreviewProps {
  changes: TripChange[];
  currentDays: TripDay[];
  previewDays: TripDay[];
  onConfirm: () => void;
  onReject: () => void;
  onModify?: (feedback: string) => void;
  isProcessing: boolean;
}

export function ChangePreview({
  changes,
  currentDays,
  previewDays,
  onConfirm,
  onReject,
  onModify,
  isProcessing,
}: ChangePreviewProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'diff'>(
    changes.length > 2 ? 'diff' : 'list'
  );

  const handleModifySubmit = () => {
    if (feedbackText.trim() && onModify) {
      onModify(feedbackText.trim());
      setFeedbackText('');
      setShowFeedback(false);
    }
  };

  // Jours impactés par les changements
  const affectedDayNumbers = useMemo(() => {
    return [...new Set(changes.map(c => c.dayNumber))].sort((a, b) => a - b);
  }, [changes]);

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">Modifications proposées</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {changes.length} changement{changes.length > 1 ? 's' : ''}
          </span>
          {/* Toggle vue Liste / Comparaison */}
          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1 transition-colors',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              )}
              title="Vue liste"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('diff')}
              className={cn(
                'p-1 transition-colors',
                viewMode === 'diff'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              )}
              title="Vue comparaison"
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Contenu selon le mode */}
      <div className="max-h-[200px] overflow-y-auto">
        {viewMode === 'list' ? (
          <div className="space-y-2">
            {changes.map((change, index) => (
              <ChangeItem key={index} change={change} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {affectedDayNumbers.map(dayNum => {
              const currentDay = currentDays.find(d => d.dayNumber === dayNum);
              const previewDay = previewDays.find(d => d.dayNumber === dayNum);
              const dayChanges = changes.filter(c => c.dayNumber === dayNum);

              if (!currentDay && !previewDay) return null;

              return (
                <DayDiffView
                  key={dayNum}
                  dayNumber={dayNum}
                  currentDay={currentDay}
                  previewDay={previewDay}
                  changes={dayChanges}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Zone de feedback pour modifier */}
      {showFeedback && (
        <div className="space-y-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            Décrivez ce que vous préférez :
          </p>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Ex: Je préfère décaler de 30 min seulement, garder le déjeuner à la même heure..."
            className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            rows={2}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              onClick={handleModifySubmit}
              disabled={!feedbackText.trim() || isProcessing}
              size="sm"
              className="flex-1 gap-1"
            >
              {isProcessing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <MessageSquarePlus className="h-3 w-3" />
              )}
              Envoyer
            </Button>
            <Button
              onClick={() => { setShowFeedback(false); setFeedbackText(''); }}
              variant="ghost"
              size="sm"
            >
              Retour
            </Button>
          </div>
        </div>
      )}

      {/* Boutons d'action */}
      {!showFeedback && (
        <div className="flex gap-2 pt-2">
          <Button
            onClick={onConfirm}
            disabled={isProcessing}
            size="sm"
            className="flex-1 gap-1"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Appliquer
          </Button>
          {onModify && (
            <Button
              onClick={() => setShowFeedback(true)}
              disabled={isProcessing}
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Modifier
            </Button>
          )}
          <Button
            onClick={onReject}
            disabled={isProcessing}
            variant="ghost"
            size="sm"
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Annuler
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================
// Diff visuel par jour (avant/après)
// ============================================

interface DayDiffViewProps {
  dayNumber: number;
  currentDay?: TripDay;
  previewDay?: TripDay;
  changes: TripChange[];
}

function DayDiffView({ dayNumber, currentDay, previewDay, changes }: DayDiffViewProps) {
  // Construire les sets d'IDs pour identifier les changements
  const addedItemIds = new Set(
    changes.filter(c => c.type === 'add').map(c => c.newItem?.id).filter(Boolean)
  );
  const removedItemIds = new Set(
    changes.filter(c => c.type === 'remove').map(c => c.itemId).filter(Boolean)
  );
  const updatedItemIds = new Set(
    changes.filter(c => c.type === 'update' || c.type === 'move').map(c => c.itemId).filter(Boolean)
  );

  const currentItems = currentDay?.items || [];
  const previewItems = previewDay?.items || [];

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Header du jour */}
      <div className="bg-muted px-3 py-1.5 border-b">
        <span className="text-xs font-medium">Jour {dayNumber}</span>
        {currentDay?.theme && (
          <span className="text-xs text-muted-foreground ml-2">— {currentDay.theme}</span>
        )}
      </div>

      {/* Deux colonnes : Avant / Après */}
      <div className="grid grid-cols-2 divide-x text-xs">
        {/* Colonne Avant */}
        <div>
          <div className="px-2 py-1 bg-muted/30 border-b">
            <span className="font-medium text-muted-foreground">Avant</span>
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {currentItems.map(item => {
              const isRemoved = removedItemIds.has(item.id);
              const isUpdated = updatedItemIds.has(item.id);

              return (
                <DiffItemRow
                  key={item.id}
                  item={item}
                  status={isRemoved ? 'removed' : isUpdated ? 'updated-before' : 'unchanged'}
                />
              );
            })}
            {currentItems.length === 0 && (
              <p className="text-muted-foreground italic py-1">Aucune activité</p>
            )}
          </div>
        </div>

        {/* Colonne Après */}
        <div>
          <div className="px-2 py-1 bg-muted/30 border-b">
            <span className="font-medium text-muted-foreground">Après</span>
          </div>
          <div className="px-2 py-1 space-y-0.5">
            {previewItems.map(item => {
              const isAdded = addedItemIds.has(item.id);
              const isUpdated = updatedItemIds.has(item.id);

              return (
                <DiffItemRow
                  key={item.id}
                  item={item}
                  status={isAdded ? 'added' : isUpdated ? 'updated-after' : 'unchanged'}
                />
              );
            })}
            {previewItems.length === 0 && (
              <p className="text-muted-foreground italic py-1">Aucune activité</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Ligne d'item dans le diff
// ============================================

type DiffItemStatus = 'unchanged' | 'added' | 'removed' | 'updated-before' | 'updated-after';

function DiffItemRow({ item, status }: { item: TripItem; status: DiffItemStatus }) {
  const getTypeEmoji = (type: string) => {
    switch (type) {
      case 'activity': return '';
      case 'restaurant': return '';
      case 'flight': return '';
      case 'checkin': case 'checkout': return '';
      case 'transport': return '';
      default: return '';
    }
  };

  const statusStyles: Record<DiffItemStatus, string> = {
    unchanged: 'text-muted-foreground/70',
    added: 'bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-200 font-medium border-l-2 border-green-500 pl-1.5',
    removed: 'bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200 line-through border-l-2 border-red-500 pl-1.5',
    'updated-before': 'bg-blue-50/50 dark:bg-blue-950/10 text-muted-foreground line-through border-l-2 border-blue-300 pl-1.5',
    'updated-after': 'bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200 font-medium border-l-2 border-blue-500 pl-1.5',
  };

  const emoji = getTypeEmoji(item.type);
  const title = item.title.length > 22 ? item.title.slice(0, 20) + '...' : item.title;

  return (
    <div className={cn('py-0.5 px-1 rounded-sm flex items-center gap-1', statusStyles[status])}>
      {emoji && <span className="flex-shrink-0">{emoji}</span>}
      <span className="flex-shrink-0 tabular-nums">{item.startTime}</span>
      <span className="truncate">{title}</span>
    </div>
  );
}

// ============================================
// Composant ChangeItem existant (vue liste)
// ============================================

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
        'flex items-start gap-3 p-2.5 rounded-md border text-sm',
        getBgColor()
      )}
    >
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-xs leading-snug">{change.description}</p>

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
        <p className="text-xs text-muted-foreground mt-0.5">
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
