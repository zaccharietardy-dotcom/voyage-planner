import { integrationRegistry } from '@/lib/integrations/registry';
import {
  probeAnthropic,
  probeGemini,
  probeGooglePlaces,
  probeOverpass,
  probeRapidApiTripadvisor,
  probeSerpApi,
  probeViator,
} from '@/lib/integrations/providerProbes';
import type {
  CheckSeverity,
  CheckStatus,
  DependencyAnomaly,
  DependencyHealthReport,
  DependencyHealthResult,
  ExternalProbeResult,
  IntegrationDefinition,
  IntegrationProbeId,
} from '@/lib/integrations/types';

interface CollectDependencyHealthOptions {
  mode?: 'config_only' | 'deep';
}

const probeById: Record<IntegrationProbeId, () => Promise<ExternalProbeResult>> = {
  anthropic: probeAnthropic,
  gemini: probeGemini,
  google_places: probeGooglePlaces,
  overpass: probeOverpass,
  rapidapi_tripadvisor: probeRapidApiTripadvisor,
  serpapi: probeSerpApi,
  viator: probeViator,
};

const PLACEHOLDER_SNIPPETS = [
  'your-project.supabase.co',
  'your-public-anon-key',
  'admin@example.com',
];

function parseBooleanFlag(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  return raw === 'true' || raw === '1';
}

function hasConfiguredEnv(name: string): boolean {
  const value = process.env[name]?.trim();
  if (!value) return false;
  return !PLACEHOLDER_SNIPPETS.some((snippet) => value.includes(snippet));
}

function getMissingEnv(definition: IntegrationDefinition): string[] {
  if (definition.configuration.type !== 'env') return [];

  const missingAll = (definition.configuration.requiredAllEnv || []).filter((name) => !hasConfiguredEnv(name));
  const anyGroup = definition.configuration.requiredAnyEnv || [];
  const hasAny = anyGroup.length === 0 || anyGroup.some((name) => hasConfiguredEnv(name));

  if (!hasAny) {
    return [...missingAll, ...anyGroup];
  }

  return missingAll;
}

function getConfigured(definition: IntegrationDefinition): boolean | null {
  if (definition.runtime === 'mobile_build') return null;

  switch (definition.configuration.type) {
    case 'builtin':
      return true;
    case 'manual':
      return null;
    case 'env': {
      const missing = getMissingEnv(definition);
      return missing.length === 0;
    }
  }
}

function getFeatureFlagSkipReason(definition: IntegrationDefinition): string | null {
  const socialEnabled = parseBooleanFlag(process.env.NEXT_PUBLIC_ENABLE_SOCIAL_FEATURES, true);
  const premiumEnabled = parseBooleanFlag(process.env.NEXT_PUBLIC_ENABLE_PREMIUM_BILLING, true);
  const externalProvidersEnabled = parseBooleanFlag(process.env.NARAE_ENABLE_EXTERNAL_PROVIDERS, true);

  if ((definition.category === 'social' || definition.surfaces.includes('social')) && !socialEnabled) {
    return 'Social features disabled by flag';
  }
  if (definition.category === 'billing' && !premiumEnabled) {
    return 'Premium billing disabled by flag';
  }
  if (definition.category === 'provider' && !externalProvidersEnabled) {
    return 'External providers disabled by flag';
  }

  return null;
}

function fallbackIsOkay(definition: IntegrationDefinition, configured: boolean | null): boolean | null {
  switch (definition.fallback.mode) {
    case 'required':
      return configured;
    case 'graceful':
    case 'provider_chain':
    case 'feature_flag':
      return true;
  }
}

function severityToStatus(severity: CheckSeverity): CheckStatus {
  return severity === 'critical' || severity === 'high' ? 'fail' : 'warn';
}

function createAnomaly(
  code: DependencyAnomaly['code'],
  severity: CheckSeverity,
  message: string,
  logHint: string,
): DependencyAnomaly {
  return { code, severity, message, logHint };
}

function deriveAuthOkFromError(error: string | undefined): boolean | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('invalid') ||
    normalized.includes('denied')
  ) {
    return false;
  }
  return null;
}

