'use client';

import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, X, Undo2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChatbot } from '@/hooks/useChatbot';
import { TripDay, SUGGESTED_CHAT_PROMPTS } from '@/lib/types';
import { ChatMessageBubble } from './ChatMessage';
import { ChangePreview } from './ChangePreview';

interface ChatPanelProps {
  tripId: string;
  trip: {
    days: TripDay[];
    preferences?: { destination?: string };
  };
  isOpen: boolean;
  onClose: () => void;
  onDaysUpdate: (days: TripDay[]) => void;
}

export function ChatPanel({
  tripId,
  trip,
  isOpen,
  onClose,
  onDaysUpdate,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    isProcessing,
    error,
    pendingChanges,
    previewDays,
    sendMessage,
    confirmChanges,
    rejectChanges,
    undo,
    canUndo,
  } = useChatbot({
    tripId,
    currentDays: trip.days,
    onDaysUpdate,
  });

  // Auto-scroll vers le bas quand il y a de nouveaux messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus sur l'input quand le panneau s'ouvre
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isProcessing) return;

    const message = inputValue;
    setInputValue('');
    await sendMessage(message);
  };

  const handleSuggestionClick = (prompt: string) => {
    setInputValue(prompt);
    inputRef.current?.focus();
  };

  const destination = trip.preferences?.destination || 'votre destination';

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="border-b px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-blue-500" />
              <SheetTitle className="text-lg">Assistant Voyage</SheetTitle>
            </div>
            <div className="flex items-center gap-2">
              {canUndo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={undo}
                  disabled={isProcessing}
                  title="Annuler la dernière modification"
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <SheetDescription className="text-xs text-muted-foreground">
            Modifiez votre itinéraire en langage naturel
          </SheetDescription>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="py-4 space-y-4">
            {/* Message de bienvenue si pas de messages */}
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-8">
                <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p className="font-medium">Bienvenue !</p>
                <p className="mt-1">
                  Je peux vous aider à modifier votre voyage à {destination}.
                </p>
                <p className="mt-2 text-xs">
                  Exemples : &quot;Je veux me lever plus tard&quot;, &quot;Ajoute un restaurant
                  japonais&quot;, &quot;Supprime la visite du musée&quot;
                </p>
              </div>
            )}

            {/* Liste des messages */}
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}

            {/* Indicateur de chargement */}
            {isProcessing && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Réflexion en cours...</span>
              </div>
            )}

            {/* Erreur */}
            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Prévisualisation des changements */}
            {pendingChanges && previewDays && (
              <ChangePreview
                changes={pendingChanges}
                currentDays={trip.days}
                previewDays={previewDays}
                onConfirm={confirmChanges}
                onReject={rejectChanges}
                isProcessing={isProcessing}
              />
            )}
          </div>
        </ScrollArea>

        {/* Suggestions */}
        {messages.length === 0 && !pendingChanges && (
          <div className="px-4 py-2 border-t flex-shrink-0">
            <p className="text-xs text-muted-foreground mb-2">Suggestions :</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_CHAT_PROMPTS.slice(0, 4).map((suggestion) => (
                <button
                  key={suggestion.label}
                  onClick={() => handleSuggestionClick(suggestion.prompt)}
                  className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t p-4 flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Tapez votre demande..."
              disabled={isProcessing || !!pendingChanges}
              className="flex-1"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isProcessing || !inputValue.trim() || !!pendingChanges}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Bouton pour ouvrir le chat
export function ChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      <MessageCircle className="h-4 w-4" />
      <span className="hidden sm:inline">Assistant</span>
    </Button>
  );
}
