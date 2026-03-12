import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/reviews/[id]/helpful - Mark review as helpful
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: reviewId } = await params;
    const supabase = await createRouteHandlerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const serviceClient = getServiceClient();

    const { data, error } = await serviceClient
      .rpc('toggle_review_helpful_atomic', { p_review_id: reviewId, p_user_id: user.id });

    if (error) {
      if (error.message?.includes('REVIEW_NOT_FOUND')) {
        return NextResponse.json({ error: 'Avis non trouvé' }, { status: 404 });
      }
      console.error('Error in helpful toggle RPC:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const result = (data as { helpful: boolean; helpful_count: number }[] | null)?.[0];
    if (!result) {
      return NextResponse.json({ error: 'Réponse invalide du serveur' }, { status: 500 });
    }

    return NextResponse.json({ helpful: result.helpful, count: result.helpful_count });
  } catch (error) {
    console.error('Error in POST /api/reviews/[id]/helpful:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
