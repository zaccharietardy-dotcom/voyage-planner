import { z } from 'zod';

const coordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const generateTripSchema = z.object({
  // Required
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  startDate: z.string().min(1), // ISO date string, converted to Date downstream
  durationDays: z.number().int().min(1).max(30),
  transport: z.enum(['optimal', 'plane', 'train', 'car', 'bus']),
  carRental: z.boolean(),
  groupSize: z.number().int().min(1).max(20),
  groupType: z.enum(['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids']),
  budgetLevel: z.enum(['economic', 'moderate', 'comfort', 'luxury']),
  activities: z.array(z.enum(['beach', 'nature', 'culture', 'gastronomy', 'nightlife', 'shopping', 'adventure', 'wellness'])),
  dietary: z.array(z.enum(['none', 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free'])),
  mustSee: z.string().max(2000).default(''),

  // Optional
  originCoords: coordsSchema.optional(),
  destinationCoords: coordsSchema.optional(),
  budgetCustom: z.number().min(0).max(100000).optional(),
  budgetIsPerPerson: z.boolean().optional(),
  mealPreference: z.enum(['auto', 'mostly_cooking', 'mostly_restaurants', 'balanced']).optional(),
  pace: z.enum(['relaxed', 'moderate', 'intensive']).optional(),
  tripMode: z.enum(['precise', 'inspired']).optional(),
  prePurchasedTickets: z.array(z.object({
    name: z.string().min(1).max(200),
    date: z.string().optional(),
    notes: z.string().max(500).optional(),
  })).optional(),
  cityPlan: z.array(z.object({
    city: z.string().min(1).max(200),
    days: z.number().int().min(1).max(30),
  })).optional(),
  homeAddress: z.string().max(300).optional(),
  homeCoords: coordsSchema.optional(),
  preferredAirport: z.string().max(100).optional(),
  departureTimePreference: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
  needsParking: z.boolean().optional(),
});

export type GenerateTripInput = z.infer<typeof generateTripSchema>;
