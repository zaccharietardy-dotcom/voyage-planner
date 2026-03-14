import destinations from '@/lib/data/destinationCostIndex.json';

export interface ExploreDestination {
  city: string;
  country: string;
  lat: number;
  lng: number;
  dailyCost: number;
  totalEstimate: number;
  category: string;
  affordable: boolean;
}

/**
 * Filter destinations by budget and duration
 */
export function filterDestinations(
  budget: number,
  durationDays: number,
  flightBudgetRatio: number = 0.35 // 35% of budget for flights
): ExploreDestination[] {
  const dailyBudget = (budget * (1 - flightBudgetRatio)) / durationDays;

  return (destinations as typeof destinations).map(dest => {
    const totalEstimate = dest.dailyCost * durationDays;
    return {
      ...dest,
      totalEstimate,
      affordable: dest.dailyCost <= dailyBudget,
    };
  }).sort((a, b) => a.dailyCost - b.dailyCost);
}
