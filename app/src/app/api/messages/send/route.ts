import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notifyMessage } from '@/lib/services/notifications';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/messages/send
export async function POST(request: Request) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { conversation_id, content } = await request.json();
    if (!conversation_id || !content?.trim()) {
      return NextResponse.json({ error: 'conversation_id et content requis' }, { status: 400 });
    }

    const sc = getServiceClient();

    // Verify user is participant
    const { data: participant } = await sc
      .from('conversation_participants')
      .select('conversation_id')
      .eq('conversation_id', conversation_id)
      .eq('user_id', user.id)
      .single();

    if (!participant) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    // Insert message
    const { data: message, error } = await sc
      .from('messages')
      .insert({
        conversation_id,
        sender_id: user.id,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update conversation timestamp
    await sc
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id);

    // Update sender's last_read_at
    await sc
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversation_id)
      .eq('user_id', user.id);

    // Notify other participants (non-blocking)
    const { data: others } = await sc
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversation_id)
      .neq('user_id', user.id);

    const { data: senderProfile } = await sc
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single();

    others?.forEach(o => {
      notifyMessage(user.id, o.user_id, senderProfile?.display_name || 'Quelqu\'un', conversation_id).catch(console.error);
    });

    return NextResponse.json(message);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
