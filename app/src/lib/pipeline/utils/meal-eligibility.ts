import { timeToMin } from './time';

export interface MealEligibilityInput {
  dayStartTime: string;
  dayEndTime: string;
  hasArrivalTransport: boolean;
  hasDepartureTransport: boolean;
  arrivalEndTime?: string;
  departureStartTime?: string;
}

export interface MealEligibility {
  hasUsableWindow: boolean;
  effectiveStartMin: number;
  effectiveEndMin: number;
  expectBreakfast: boolean;
  expectLunch: boolean;
  expectDinner: boolean;
}

/**
 * Shared meal expectation logic for scheduler + contracts.
 * Keeps meal eligibility decisions aligned across the pipeline.
 */
export function computeMealEligibility(input: MealEligibilityInput): MealEligibility {
  const twStartMin = timeToMin(input.dayStartTime || '00:00');
  const twEndMin = timeToMin(input.dayEndTime || '00:00');
  const hasUsableWindow = twEndMin > twStartMin;

  if (!hasUsableWindow) {
    return {
      hasUsableWindow: false,
      effectiveStartMin: twStartMin,
      effectiveEndMin: twEndMin,
      expectBreakfast: false,
      expectLunch: false,
      expectDinner: false,
    };
  }

  const arrivalBufferMin = input.arrivalEndTime ? timeToMin(input.arrivalEndTime) + 60 : twStartMin;
  const effectiveStartMin = Math.max(twStartMin, arrivalBufferMin);

  const departureCutoffMin = input.departureStartTime ? timeToMin(input.departureStartTime) : twEndMin;
  const effectiveEndMin = Math.min(twEndMin, departureCutoffMin);

  const dinnerThreshold = input.hasDepartureTransport ? 18 * 60 + 30 : 18 * 60;

  return {
    hasUsableWindow,
    effectiveStartMin,
    effectiveEndMin,
    expectBreakfast: !input.hasArrivalTransport && effectiveStartMin < 10 * 60,
    expectLunch: effectiveStartMin < 13 * 60 && effectiveEndMin > 12 * 60,
    expectDinner: effectiveEndMin >= dinnerThreshold,
  };
}
