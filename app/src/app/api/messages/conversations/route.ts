import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/messages/conversations - List user's conversations
export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const sc = getServiceClient();

    // Get conversation IDs where user participates
    const { data: participations } = await sc
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (!participations?.length) return NextResponse.json([]);

    const convIds = participations.map(p => p.conversation_id);
    const readMap: Record<string, string> = {};
    participations.forEach(p => { readMap[p.conversation_id] = p.last_read_at; });

    // Get other participants for each conversation
    const { data: allParticipants } = await sc
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds)
      .neq('user_id', user.id);

    const otherUserIds = [...new Set(allParticipants?.map(p => p.user_id) || [])];
    const profileMap: Record<string, any> = {};
    if (otherUserIds.length > 0) {
      const { data: profiles } = await sc
        .from('profiles')
        .select('id, display_name, avatar_url, username')
        .in('id', otherUserIds);
      profiles?.forEach(p => { profileMap[p.id] = p; });
    }

    // Get last message for each conversation
    const conversations = await Promise.all(convIds.map(async (convId) => {
      const { data: lastMsg } = await sc
        .from('messages')
        .select('id, content, sender_id, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Count unread
      const { count } = await sc
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', convId)
        .gt('created_at', readMap[convId] || '1970-01-01')
        .neq('sender_id', user.id);

      const otherUser = allParticipants?.find(p => p.conversation_id === convId);
      const otherProfile = otherUser ? profileMap[otherUser.user_id] : null;

      return {
        id: convId,
        other_user: otherProfile,
        last_message: lastMsg,
        unread_count: count || 0,
        updated_at: lastMsg?.created_at || readMap[convId],
      };
    }));

    // Sort by last message date
    conversations.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Conversations error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/messages/conversations - Create or find existing conversation with user
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { user_id: otherUserId } = await request.json();
    if (!otherUserId) return NextResponse.json({ error: 'user_id requis' }, { status: 400 });
    if (otherUserId === user.id) return NextResponse.json({ error: 'Impossible de s\'envoyer un message' }, { status: 400 });

    const sc = getServiceClient();

    // Check if conversation already exists between these two users
    const { data: myConvs } = await sc
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    const { data: theirConvs } = await sc
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUserId);

    const myConvIds = new Set(myConvs?.map(c => c.conversation_id) || []);
    const existing = theirConvs?.find(c => myConvIds.has(c.conversation_id));

    if (existing) {
      return NextResponse.json({ conversation_id: existing.conversation_id });
    }

    // Create new conversation
    const { data: conv, error } = await sc
      .from('conversations')
      .insert({})
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Add participants
    await sc.from('conversation_participants').insert([
      { conversation_id: conv.id, user_id: user.id },
      { conversation_id: conv.id, user_id: otherUserId },
    ]);

    return NextResponse.json({ conversation_id: conv.id });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
