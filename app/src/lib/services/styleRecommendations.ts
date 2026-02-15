import { UserPreferences } from '@/lib/supabase/types';
import { Trip, ActivityType } from '@/lib/types';

/**
 * Weight distribution for activity categories based on travel style and favorite activities
 */
interface ActivityWeights {
  culture: number;
  nature: number;
  gastronomy: number;
  adventure: number;
  wellness: number;
  nightlife: number;
  shopping: number;
  beach: number;
}

interface StyleRecommendation {
  activityWeights: ActivityWeights;
  suggestedPace: 'relaxed' | 'moderate' | 'intense';
  mealBudgetMultiplier: number;
  recommendedActivitiesPerDay: number;
  tips: string[];
}

/**
 * Base weights for each travel style
 */
const STYLE_BASE_WEIGHTS: Record<string, ActivityWeights> = {
  cultural: {
    culture: 0.5,
    nature: 0.1,
    gastronomy: 0.15,
    adventure: 0.05,
    wellness: 0.05,
    nightlife: 0.05,
    shopping: 0.05,
    beach: 0.05,
  },
  relaxed: {
    culture: 0.1,
    nature: 0.25,
    gastronomy: 0.15,
    adventure: 0.05,
    wellness: 0.25,
    nightlife: 0.0,
    shopping: 0.05,
    beach: 0.15,
  },
  adventurous: {
    culture: 0.1,
    nature: 0.3,
    gastronomy: 0.1,
    adventure: 0.4,
    wellness: 0.0,
    nightlife: 0.05,
    shopping: 0.0,
    beach: 0.05,
  },
  party: {
    culture: 0.1,
    nature: 0.05,
    gastronomy: 0.2,
    adventure: 0.05,
    wellness: 0.05,
    nightlife: 0.45,
    shopping: 0.05,
    beach: 0.05,
  },
  balanced: {
    culture: 0.2,
    nature: 0.15,
    gastronomy: 0.15,
    adventure: 0.15,
    wellness: 0.1,
    nightlife: 0.1,
    shopping: 0.05,
    beach: 0.1,
  },
};

/**
 * Map favorite activities to activity weight categories
 */
const ACTIVITY_CATEGORY_MAP: Record<string, keyof ActivityWeights> = {
  museums: 'culture',
  monuments: 'culture',
  nature: 'nature',
  beaches: 'beach',
  hiking: 'adventure',
  shopping: 'shopping',
  nightlife: 'nightlife',
  food_tours: 'gastronomy',
  sports: 'adventure',
  wellness: 'wellness',
  photography: 'culture',
  local_experiences: 'culture',
};

/**
 * Generate style-based recommendations for trip planning
 */
export function getStyleRecommendations(
  preferences: UserPreferences,
  destination: string
): StyleRecommendation {
  // Start with base weights from travel style
  const baseWeights = STYLE_BASE_WEIGHTS[preferences.travel_style] || STYLE_BASE_WEIGHTS.balanced;
  const activityWeights = { ...baseWeights };

  // Boost weights based on favorite activities (add 0.15 per matching activity)
  if (preferences.favorite_activities && preferences.favorite_activities.length > 0) {
    preferences.favorite_activities.forEach((activity) => {
      const category = ACTIVITY_CATEGORY_MAP[activity];
      if (category) {
        activityWeights[category] = Math.min(activityWeights[category] + 0.15, 1.0);
      }
    });

    // Normalize weights to sum to 1.0
    const total = Object.values(activityWeights).reduce((sum, w) => sum + w, 0);
    Object.keys(activityWeights).forEach((key) => {
      activityWeights[key as keyof ActivityWeights] /= total;
    });
  }

  // Determine recommended activities per day based on pace
  const activitiesPerDay = {
    relaxed: 3,
    moderate: 5,
    intense: 7,
  }[preferences.pace_preference];

  // Meal budget multiplier based on budget preference
  const mealBudgetMultiplier = {
    budget: 0.7,
    moderate: 1.0,
    comfort: 1.4,
    luxury: 2.0,
  }[preferences.budget_preference];

  // Generate personalized tips
  const tips: string[] = [];

  if (preferences.pace_preference === 'relaxed') {
    tips.push('Prévoyez des pauses entre les activités pour profiter sans stress.');
  } else if (preferences.pace_preference === 'intense') {
    tips.push('Organisez vos visites par zone pour optimiser vos déplacements.');
  }

  if (preferences.budget_preference === 'budget') {
    tips.push('Privilégiez les attractions gratuites et les marchés locaux.');
  } else if (preferences.budget_preference === 'luxury') {
    tips.push('Réservez vos expériences premium à l\'avance pour garantir la disponibilité.');
  }

  if (preferences.wake_up_time === 'early') {
    tips.push('Profitez des matinées pour visiter les sites populaires avant la foule.');
  } else if (preferences.wake_up_time === 'late') {
    tips.push('Les activités de fin de matinée et après-midi seront privilégiées.');
  }

  if (preferences.favorite_activities.includes('food_tours')) {
    tips.push('Explorez les marchés et quartiers gastronomiques de la ville.');
  }

  if (preferences.favorite_activities.includes('photography')) {
    tips.push('Les horaires golden hour (lever/coucher du soleil) sont idéaux pour vos photos.');
  }

  return {
    activityWeights,
    suggestedPace: preferences.pace_preference,
    mealBudgetMultiplier,
    recommendedActivitiesPerDay: activitiesPerDay,
    tips,
  };
}

