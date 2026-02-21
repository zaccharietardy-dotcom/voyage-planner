import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Vérification d'authentification
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      );
    }

    const { events } = await request.json();

    if (!Array.isArray(events)) {
      return NextResponse.json({ error: 'Invalid events' }, { status: 400 });
    }

    // Log to server console for now — in production, this would go to a DB or analytics service
    console.log(`[Analytics] Received ${events.length} events:`,
      events.map((e: any) => `${e.name} (${e.path})`).join(', ')
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
