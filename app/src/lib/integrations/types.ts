export type IntegrationId =
  | 'supabase-auth'
  | 'supabase-data'
  | 'supabase-storage'
  | 'supabase-realtime'
  | 'stripe-billing'
  | 'revenuecat-billing'
  | 'apple-oauth'
  | 'google-oauth'
  | 'resend-email'
  | 'anthropic'
  | 'gemini'
  | 'google-places'
  | 'google-maps'
  | 'serpapi'
  | 'viator'
  | 'rapidapi-tripadvisor'
  | 'rapidapi-booking'
  | 'rapidapi-airbnb'
  | 'foursquare'
  | 'overpass'
  | 'nominatim'
  | 'wikimedia'
  | 'expo-sharing'
  | 'expo-calendar'
  | 'sentry'
  | 'firebase-push'
  | 'feature-flags';

export type IntegrationRuntime = 'shared' | 'server' | 'mobile_build';

export type IntegrationCategory =
  | 'auth'
  | 'billing'
  | 'provider'
  | 'social'
  | 'media'
  | 'device'
  | 'observability'
  | 'configuration';

export type IntegrationSurface =
  | 'web'
  | 'mobile'
  | 'backend'
  | 'auth'
  | 'billing'
  | 'generation'
  | 'social'
  | 'collaboration'
  | 'media'
  | 'notifications'
  | 'maps'
  | 'calendar'
  | 'sharing'
  | 'observability';

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type FailureCode =
  | 'auth_expired'
  | 'billing_refused'
  | 'provider_unavailable'
  | 'feature_flag_off'
  | 'sandbox_not_configured'
  | 'missing_env'
  | 'manual_verification_required'
  | 'unknown';

export type IntegrationProbeId =
  | 'anthropic'
  | 'gemini'
  | 'rapidapi_tripadvisor'
  | 'serpapi'
  | 'google_places'
  | 'overpass'
  | 'viator';

export interface IntegrationCheckDefinition {
  id: string;
  label: string;
  severity: CheckSeverity;
  automated: boolean;
  surfaces: IntegrationSurface[];
  expectedFailure?: FailureCode;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  label: string;
  runtime: IntegrationRuntime;
  category: IntegrationCategory;
  severity: CheckSeverity;
  owner: string;
  environments: Array<'prod' | 'sandbox'>;
  surfaces: IntegrationSurface[];
  routes: string[];
  configuration:
    | {
        type: 'env';
        requiredAllEnv?: string[];
        requiredAnyEnv?: string[];
        optionalEnv?: string[];
      }
    | {
        type: 'builtin';
        optionalEnv?: string[];
      }
    | {
        type: 'manual';
        notes: string;
      };
  fallback: {
    mode: 'required' | 'graceful' | 'provider_chain' | 'feature_flag';
    description: string;
  };
  probe?: IntegrationProbeId;
  checks: IntegrationCheckDefinition[];
  notes?: string;
}

export interface DependencyAnomaly {
  code: FailureCode;
  severity: CheckSeverity;
  message: string;
  logHint: string;
}

export interface DependencyHealthResult {
  id: IntegrationId;
  label: string;
  runtime: IntegrationRuntime;
  category: IntegrationCategory;
  severity: CheckSeverity;
  owner: string;
  surfaces: IntegrationSurface[];
  routes: string[];
  environments: Array<'prod' | 'sandbox'>;
  configured: boolean | null;
  reachable: boolean | null;
  authOk: boolean | null;
  fallbackOk: boolean | null;
  latencyMs: number | null;
  lastError: string | null;
  details: string | null;
  status: CheckStatus;
  checkMode: 'env_only' | 'probed' | 'manual';
  missingEnv: string[];
  anomalies: DependencyAnomaly[];
  checks: IntegrationCheckDefinition[];
  skipReason: string | null;
  notes?: string;
}

export interface DependencyHealthSummary {
  timestamp: string;
  mode: 'config_only' | 'deep';
  totals: {
    pass: number;
    warn: number;
    fail: number;
    skip: number;
  };
  criticalFailures: number;
  goNoGo: 'go' | 'caution' | 'no_go';
}

export interface DependencyHealthReport {
  summary: DependencyHealthSummary;
  integrations: DependencyHealthResult[];
}

export interface ExternalProbeResult {
  status: 'ok' | 'not_configured' | 'error' | 'quota_exceeded';
  error?: string;
  latencyMs?: number;
  details?: string;
}
