import {
  classifyGenerationError,
  isProviderQuotaLikeMessage,
  isUserQuotaLikeMessage,
} from '../utils/quotaErrors';

describe('quotaErrors helpers', () => {
  it('detects provider quota/rate-limit messages', () => {
    expect(isProviderQuotaLikeMessage('The quota has been exceeded')).toBe(true);
    expect(isProviderQuotaLikeMessage('RESOURCE_EXHAUSTED by upstream provider')).toBe(true);
    expect(isProviderQuotaLikeMessage('HTTP 429 Too Many Requests')).toBe(true);
  });

  it('detects user subscription quota messages', () => {
    expect(isUserQuotaLikeMessage('QUOTA_EXCEEDED')).toBe(true);
    expect(isUserQuotaLikeMessage('Votre voyage gratuit a ete utilise')).toBe(true);
    expect(isUserQuotaLikeMessage('RATE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('classifies provider quota with retryable message', () => {
    const classified = classifyGenerationError('The quota has been exceeded');
    expect(classified.code).toBe('PROVIDER_QUOTA_EXCEEDED');
    expect(classified.httpStatus).toBe(503);
    expect(classified.message).toContain('limite de quota');
  });
});
