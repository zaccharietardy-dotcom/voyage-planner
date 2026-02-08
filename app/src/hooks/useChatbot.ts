/**
 * useChatbot Hook
 *
 * Gère l'état du chatbot de modification d'itinéraire:
 * - Messages (historique)
 * - Envoi de messages
 * - Prévisualisation des changements
 * - Application/annulation des modifications
 * - Demande de modification alternative
 * - Undo stack
 * - Suggestions contextuelles
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatMessage, ChatResponse, TripChange, TripDay, ContextualSuggestion } from '@/lib/types';

const MAX_UNDO_DEPTH = 10;

interface UseChatbotOptions {
  tripId: string;
  currentDays: TripDay[];
  onDaysUpdate: (days: TripDay[]) => void;
}

interface UseChatbotReturn {
  messages: ChatMessage[];
  isProcessing: boolean;
  error: string | null;
  pendingChanges: TripChange[] | null;
  previewDays: TripDay[] | null;
  suggestions: ContextualSuggestion[];
  sendMessage: (text: string) => Promise<void>;
  confirmChanges: () => Promise<void>;
  rejectChanges: () => void;
  requestModification: (feedback: string) => void;
  undo: () => Promise<void>;
  canUndo: boolean;
  clearHistory: () => void;
}

export function useChatbot({
  tripId,
  currentDays,
  onDaysUpdate,
}: UseChatbotOptions): UseChatbotReturn {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<TripChange[] | null>(null);
  const [previewDays, setPreviewDays] = useState<TripDay[] | null>(null);
  const [undoStack, setUndoStack] = useState<TripDay[][]>([]);
  const [suggestions, setSuggestions] = useState<ContextualSuggestion[]>([]);

  // Ref pour garder la version actuelle des jours (pour undo)
  const currentDaysRef = useRef<TripDay[]>(currentDays);
  useEffect(() => {
    currentDaysRef.current = currentDays;
  }, [currentDays]);

  // Ref pour la dernière demande (pour le contexte de modification)
  const lastRequestRef = useRef<string>('');

  // Charger les suggestions contextuelles (avec timeout de 8s pour éviter les blocages)
  const loadSuggestions = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`/api/trips/${tripId}/chat/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.suggestions?.length > 0) {
          setSuggestions(data.suggestions);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn('[useChatbot] Suggestions request timed out');
      } else {
        console.error('[useChatbot] Error loading suggestions:', err);
      }
    }
  }, [tripId]);

  // Charger l'historique au montage
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const loadHistory = async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}/chat`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);

        // Charger les suggestions initiales après l'historique
        loadSuggestions();
      }
    } catch (err) {
      console.error('[useChatbot] Error loading history:', err);
    }
  };

  // Envoyer un message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    setError(null);

    // Sauvegarde la dernière demande pour le contexte de modification
    lastRequestRef.current = text;

    // Ajoute le message utilisateur optimistiquement
    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      tripId,
      role: 'user',
      content: text,
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch(`/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'envoi du message');
      }

      const data: ChatResponse = await response.json();

      // Ajoute la réponse assistant (avec errorInfo si présent)
      const assistantMessage: ChatMessage = {
        id: `temp-${Date.now() + 1}`,
        tripId,
        role: 'assistant',
        content: data.reply,
        intent: data.intent,
        errorInfo: data.errorInfo || null,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Si des changements sont proposés, les stocker pour prévisualisation
      if (data.requiresConfirmation && data.changes && data.previewDays) {
        setPendingChanges(data.changes);
        setPreviewDays(data.previewDays);
      } else {
        setPendingChanges(null);
        setPreviewDays(null);
      }

      // Mettre à jour les suggestions si la réponse en contient
      if (data.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      }
    } catch (err) {
      console.error('[useChatbot] Error:', err);
      setError('Erreur lors de l\'envoi du message. Veuillez réessayer.');

      // Ajoute un message d'erreur
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        tripId,
        role: 'assistant',
        content: 'Désolé, une erreur est survenue. Veuillez réessayer.',
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  }, [tripId, isProcessing]);

  // Confirmer les changements
  const confirmChanges = useCallback(async () => {
    if (!pendingChanges || !previewDays) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Sauvegarde l'état actuel pour undo
      setUndoStack(prev => [...prev.slice(-MAX_UNDO_DEPTH + 1), currentDaysRef.current]);

      // Applique les changements via l'API
      const response = await fetch(`/api/trips/${tripId}/chat/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newDays: previewDays,
          changes: pendingChanges,
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'application des changements');
      }

      // Met à jour l'état local
      onDaysUpdate(previewDays);

      // Ajoute un message de confirmation
      const confirmMessage: ChatMessage = {
        id: `confirm-${Date.now()}`,
        tripId,
        role: 'assistant',
        content: '✅ Modifications appliquées ! Vous pouvez annuler pendant quelques secondes si besoin.',
        changesApplied: pendingChanges,
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, confirmMessage]);

      // Reset les états
      setPendingChanges(null);
      setPreviewDays(null);

      // Régénérer les suggestions après confirmation (basées sur le nouvel itinéraire)
      loadSuggestions();
    } catch (err) {
      console.error('[useChatbot] Error applying changes:', err);
      setError('Erreur lors de l\'application des modifications.');
    } finally {
      setIsProcessing(false);
    }
  }, [tripId, pendingChanges, previewDays, onDaysUpdate, loadSuggestions]);

  // Rejeter les changements
  const rejectChanges = useCallback(() => {
    setPendingChanges(null);
    setPreviewDays(null);

    // Ajoute un message d'annulation
    const cancelMessage: ChatMessage = {
      id: `cancel-${Date.now()}`,
      tripId,
      role: 'assistant',
      content: 'Modifications annulées. Comment puis-je vous aider autrement ?',
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, cancelMessage]);
  }, [tripId]);

  // Demander une modification alternative
  const requestModification = useCallback((feedback: string) => {
    // Rejette les changements en cours
    setPendingChanges(null);
    setPreviewDays(null);

    // Construit un message contextuel avec la demande originale et le feedback
    const contextMessage = lastRequestRef.current
      ? `Ma demande initiale était : "${lastRequestRef.current}". Mais je préfère : ${feedback}`
      : feedback;

    // Envoie automatiquement le nouveau message
    sendMessage(contextMessage);
  }, [sendMessage]);

  // Undo - revenir à l'état précédent
  const undo = useCallback(async () => {
    if (undoStack.length === 0) return;

    setIsProcessing(true);
    setError(null);

    try {
      const previousDays = undoStack[undoStack.length - 1];

      // Appelle l'API pour restaurer
      const response = await fetch(`/api/trips/${tripId}/chat/apply`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollbackDays: previousDays }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de l\'annulation');
      }

      // Met à jour l'état local
      onDaysUpdate(previousDays);
      setUndoStack(prev => prev.slice(0, -1));

      // Ajoute un message de confirmation
      const undoMessage: ChatMessage = {
        id: `undo-${Date.now()}`,
        tripId,
        role: 'assistant',
        content: '↩️ Modifications annulées. L\'itinéraire a été restauré.',
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, undoMessage]);
    } catch (err) {
      console.error('[useChatbot] Error undoing:', err);
      setError('Erreur lors de l\'annulation.');
    } finally {
      setIsProcessing(false);
    }
  }, [tripId, undoStack, onDaysUpdate]);

  // Effacer l'historique local
  const clearHistory = useCallback(() => {
    setMessages([]);
    setPendingChanges(null);
    setPreviewDays(null);
    setError(null);
    setSuggestions([]);
  }, []);

  return {
    messages,
    isProcessing,
    error,
    pendingChanges,
    previewDays,
    suggestions,
    sendMessage,
    confirmChanges,
    rejectChanges,
    requestModification,
    undo,
    canUndo: undoStack.length > 0,
    clearHistory,
  };
}
