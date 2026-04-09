const PROVIDER_QUOTA_PATTERNS: RegExp[] = [
  /\bquota\b/i,
  /\bresource[_\s-]?exhausted\b/i,
  /\binsufficient[_\s-]?quota\b/i,
  /\brate[\s-]?limit/i,
  /\btoo many requests\b/i,
  /\b429\b/,
  /\bcredit(?:s)?\b.*\b(exhausted|depleted|insufficient)\b/i,
  /\bbilling\b.*\blimit\b/i,
  /\bprovider_quota_exceeded\b/i,
];

const BUDGET_STOP_PATTERNS: RegExp[] = [
  /\bbudget_over_burst_cap\b/i,
  /\bbudget[_\s-]?burst\b/i,
  /\bapi cost guard\b/i,
  /\bhard[_\s-]?cap\b/i,
];

const ADMISSION_BLOCK_PATTERNS: RegExp[] = [
  /\badmission[_\s-]?(cooldown|blocked|provider_not_ready|quality_live_daily_cap|dedupe_hit)\b/i,
  /\bcooldown_active\b/i,
  /\bquality_live_daily_cap\b/i,
  /\bprovider_not_ready\b/i,
];

const USER_SUBSCRIPTION_PATTERNS: RegExp[] = [
  /\bquota_exceeded\b/i,
  /voyage gratuit a ete utilise/i,
  /votre voyage gratuit a ete utilise/i,
  /passez a pro/i,
  /\brate_limit_exceeded\b/i,
  /trop de generations? recen/i,
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function isProviderQuotaLikeMessage(message: string): boolean {
  if (!message) return false;
  const text = normalizeText(message);
  return PROVIDER_QUOTA_PATTERNS.some((pattern) => pattern.test(text));
}

export function isBudgetStopLikeMessage(message: string): boolean {
  if (!message) return false;
  const text = normalizeText(message);
  return BUDGET_STOP_PATTERNS.some((pattern) => pattern.test(text));
}

export function isAdmissionBlockLikeMessage(message: string): boolean {
  if (!message) return false;
  const text = normalizeText(message);
  return ADMISSION_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
}

export function isUserQuotaLikeMessage(message: string): boolean {
  if (!message) return false;
  const text = normalizeText(message);
  return USER_SUBSCRIPTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isProviderQuotaLikeError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') return isProviderQuotaLikeMessage(error);
  if (error instanceof Error) {
    if (error.name === 'ProviderQuotaStopError') return true;
    if (isProviderQuotaLikeMessage(error.message)) return true;
    const reasonCode = (error as { reasonCode?: unknown }).reasonCode;
    if (typeof reasonCode === 'string' && reasonCode === 'provider_quota_exceeded') return true;
    const maybeStatus = (error as { status?: unknown }).status;
    if (typeof maybeStatus === 'number' && maybeStatus === 429) return true;
    return false;
  }

  try {
    const serialized = JSON.stringify(error);
    return isProviderQuotaLikeMessage(serialized);
  } catch {
    return false;
  }
}

export interface GenerationErrorClassification {
  code: 'USER_QUOTA_EXCEEDED' | 'PROVIDER_QUOTA_EXCEEDED' | 'BUDGET_OVER_BURST_CAP' | 'ADMISSION_BLOCKED' | 'UNKNOWN_ERROR';
  message: string;
  httpStatus: number;
}

export function classifyGenerationError(message: string): GenerationErrorClassification {
  if (isUserQuotaLikeMessage(message)) {
    return {
      code: 'USER_QUOTA_EXCEEDED',
      message: 'Votre quota de generation est atteint. Passez a Pro ou achetez un voyage pour continuer.',
      httpStatus: 403,
    };
  }
  if (isProviderQuotaLikeMessage(message)) {
    return {
      code: 'PROVIDER_QUOTA_EXCEEDED',
      message: 'Nos APIs partenaires sont temporairement en limite de quota. Reessaie dans 1 a 2 minutes.',
      httpStatus: 503,
    };
  }
  if (isBudgetStopLikeMessage(message)) {
    return {
      code: 'BUDGET_OVER_BURST_CAP',
      message: 'Generation arretee: budget API maximum atteint pour ce run. Reessaie plus tard.',
      httpStatus: 429,
    };
  }
  if (isAdmissionBlockLikeMessage(message)) {
    return {
      code: 'ADMISSION_BLOCKED',
      message: 'Generation temporairement bloquee (cooldown, dedupe, ou provider indisponible).',
      httpStatus: 429,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message,
    httpStatus: 500,
  };
}
