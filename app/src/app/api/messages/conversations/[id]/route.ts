import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/messages/conversations/[id] - Get messages + mark as read
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: convId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const sc = getServiceClient();

    // Verify user is participant
    const { data: participant } = await sc
      .from('conversation_participants')
      .select('conversation_id')
      .eq('conversation_id', convId)
      .eq('user_id', user.id)
      .single();

    if (!participant) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    // Get messages
    const { data: messages, error } = await sc
      .from('messages')
      .select('id, conversation_id, sender_id, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get profiles
    const senderIds = [...new Set(messages?.map(m => m.sender_id) || [])];
    let profileMap: Record<string, any> = {};
    if (senderIds.length > 0) {
      const { data: profiles } = await sc
        .from('profiles')
        .select('id, display_name, avatar_url, username')
        .in('id', senderIds);
      profiles?.forEach(p => { profileMap[p.id] = p; });
    }

    // Mark as read
    await sc
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('user_id', user.id);

    const enriched = messages?.map(m => ({
      ...m,
      sender: profileMap[m.sender_id] || { id: m.sender_id, display_name: null, avatar_url: null },
      is_mine: m.sender_id === user.id,
    })) || [];

    return NextResponse.json(enriched);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
