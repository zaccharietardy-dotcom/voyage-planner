import { appEnv } from './env';

function parseBooleanFlag(value: string, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value === 'true' || value === '1';
}

export const mobileFeatureFlags = {
  social: parseBooleanFlag(appEnv.EXPO_PUBLIC_ENABLE_SOCIAL_FEATURES, true),
  premiumBilling: parseBooleanFlag(appEnv.EXPO_PUBLIC_ENABLE_PREMIUM_BILLING, true),
  experimentalSurfaces: parseBooleanFlag(appEnv.EXPO_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES, false),
  externalProviders: parseBooleanFlag(appEnv.EXPO_PUBLIC_ENABLE_EXTERNAL_PROVIDERS, true),
} as const;
