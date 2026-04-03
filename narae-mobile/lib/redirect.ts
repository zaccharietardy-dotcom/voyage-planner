export function getSafeRedirectPath(
  rawRedirect: string | string[] | undefined,
  fallback = '/(tabs)',
): string {
  const candidate = Array.isArray(rawRedirect) ? rawRedirect[0] : rawRedirect;
  if (!candidate) return fallback;
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//')) return fallback;
  if (candidate.includes('://')) return fallback;
  return candidate;
}
