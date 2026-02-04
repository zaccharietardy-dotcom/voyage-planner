'use client';

import React from 'react';
import { User, Bot, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ChatMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const hasChangesApplied = message.changesApplied && message.changesApplied.length > 0;

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-blue-500' : 'bg-muted'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Contenu */}
      <div
        className={cn(
          'rounded-lg px-4 py-2',
          isUser
            ? 'max-w-[80%] bg-blue-500 text-white'
            : 'max-w-[90%] bg-muted'
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>

        {/* Indicateur de changements appliqués */}
        {hasChangesApplied && (
          <div className="mt-2 pt-2 border-t border-current/20 flex items-center gap-1 text-xs opacity-80">
            <CheckCircle2 className="h-3 w-3" />
            <span>{message.changesApplied!.length} modification(s) appliquée(s)</span>
          </div>
        )}

        {/* Badge d'intention pour debug (optionnel) */}
        {message.intent && process.env.NODE_ENV === 'development' && (
          <div className="mt-2 pt-2 border-t border-current/20">
            <span className="text-xs opacity-50">
              Intent: {message.intent.type} ({Math.round(message.intent.confidence * 100)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Composant pour afficher les warnings
export function WarningMessage({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Attention
          </p>
          <ul className="mt-1 space-y-1 text-amber-700 dark:text-amber-300">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
