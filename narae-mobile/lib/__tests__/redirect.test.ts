import { getSafeRedirectPath } from '@/lib/redirect';

describe('getSafeRedirectPath', () => {
  it('returns the fallback when redirect is missing', () => {
    expect(getSafeRedirectPath(undefined, '/plan')).toBe('/plan');
  });

  it('keeps in-app absolute paths', () => {
    expect(getSafeRedirectPath('/profile', '/plan')).toBe('/profile');
  });

  it('rejects external or malformed redirects', () => {
    expect(getSafeRedirectPath('https://evil.test', '/plan')).toBe('/plan');
    expect(getSafeRedirectPath('//evil.test', '/plan')).toBe('/plan');
    expect(getSafeRedirectPath('profile', '/plan')).toBe('/plan');
  });
});
