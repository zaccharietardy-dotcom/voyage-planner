import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { Database } from '@/lib/supabase/types';

type UserPreferencesInsert = Database['public']['Tables']['user_preferences']['Insert'];

export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      );
    }

    const { data: preferences, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching preferences:', error);
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des préférences' },
        { status: 500 }
      );
    }

    // Return null if no preferences found (new user)
    return NextResponse.json({ preferences: preferences || null });
  } catch (error) {
    console.error('Error in GET /api/user-preferences:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate and sanitize input
    const preferencesData: UserPreferencesInsert = {
      user_id: user.id,
      favorite_activities: body.favorite_activities || [],
      travel_style: body.travel_style || 'balanced',
      budget_preference: body.budget_preference || 'moderate',
      accommodation_preference: body.accommodation_preference || 'hotel',
      pace_preference: body.pace_preference || 'moderate',
      dietary_restrictions: body.dietary_restrictions || [],
      cuisine_preferences: body.cuisine_preferences || [],
      allergies: body.allergies || [],
      accessibility_needs: body.accessibility_needs || [],
      preferred_language: body.preferred_language || 'fr',
      preferred_currency: body.preferred_currency || 'EUR',
      wake_up_time: body.wake_up_time || 'normal',
    };

    // Check if preferences already exist
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('id')
      .eq('user_id', user.id)
      .single();

    let result;

    if (existing) {
      // Update existing preferences
      const { data, error } = await supabase
        .from('user_preferences')
        .update(preferencesData)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating preferences:', error);
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour des préférences' },
          { status: 500 }
        );
      }
      result = data;
    } else {
      // Insert new preferences
      const { data, error } = await supabase
        .from('user_preferences')
        .insert(preferencesData)
        .select()
        .single();

      if (error) {
        console.error('Error inserting preferences:', error);
        return NextResponse.json(
          { error: 'Erreur lors de la création des préférences' },
          { status: 500 }
        );
      }
      result = data;
    }

    return NextResponse.json({
      preferences: result,
      message: existing ? 'Préférences mises à jour' : 'Préférences créées'
    });
  } catch (error) {
    console.error('Error in POST /api/user-preferences:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
