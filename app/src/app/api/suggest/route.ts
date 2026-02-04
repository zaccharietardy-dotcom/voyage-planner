import { NextRequest, NextResponse } from 'next/server';
import { generateDurationSuggestion, generateDestinationSuggestions } from '@/lib/services/suggestions';
import type { ActivityType, BudgetLevel, GroupType } from '@/lib/types';

export const maxDuration = 30; // 30 seconds max

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type } = body;

    if (type === 'duration') {
      const { destination, activities, budgetLevel, groupType } = body as {
        destination?: string;
        activities?: ActivityType[];
        budgetLevel?: BudgetLevel;
        groupType?: GroupType;
      };

      if (!destination) {
        return NextResponse.json(
          { error: 'Le champ destination est requis pour les suggestions de durée' },
          { status: 400 }
        );
      }

      const suggestion = await generateDurationSuggestion(destination, {
        activities,
        budgetLevel,
        groupType,
      });

      return NextResponse.json({ type: 'duration', duration: suggestion });
    }

    if (type === 'destination') {
      const { query, origin, activities, budgetLevel, groupType, durationDays } = body as {
        query?: string;
        origin?: string;
        activities?: ActivityType[];
        budgetLevel?: BudgetLevel;
        groupType?: GroupType;
        durationDays?: number;
      };

      if (!query) {
        return NextResponse.json(
          { error: 'Le champ query est requis pour les suggestions de destination' },
          { status: 400 }
        );
      }

      const suggestions = await generateDestinationSuggestions(query, {
        origin,
        activities,
        budgetLevel,
        groupType,
        durationDays,
      });

      return NextResponse.json({ type: 'destination', destinations: suggestions });
    }

    return NextResponse.json(
      { error: 'Type de suggestion invalide. Utilisez "duration" ou "destination".' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Suggest API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération des suggestions' },
      { status: 500 }
    );
  }
}
