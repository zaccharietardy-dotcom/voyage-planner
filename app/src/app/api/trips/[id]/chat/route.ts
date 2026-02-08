/**
 * Chat API Endpoint
 *
 * POST /api/trips/[id]/chat - Traite un message utilisateur
 * GET /api/trips/[id]/chat - Récupère l'historique des messages
 */

import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { handleChatMessage, TripModificationContext } from '@/lib/services/chatbotModifier';
import { ChatMessage, TripDay, Accommodation, TripPreferences, ConversationContext } from '@/lib/types';

// POST - Traiter un message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Vérifier l'accès au voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, owner_id, data')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Vérifier que l'utilisateur est propriétaire ou membre
    const isOwner = trip.owner_id === user.id;
    let hasAccess = isOwner;

    if (!isOwner) {
      const { data: member } = await supabase
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .single();

      hasAccess = !!member && ['owner', 'editor'].includes(member.role);
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Parser le body
    const body = await request.json();
    const { message } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message requis' }, { status: 400 });
    }

    // Extraire les données du voyage
    const tripData = trip.data as {
      preferences?: TripPreferences;
      days?: TripDay[];
      accommodation?: Accommodation;
      attractionPool?: unknown[];
    };
    const destination = tripData?.preferences?.destination || 'destination inconnue';
    const days: TripDay[] = tripData?.days || [];

    if (days.length === 0) {
      return NextResponse.json({
        reply: "Votre itinéraire est vide. Générez d'abord un voyage avant d'utiliser le chat.",
        intent: null,
        changes: null,
        previewDays: null,
        requiresConfirmation: false,
        warnings: [],
      });
    }

    // Construire le contexte complet pour les modifications avancées
    const tripModContext: TripModificationContext = {
      destination,
      startDate: tripData?.preferences?.startDate
        ? new Date(tripData.preferences.startDate)
        : days[0]?.date ? new Date(days[0].date) : new Date(),
      accommodation: tripData?.accommodation ? {
        name: tripData.accommodation.name,
        latitude: tripData.accommodation.latitude,
        longitude: tripData.accommodation.longitude,
        pricePerNight: tripData.accommodation.pricePerNight,
      } : null,
      durationDays: tripData?.preferences?.durationDays || days.length,
      attractionPool: (tripData?.attractionPool as import('@/lib/services/attractions').Attraction[]) || undefined,
    };

    // Récupérer l'historique récent pour le contexte conversationnel (5 paires = 10 messages)
    const { data: recentMessages } = await (supabase as any)
      .from('trip_chat_messages')
      .select('role, content, intent')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
      .limit(10);

    const conversationHistory = buildConversationContext(
      (recentMessages || []).reverse()
    );

    // Traiter le message avec le chatbot (avec contexte conversationnel)
    const response = await handleChatMessage(message, destination, days, tripModContext, conversationHistory);

    // Sauvegarder le message utilisateur dans l'historique
    // Note: Using 'any' cast because trip_chat_messages table is created by migration
    // and not yet in the generated Supabase types
    await (supabase as any).from('trip_chat_messages').insert({
      trip_id: tripId,
      user_id: user.id,
      role: 'user',
      content: message,
    });

    // Sauvegarder la réponse assistant
    await (supabase as any).from('trip_chat_messages').insert({
      trip_id: tripId,
      user_id: user.id,
      role: 'assistant',
      content: response.reply,
      intent: response.intent,
      changes_applied: null, // Sera mis à jour si l'utilisateur confirme
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors du traitement du message' },
      { status: 500 }
    );
  }
}

// GET - Récupérer l'historique
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Vérifier l'accès au voyage
    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, owner_id')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: 'Voyage non trouvé' }, { status: 404 });
    }

    // Vérifier accès
    const isOwner = trip.owner_id === user.id;
    let hasAccess = isOwner;

    if (!isOwner) {
      const { data: member } = await supabase
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .single();

      hasAccess = !!member;
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Récupérer les messages (derniers 50)
    // Note: Using 'any' cast because trip_chat_messages table is created by migration
    const { data: messages, error } = await (supabase as any)
      .from('trip_chat_messages')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[Chat API] Error fetching messages:', error);
      return NextResponse.json({ error: 'Erreur lors de la récupération des messages' }, { status: 500 });
    }

    // Transformer en format ChatMessage
    interface ChatMessageRow {
      id: string;
      trip_id: string;
      user_id: string;
      role: string;
      content: string;
      intent: unknown;
      changes_applied: unknown;
      created_at: string;
    }

    const chatMessages: ChatMessage[] = (messages || []).map((m: ChatMessageRow) => ({
      id: m.id,
      tripId: m.trip_id,
      userId: m.user_id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      intent: m.intent,
      changesApplied: m.changes_applied,
      createdAt: new Date(m.created_at),
    }));

    return NextResponse.json({ messages: chatMessages });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération des messages' },
      { status: 500 }
    );
  }
}

// ============================================
// Helpers
// ============================================

interface RecentMessageRow {
  role: string;
  content: string;
  intent: { type?: string } | null;
}

/**
 * Construit un résumé conversationnel compact à partir des messages récents.
 * Regroupe les messages par paires user/assistant pour le contexte.
 */
function buildConversationContext(messages: RecentMessageRow[]): ConversationContext {
  const exchanges: ConversationContext['recentExchanges'] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const next = messages[i + 1];

    if (msg.role === 'user' && next.role === 'assistant') {
      exchanges.push({
        userMessage: msg.content.slice(0, 200), // Tronquer pour économiser les tokens
        assistantReply: next.content.slice(0, 200),
        intent: next.intent?.type || undefined,
      });
      i++; // Skip le message assistant déjà traité
    }
  }

  // Garder au maximum 5 échanges (les plus récents)
  return {
    recentExchanges: exchanges.slice(-5),
  };
}
