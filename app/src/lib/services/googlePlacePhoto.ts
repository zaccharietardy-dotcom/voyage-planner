/**
 * Google Place photo helpers.
 * Centralizes URL generation so API keys never leak to client payloads.
 */

const GOOGLE_PLACE_PHOTO_HOST = 'maps.googleapis.com';
const GOOGLE_PLACE_PHOTO_PATH = '/maps/api/place/photo';
const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g;

export function buildPlacePhotoProxyUrl(photoReference: string, maxWidth: number = 800): string {
  const safeMaxWidth = Number.isFinite(maxWidth)
    ? Math.max(100, Math.min(1600, Math.round(maxWidth)))
    : 800;
  return `/api/place-photo?photo_reference=${encodeURIComponent(photoReference)}&maxwidth=${safeMaxWidth}`;
}

export function isGooglePlacePhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.host.includes(GOOGLE_PLACE_PHOTO_HOST) && url.pathname === GOOGLE_PLACE_PHOTO_PATH;
  } catch {
    return false;
  }
}

export function extractPlacePhotoReference(
  value: string
): { photoReference: string; maxWidth: number } | null {
  try {
    const url = new URL(value);
    if (!(url.host.includes(GOOGLE_PLACE_PHOTO_HOST) && url.pathname === GOOGLE_PLACE_PHOTO_PATH)) {
      return null;
    }
    const photoReference = url.searchParams.get('photoreference') || url.searchParams.get('photo_reference');
    if (!photoReference) return null;
    const rawMax = Number(url.searchParams.get('maxwidth') || url.searchParams.get('maxWidth') || '800');
    const maxWidth = Number.isFinite(rawMax) ? rawMax : 800;
    return { photoReference, maxWidth };
  } catch {
    return null;
  }
}

export function sanitizeGoogleMapsUrl(value: string): string {
  try {
    const parsedPhoto = extractPlacePhotoReference(value);
    if (parsedPhoto) {
      return buildPlacePhotoProxyUrl(parsedPhoto.photoReference, parsedPhoto.maxWidth);
    }

    const url = new URL(value);
    if (url.searchParams.has('key')) {
      url.searchParams.delete('key');
      return url.toString();
    }
    return value;
  } catch {
    return value.replace(GOOGLE_API_KEY_PATTERN, '');
  }
}

export function sanitizeApiKeyLeaksInString(value: string): string {
  if (!value) return value;
  if (isGooglePlacePhotoUrl(value)) {
    return sanitizeGoogleMapsUrl(value);
  }
  return value.replace(GOOGLE_API_KEY_PATTERN, '');
}