function baseResult(definition: IntegrationDefinition, mode: 'config_only' | 'deep'): DependencyHealthResult {
  const configured = getConfigured(definition);
  const missingEnv = getMissingEnv(definition);
  const skipReason =
    definition.runtime === 'mobile_build'
      ? 'Requires mobile build/device validation'
      : definition.configuration.type === 'manual'
        ? definition.configuration.notes
        : getFeatureFlagSkipReason(definition);

  const anomalies: DependencyAnomaly[] = [];
  let status: CheckStatus = 'pass';
  let details: string | null = null;
  let checkMode: DependencyHealthResult['checkMode'] = 'env_only';

  if (definition.runtime === 'mobile_build' || definition.configuration.type === 'manual') {
    status = 'skip';
    checkMode = 'manual';
  }

  const featureFlagSkip = getFeatureFlagSkipReason(definition);
  if (featureFlagSkip) {
    status = 'skip';
    checkMode = definition.runtime === 'mobile_build' ? 'manual' : 'env_only';
    anomalies.push(
      createAnomaly(
        'feature_flag_off',
        'medium',
        featureFlagSkip,
        `Feature-flag gate for ${definition.id} is active.`,
      ),
    );
    details = featureFlagSkip;
  }

  if (configured === false) {
    status = severityToStatus(definition.severity);
    anomalies.push(
      createAnomaly(
        definition.environments.includes('sandbox') ? 'sandbox_not_configured' : 'missing_env',
        definition.severity,
        `Missing environment variables: ${missingEnv.join(', ')}`,
        `Check environment configuration for ${definition.id}.`,
      ),
    );
    details = `Missing env: ${missingEnv.join(', ')}`;
  } else if (status === 'pass') {
    details = mode === 'deep' && definition.probe
      ? 'Waiting for live probe'
      : definition.configuration.type === 'builtin'
        ? 'Built-in dependency; no env required'
        : 'Env configuration present';
  }

  return {
    id: definition.id,
    label: definition.label,
    runtime: definition.runtime,
    category: definition.category,
    severity: definition.severity,
    owner: definition.owner,
    surfaces: definition.surfaces,
    routes: definition.routes,
    environments: definition.environments,
    configured,
    reachable: null,
    authOk: null,
    fallbackOk: fallbackIsOkay(definition, configured),
    latencyMs: null,
    lastError: null,
    details,
    status,
    checkMode,
    missingEnv,
    anomalies,
    checks: definition.checks,
    skipReason: skipReason || null,
    notes: definition.notes,
  };
}

function applyProbeResult(
  result: DependencyHealthResult,
  definition: IntegrationDefinition,
  probe: ExternalProbeResult,
): DependencyHealthResult {
  if (probe.status === 'not_configured') {
    return {
      ...result,
      status: severityToStatus(definition.severity),
      configured: false,
      details: result.details || 'Probe reports integration is not configured',
    };
  }

  if (probe.status === 'ok') {
    return {
      ...result,
      reachable: true,
      authOk: true,
      latencyMs: probe.latencyMs ?? null,
      lastError: null,
      details: probe.details || 'Probe succeeded',
      status: result.status === 'skip' ? 'skip' : 'pass',
      checkMode: 'probed',
    };
  }

  if (probe.status === 'quota_exceeded') {
    return {
      ...result,
      reachable: true,
      authOk: true,
      latencyMs: probe.latencyMs ?? null,
      lastError: probe.error || 'Quota exceeded',
      details: probe.details || 'Provider quota exceeded',
      status: 'warn',
      checkMode: 'probed',
      anomalies: [
        ...result.anomalies,
        createAnomaly(
          'provider_unavailable',
          definition.severity === 'critical' ? 'high' : definition.severity,
          probe.error || 'Provider quota exceeded',
          `Inspect quota/credits for ${definition.id}.`,
        ),
      ],
    };
  }

  return {
    ...result,
    reachable: result.runtime === 'server' ? false : result.reachable,
    authOk: deriveAuthOkFromError(probe.error),
    latencyMs: probe.latencyMs ?? null,
    lastError: probe.error || 'Unknown provider probe error',
    details: probe.details || 'Provider probe failed',
    status: 'fail',
    checkMode: 'probed',
    anomalies: [
      ...result.anomalies,
      createAnomaly(
        'provider_unavailable',
        definition.severity,
        probe.error || 'Unknown provider probe error',
        `Inspect provider logs and key restrictions for ${definition.id}.`,
      ),
    ],
  };
}

function summarize(results: DependencyHealthResult[], mode: 'config_only' | 'deep'): DependencyHealthReport['summary'] {
  const totals = {
    pass: results.filter((result) => result.status === 'pass').length,
    warn: results.filter((result) => result.status === 'warn').length,
    fail: results.filter((result) => result.status === 'fail').length,
    skip: results.filter((result) => result.status === 'skip').length,
  };

  const criticalFailures = results.filter(
    (result) => result.status === 'fail' && result.severity === 'critical',
  ).length;

  let goNoGo: DependencyHealthReport['summary']['goNoGo'] = 'go';
  if (criticalFailures > 0) goNoGo = 'no_go';
  else if (totals.warn > 0 || totals.skip > 0) goNoGo = 'caution';

  return {
    timestamp: new Date().toISOString(),
    mode,
    totals,
    criticalFailures,
    goNoGo,
  };
}

export async function collectDependencyHealth(
  options: CollectDependencyHealthOptions = {},
): Promise<DependencyHealthReport> {
  const mode = options.mode || 'config_only';

  const integrations = await Promise.all(
    integrationRegistry.map(async (definition) => {
      const result = baseResult(definition, mode);

      if (
        mode !== 'deep' ||
        !definition.probe ||
        result.status === 'skip' ||
        result.configured !== true
      ) {
        return result;
      }

      const probe = await probeById[definition.probe]();
      return applyProbeResult(result, definition, probe);
    }),
  );

  return {
    summary: summarize(integrations, mode),
    integrations,
  };
}
