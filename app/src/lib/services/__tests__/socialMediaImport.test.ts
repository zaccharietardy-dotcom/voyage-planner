/**
 * Tests pour le service d'import depuis les réseaux sociaux
 */

import { detectPlatform } from '../socialMediaImport';

describe('socialMediaImport', () => {
  describe('detectPlatform', () => {
    it('détecte Instagram', () => {
      expect(detectPlatform('https://www.instagram.com/p/ABC123/')).toBe('instagram');
      expect(detectPlatform('https://instagram.com/reel/XYZ789/')).toBe('instagram');
    });

    it('détecte TikTok', () => {
      expect(detectPlatform('https://www.tiktok.com/@user/video/123456')).toBe('tiktok');
      expect(detectPlatform('https://tiktok.com/@travel/video/789')).toBe('tiktok');
    });

    it('détecte YouTube', () => {
      expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    });

    it('détecte les blogs', () => {
      expect(detectPlatform('https://medium.com/@user/article-123')).toBe('blog');
      expect(detectPlatform('https://travelblog.wordpress.com/2024/paris')).toBe('blog');
      expect(detectPlatform('https://myblog.com/post')).toBe('blog');
    });

    it('retourne unknown pour les URLs inconnues', () => {
      expect(detectPlatform('https://example.com')).toBe('unknown');
      expect(detectPlatform('https://facebook.com/post')).toBe('unknown');
    });

    it('retourne unknown pour les strings invalides', () => {
      expect(detectPlatform('not a url')).toBe('unknown');
      expect(detectPlatform('')).toBe('unknown');
    });
  });
});