/**
 * Analyze generated trip vs user preferences and provide personalized feedback
 */
export function personalizeTrip(trip: Trip, preferences: UserPreferences): {
  suggestions: string[];
  warnings: string[];
  strengths: string[];
} {
  const suggestions: string[] = [];
  const warnings: string[] = [];
  const strengths: string[] = [];

  // Calculate average activities per day
  const totalActivities = trip.days.reduce(
    (sum, day) => sum + day.items.filter((item) => item.type === 'activity').length,
    0
  );
  const avgActivitiesPerDay = totalActivities / trip.days.length;

  // Check pace alignment
  const expectedActivities = {
    relaxed: 3,
    moderate: 5,
    intense: 7,
  }[preferences.pace_preference];

  if (avgActivitiesPerDay > expectedActivities + 2) {
    warnings.push(
      `Ce voyage inclut en moyenne ${Math.round(avgActivitiesPerDay)} activités par jour. Vous préférez un rythme ${preferences.pace_preference === 'relaxed' ? 'détendu' : 'modéré'}. Voulez-vous ajouter plus de pauses ?`
    );
  } else if (avgActivitiesPerDay < expectedActivities - 1) {
    suggestions.push(
      `Vous pourriez ajouter quelques activités supplémentaires selon vos préférences de rythme.`
    );
  } else {
    strengths.push('Le rythme du voyage correspond parfaitement à vos préférences.');
  }

  // Check activity types alignment
  const activityTypes = trip.days.flatMap((day) =>
    day.items.filter((item) => item.type === 'activity').map((item) => item.title.toLowerCase())
  );

  const hasCulture = activityTypes.some((t) =>
    ['musée', 'museum', 'cathédrale', 'palais', 'monument'].some((k) => t.includes(k))
  );
  const hasNature = activityTypes.some((t) =>
    ['parc', 'jardin', 'plage', 'beach', 'nature'].some((k) => t.includes(k))
  );
  const hasGastronomy = activityTypes.some((t) =>
    ['marché', 'market', 'food', 'cuisine'].some((k) => t.includes(k))
  );

  if (preferences.favorite_activities.includes('museums') && !hasCulture) {
    suggestions.push('Ajoutez des musées ou monuments historiques selon vos préférences.');
  } else if (hasCulture && preferences.favorite_activities.includes('museums')) {
    strengths.push('Le voyage inclut des visites culturelles qui vous plairont.');
  }

  if (preferences.favorite_activities.includes('nature') && !hasNature) {
    suggestions.push('Incluez une visite de parc ou espace naturel.');
  } else if (hasNature && preferences.favorite_activities.includes('nature')) {
    strengths.push('Les espaces verts et naturels sont bien représentés.');
  }

  if (preferences.favorite_activities.includes('food_tours') && !hasGastronomy) {
    suggestions.push('Ajoutez un tour gastronomique ou la visite d\'un marché local.');
  } else if (hasGastronomy && preferences.favorite_activities.includes('food_tours')) {
    strengths.push('Les expériences culinaires correspondent à vos goûts.');
  }

  // Check budget alignment
  if (trip.totalEstimatedCost && trip.preferences.budgetCustom) {
    const budgetPerPerson = trip.totalEstimatedCost / (trip.preferences.groupSize || 1);
    const targetBudget = trip.preferences.budgetIsPerPerson
      ? trip.preferences.budgetCustom
      : trip.preferences.budgetCustom / (trip.preferences.groupSize || 1);

    if (budgetPerPerson > targetBudget * 1.2) {
      warnings.push(
        `Le budget estimé (${Math.round(budgetPerPerson)}€/pers) dépasse votre budget cible. Considérez des alternatives économiques.`
      );
    } else if (budgetPerPerson <= targetBudget * 1.1) {
      strengths.push('Le budget du voyage est aligné avec vos attentes.');
    }
  }

  return { suggestions, warnings, strengths };
}

