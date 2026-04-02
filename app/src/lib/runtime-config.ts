import { z } from 'zod';

const DEFAULT_SITE_URL = 'https://naraevoyage.com';
const INTERNAL_TOOL_ROUTES = new Set(['/admin', '/test-apis', '/test-links', '/test-trips']);

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().default(DEFAULT_SITE_URL),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.union([z.string().url(), z.literal('')]).optional(),
  NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT: z.string().optional(),
  NEXT_PUBLIC_ENABLE_FEEDBACK_WIDGET: z.string().optional(),
  NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES: z.string().optional(),
  NEXT_PUBLIC_ENABLE_PREMIUM_BILLING: z.string().optional(),
  NEXT_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES: z.string().optional(),
});

const serverEnvSchema = z.object({
  ADMIN_EMAILS: z.string().optional(),
  NARAE_ENABLE_INTERNAL_TOOLS: z.string().optional(),
  NARAE_ENABLE_EXTERNAL_PROVIDERS: z.string().optional(),
});

type PublicEnv = z.infer<typeof publicEnvSchema>;
type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedPublicEnv: PublicEnv | null = null;
let cachedServerEnv: ServerEnv | null = null;

function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

function parseEnv<T>(schema: z.ZodSchema<T>, raw: Record<string, string | undefined>, label: string): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join(', ');

  throw new Error(`[Env] Invalid ${label} configuration: ${issues}`);
}

export function getPublicEnv(): PublicEnv {
  if (!cachedPublicEnv) {
    cachedPublicEnv = parseEnv(
      publicEnvSchema,
      {
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
        NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT: process.env.NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT,
        NEXT_PUBLIC_ENABLE_FEEDBACK_WIDGET: process.env.NEXT_PUBLIC_ENABLE_FEEDBACK_WIDGET,
        NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES: process.env.NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES,
        NEXT_PUBLIC_ENABLE_PREMIUM_BILLING: process.env.NEXT_PUBLIC_ENABLE_PREMIUM_BILLING,
        NEXT_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES: process.env.NEXT_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES,
      },
      'public',
    );
  }

  return cachedPublicEnv;
}

export function getServerEnv(): ServerEnv {
  if (!cachedServerEnv) {
    cachedServerEnv = parseEnv(
      serverEnvSchema,
      {
        ADMIN_EMAILS: process.env.ADMIN_EMAILS,
        NARAE_ENABLE_INTERNAL_TOOLS: process.env.NARAE_ENABLE_INTERNAL_TOOLS,
        NARAE_ENABLE_EXTERNAL_PROVIDERS: process.env.NARAE_ENABLE_EXTERNAL_PROVIDERS,
      },
      'server',
    );
  }

  return cachedServerEnv;
}

export function getAdminEmails(): Set<string> {
  const { ADMIN_EMAILS } = getServerEnv();
  return new Set(
    (ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasConfiguredSupabase(): boolean {
  const env = getPublicEnv();
  return !env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder.supabase.co')
    && env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== 'placeholder';
}

export function isInternalToolsEnabled(): boolean {
  return parseBooleanFlag(getServerEnv().NARAE_ENABLE_INTERNAL_TOOLS, false);
}

export function isExternalMarketingScriptEnabled(): boolean {
  return parseBooleanFlag(getPublicEnv().NEXT_PUBLIC_ENABLE_EXTERNAL_MARKETING_SCRIPT, false);
}

export function isFeedbackWidgetEnabled(): boolean {
  return parseBooleanFlag(getPublicEnv().NEXT_PUBLIC_ENABLE_FEEDBACK_WIDGET, true);
}

export function getPublicFeatureFlags() {
  const env = getPublicEnv();

  return {
    social: parseBooleanFlag(env.NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES, true),
    premiumBilling: parseBooleanFlag(env.NEXT_PUBLIC_ENABLE_PREMIUM_BILLING, true),
    experimentalSurfaces: parseBooleanFlag(env.NEXT_PUBLIC_ENABLE_EXPERIMENTAL_SURFACES, false),
  };
}

export function areExternalProvidersEnabled(): boolean {
  return parseBooleanFlag(getServerEnv().NARAE_ENABLE_EXTERNAL_PROVIDERS, true);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}

export function isInternalToolRoute(pathname: string): boolean {
  return INTERNAL_TOOL_ROUTES.has(pathname);
}

export { DEFAULT_SITE_URL, INTERNAL_TOOL_ROUTES };
