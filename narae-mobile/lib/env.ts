const DEFAULT_SITE_URL = 'https://naraevoyage.com';

// Hardcoded fallbacks for production builds where process.env may not be inlined
const FALLBACKS: Record<string, string> = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://mptiygdqoswzkzhewaqp.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wdGl5Z2Rxb3N3emt6aGV3YXFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0OTY2OTQsImV4cCI6MjA4NTA3MjY5NH0.hG7iNJz8U_R8FLD-xzdgroltBFdr56Swrh_V7r1KjdU',
  EXPO_PUBLIC_SITE_URL: DEFAULT_SITE_URL,
};

function readEnv(name: string, options?: { defaultValue?: string; optional?: boolean }): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value;
  if (FALLBACKS[name]) return FALLBACKS[name];
  if (options?.defaultValue !== undefined) return options.defaultValue;
  if (options?.optional) return '';
  // Don't throw — return empty string to avoid crash in production
  console.warn(`[env] Missing environment variable: ${name}`);
  return '';
}

function readUrlEnv(name: string, options?: { defaultValue?: string; optional?: boolean }): string {
  const value = readEnv(name, options);
  if (!value) return value;

  try {
    new URL(value);
    return value;
  } catch {
    console.warn(`[env] ${name} is not a valid URL: ${value}`);
    return '';
  }
}

export const appEnv = {
  EXPO_PUBLIC_SITE_URL: readUrlEnv('EXPO_PUBLIC_SITE_URL', { defaultValue: DEFAULT_SITE_URL }),
  EXPO_PUBLIC_SUPABASE_URL: readUrlEnv('EXPO_PUBLIC_SUPABASE_URL'),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  EXPO_PUBLIC_ENABLE_SOCIAL_FEATURES: readEnv('EXPO_PUBLIC_ENABLE_SOCIAL_FEATURES', { defaultValue: 'true' }),
  EXPO_PUBLIC_ENABLE_PREMIUM_BILLING: readEnv('EXPO_PUBLIC_ENABLE_PREMIUM_BILLING', { defaultValue: 'true' }),
  EXPO_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES: readEnv('EXPO_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES', { defaultValue: 'false' }),
  EXPO_PUBLIC_ENABLE_EXTERNAL_PROVIDERS: readEnv('EXPO_PUBLIC_ENABLE_EXTERNAL_PROVIDERS', { defaultValue: 'true' }),
};
