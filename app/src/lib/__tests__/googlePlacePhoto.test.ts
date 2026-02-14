import {
  buildPlacePhotoProxyUrl,
  extractPlacePhotoReference,
  sanitizeApiKeyLeaksInString,
  sanitizeGoogleMapsUrl,
} from '../services/googlePlacePhoto';

describe('googlePlacePhoto helpers', () => {
  it('builds proxy URL for place photo', () => {
    const url = buildPlacePhotoProxyUrl('photo-ref-123', 400);
    expect(url).toBe('/api/place-photo?photo_reference=photo-ref-123&maxwidth=400');
  });

  it('extracts photo reference and width from google place photo URL', () => {
    const parsed = extractPlacePhotoReference(
      'https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=abc123&key=AIzaSyFakeKey123456789012345678'
    );
    expect(parsed).toEqual({ photoReference: 'abc123', maxWidth: 800 });
  });

  it('sanitizes google photo URL to proxy URL and strips API key leaks', () => {
    const raw = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=abc123&key=AIzaSyFakeKey123456789012345678';
    const proxied = sanitizeGoogleMapsUrl(raw);
    expect(proxied).toBe('/api/place-photo?photo_reference=abc123&maxwidth=800');
    expect(sanitizeApiKeyLeaksInString(proxied)).not.toContain('AIza');
  });
});
