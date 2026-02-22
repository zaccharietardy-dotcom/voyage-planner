import dns from 'node:dns/promises';
import {
  fetchUrlWithSafeRedirects,
  isAllowedSocialHostname,
  validateSocialImportUrl,
} from '../socialMediaImport';

jest.mock('node:dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn(),
  },
}));

const lookupMock = dns.lookup as jest.Mock;

describe('socialMediaImport URL hardening', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: '142.250.190.14', family: 4 }]);
    jest.restoreAllMocks();
  });

  it('allows HTTPS URL on supported domain', async () => {
    await expect(
      validateSocialImportUrl('https://www.youtube.com/watch?v=abc123')
    ).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-HTTPS URL', async () => {
    await expect(
      validateSocialImportUrl('http://www.youtube.com/watch?v=abc123')
    ).rejects.toThrow('HTTPS');
  });

  it('rejects localhost and loopback IP hosts', async () => {
    await expect(
      validateSocialImportUrl('https://127.0.0.1/internal')
    ).rejects.toThrow('Domaine non autorisé');
    await expect(
      validateSocialImportUrl('https://[::1]/internal')
    ).rejects.toThrow('Domaine non autorisé');
    await expect(
      validateSocialImportUrl('https://localhost/internal')
    ).rejects.toThrow('Domaine non autorisé');
  });

  it('rejects supported domains resolved to private IP', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(
      validateSocialImportUrl('https://www.youtube.com/watch?v=abc123')
    ).rejects.toThrow('Hôte non autorisé');
  });

  it('returns a clear business error when DNS resolution fails', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(
      validateSocialImportUrl('https://www.youtube.com/watch?v=abc123')
    ).rejects.toThrow('Hôte non résolu');
  });

  it('rejects domains outside the strict allowlist', async () => {
    await expect(
      validateSocialImportUrl('https://example.com/travel-post')
    ).rejects.toThrow('Domaine non autorisé');
    expect(isAllowedSocialHostname('example.com')).toBe(false);
  });

  it('blocks redirects to disallowed hosts', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/private' },
      })
    );

    await expect(
      fetchUrlWithSafeRedirects('https://www.youtube.com/watch?v=abc123')
    ).rejects.toThrow('Domaine non autorisé');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
