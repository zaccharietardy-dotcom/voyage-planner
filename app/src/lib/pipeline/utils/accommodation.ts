import type { Accommodation, BudgetStrategy } from '../../types';
import type { MealAssignment } from '../types';

const KITCHEN_KEYWORDS = [
  'kitchen',
  'kitchenette',
  'cuisine',
  'cuisinette',
  'coin cuisine',
  'self catering',
  'self-catering',
  'cooking facilities',
  'stove',
  'stovetop',
  'hob',
  'oven',
  'microwave',
  'fridge',
  'refrigerator',
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function accommodationHasKitchen(accommodation: Accommodation | null | undefined): boolean {
  if (!accommodation) return false;

  if (accommodation.type === 'apartment') return true;

  const searchable = [
    accommodation.name || '',
    accommodation.description || '',
    ...(accommodation.amenities || []),
  ]
    .map((value) => normalizeText(String(value || '')))
    .join(' ');

  if (!searchable) return false;
  return KITCHEN_KEYWORDS.some((keyword) => searchable.includes(keyword));
}

export function budgetStrategyRequestsSelfCatering(strategy: BudgetStrategy | null | undefined): boolean {
  if (!strategy?.mealsStrategy) return false;
  return Object.values(strategy.mealsStrategy).some((mode) => mode === 'self_catered');
}

export function sanitizeBudgetStrategyForKitchen(
  strategy: BudgetStrategy | null | undefined,
  hasKitchen: boolean
): { strategy: BudgetStrategy | null | undefined; adjusted: boolean } {
  if (!strategy || hasKitchen || !budgetStrategyRequestsSelfCatering(strategy)) {
    return { strategy, adjusted: false };
  }

  return {
    adjusted: true,
    strategy: {
      ...strategy,
      mealsStrategy: {
        breakfast: strategy.mealsStrategy.breakfast === 'self_catered' ? 'restaurant' : strategy.mealsStrategy.breakfast,
        lunch: strategy.mealsStrategy.lunch === 'self_catered' ? 'restaurant' : strategy.mealsStrategy.lunch,
        dinner: strategy.mealsStrategy.dinner === 'self_catered' ? 'restaurant' : strategy.mealsStrategy.dinner,
      },
      groceryShoppingNeeded: false,
      reasoning: `${strategy.reasoning || ''} Cuisine maison désactivée (hébergement sans cuisine).`.trim(),
    },
  };
}

export function stripSelfCateredFallbacks(
  meals: MealAssignment[],
  hasKitchen: boolean
): { meals: MealAssignment[]; changed: number } {
  if (hasKitchen) return { meals, changed: 0 };

  let changed = 0;
  const sanitized = meals.map((meal) => {
    if (meal.fallbackMode !== 'self_catered') return meal;
    changed += 1;

    const alternatives = meal.restaurantAlternatives || [];
    const fallbackRestaurant = meal.restaurant || alternatives[0] || null;
    const remainingAlternatives = fallbackRestaurant
      ? alternatives.filter((candidate) => candidate.id !== fallbackRestaurant.id)
      : alternatives;

    return {
      ...meal,
      restaurant: fallbackRestaurant,
      restaurantAlternatives: remainingAlternatives,
      fallbackMode: undefined,
    };
  });

  return { meals: sanitized, changed };
}
