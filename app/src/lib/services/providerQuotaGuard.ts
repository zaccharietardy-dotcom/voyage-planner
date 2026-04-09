type RequiredProvider =
  | 'gemini'
  | 'serpapi'
  | 'google_places'
  | 'google_maps'
  | 'viator'
  | 'rapidapi'
  | 'anthropic';

interface ProviderQuotaGuardState {
  stopImmediate: boolean;
  requiredProviders: Set<RequiredProvider>;
  stopped: boolean;
  provider?: RequiredProvider;
  detail?: string;
  reasonCode?: string;
  triggeredAt?: string;
}

const DEFAULT_REQUIRED_PROVIDERS: RequiredProvider[] = [
  'gemini',
  'serpapi',
  'google_places',
];

const state: ProviderQuotaGuardState = {
  stopImmediate: true,
  requiredProviders: new Set(DEFAULT_REQUIRED_PROVIDERS),
  stopped: false,
};

export class ProviderQuotaStopError extends Error {
  readonly reasonCode = 'provider_quota_exceeded';
  readonly provider: RequiredProvider;
  readonly detail?: string;

  constructor(provider: RequiredProvider, detail?: string) {
    super(`[ProviderQuotaStop] ${provider}${detail ? `: ${detail}` : ''}`);
    this.name = 'ProviderQuotaStopError';
    this.provider = provider;
    this.detail = detail;
  }
}

export function configureProviderQuotaGuard(options?: {
  stopImmediate?: boolean;
  requiredProviders?: RequiredProvider[];
}): void {
  if (typeof options?.stopImmediate === 'boolean') {
    state.stopImmediate = options.stopImmediate;
  }
  if (Array.isArray(options?.requiredProviders) && options.requiredProviders.length > 0) {
    state.requiredProviders = new Set(options.requiredProviders);
  }
}

export function resetProviderQuotaGuard(): void {
  state.stopped = false;
  state.provider = undefined;
  state.detail = undefined;
  state.reasonCode = undefined;
  state.triggeredAt = undefined;
}

export function getProviderQuotaGuardState(): {
  stopImmediate: boolean;
  requiredProviders: string[];
  stopped: boolean;
  provider?: string;
  detail?: string;
  reasonCode?: string;
  triggeredAt?: string;
} {
  return {
    stopImmediate: state.stopImmediate,
    requiredProviders: Array.from(state.requiredProviders),
    stopped: state.stopped,
    provider: state.provider,
    detail: state.detail,
    reasonCode: state.reasonCode,
    triggeredAt: state.triggeredAt,
  };
}

export function reportProviderQuotaExceeded(provider: RequiredProvider, detail?: string): void {
  if (!state.stopImmediate) return;
  if (!state.requiredProviders.has(provider)) return;

  state.stopped = true;
  state.provider = provider;
  state.detail = detail;
  state.reasonCode = 'provider_quota_exceeded';
  state.triggeredAt = new Date().toISOString();

  throw new ProviderQuotaStopError(provider, detail);
}

export function isProviderQuotaStopError(error: unknown): error is ProviderQuotaStopError {
  return error instanceof ProviderQuotaStopError;
}