/**
 * Calculate how well a destination matches user preferences (0-100%)
 */
export function getDestinationMatch(
  destination: string,
  preferences: UserPreferences
): {
  score: number;
  breakdown: Record<string, { score: number; stars: number }>;
  explanation: string;
} {
  // Destination profiles (simplified heuristic - in production could use a database)
  const destinationProfiles: Record<
    string,
    { culture: number; nature: number; gastronomy: number; beach: number; nightlife: number; shopping: number }
  > = {
    paris: { culture: 95, nature: 60, gastronomy: 95, beach: 10, nightlife: 85, shopping: 90 },
    tokyo: { culture: 90, nature: 70, gastronomy: 95, beach: 30, nightlife: 80, shopping: 95 },
    rome: { culture: 95, nature: 50, gastronomy: 90, beach: 20, nightlife: 70, shopping: 75 },
    barcelona: { culture: 85, nature: 65, gastronomy: 85, beach: 90, nightlife: 90, shopping: 80 },
    bali: { culture: 60, nature: 95, gastronomy: 70, beach: 95, nightlife: 60, shopping: 50 },
    london: { culture: 90, nature: 60, gastronomy: 80, beach: 10, nightlife: 85, shopping: 95 },
    'new york': { culture: 85, nature: 50, gastronomy: 90, beach: 30, nightlife: 95, shopping: 95 },
    marrakech: { culture: 85, nature: 60, gastronomy: 80, beach: 20, nightlife: 60, shopping: 90 },
  };

  const destKey = destination.toLowerCase();
  const profile = destinationProfiles[destKey] || {
    culture: 70,
    nature: 70,
    gastronomy: 70,
    beach: 50,
    nightlife: 70,
    shopping: 70,
  };

  // Get user's activity weights
  const recommendations = getStyleRecommendations(preferences, destination);
  const weights = recommendations.activityWeights;

  // Calculate weighted score
  const scores = {
    culture: profile.culture * weights.culture,
    nature: profile.nature * weights.nature,
    gastronomy: profile.gastronomy * weights.gastronomy,
    beach: profile.beach * weights.beach,
    nightlife: profile.nightlife * weights.nightlife,
    shopping: profile.shopping * weights.shopping,
  };

  const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
  const totalWeight = weights.culture + weights.nature + weights.gastronomy + weights.beach + weights.nightlife + weights.shopping;
  const normalizedScore = Math.round((totalScore / totalWeight) * 100) / 100;

  // Create breakdown with star ratings
  const breakdown: Record<string, { score: number; stars: number }> = {};
  Object.keys(scores).forEach((key) => {
    const categoryScore = profile[key as keyof typeof profile];
    breakdown[key] = {
      score: categoryScore,
      stars: Math.round((categoryScore / 100) * 5),
    };
  });

  // Generate explanation
  const topCategories = Object.entries(breakdown)
    .filter(([_, data]) => data.stars >= 4)
    .map(([cat]) => cat);

  const weakCategories = Object.entries(breakdown)
    .filter(([_, data]) => data.stars <= 2)
    .map(([cat]) => cat);

  const categoryLabels: Record<string, string> = {
    culture: 'culture',
    nature: 'nature',
    gastronomy: 'gastronomie',
    beach: 'plage',
    nightlife: 'vie nocturne',
    shopping: 'shopping',
  };

  let explanation = `${destination} correspond à ${Math.round(normalizedScore)}% de vos goûts`;

  if (topCategories.length > 0) {
    const topLabels = topCategories.map((c) => categoryLabels[c]).join(', ');
    explanation += `: excellent pour ${topLabels}`;
  }

  if (weakCategories.length > 0 && weakCategories.length < 3) {
    const weakLabels = weakCategories.map((c) => categoryLabels[c]).join(', ');
    explanation += `, moins adapté pour ${weakLabels}`;
  }

  return {
    score: Math.round(normalizedScore),
    breakdown,
    explanation,
  };
}
