import type { MetadataRoute } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://naraevoyage.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth/',
          '/login',
          '/register',
          '/mes-voyages',
          '/profil',
          '/preferences',
          '/messages/',
          '/forgot-password',
          '/reset-password',
          '/test-*',
          '/invite/',
          '/join/',
          '/journal/',
          '/globe',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
