const DEFAULT_SITE_URL = 'https://naraevoyage.com';

function readEnv(name: string, options?: { defaultValue?: string; optional?: boolean }): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value;
  if (options?.defaultValue !== undefined) return options.defaultValue;
  if (options?.optional) return '';

  throw new Error(`[env] Missing required environment variable: ${name}`);
}

function readUrlEnv(name: string, options?: { defaultValue?: string; optional?: boolean }): string {
  const value = readEnv(name, options);
  if (!value) return value;

  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`[env] ${name} must be a valid URL`);
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
