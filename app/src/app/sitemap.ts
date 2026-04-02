import type { MetadataRoute } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { DESTINATIONS } from '@/lib/destinations';
import { getPublicEnv, hasConfiguredSupabase } from '@/lib/runtime-config';

const SITE_URL = getPublicEnv().NEXT_PUBLIC_SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Routes statiques
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/plan`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/explore`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/faq`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ];

  // Routes dynamiques : voyages publics
  let tripRoutes: MetadataRoute.Sitemap = [];

  if (hasConfiguredSupabase()) {
    try {
    const supabase = await createServerSupabaseClient();
    const { data: trips } = await supabase
      .from('trips')
      .select('id, updated_at')
      .eq('visibility', 'public')
      .order('updated_at', { ascending: false })
      .limit(1000);

    tripRoutes = (trips || []).map((trip) => ({
      url: `${SITE_URL}/trip/${trip.id}`,
      lastModified: new Date(trip.updated_at),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
    } catch {
      // Silencieux en cas d'erreur Supabase — on retourne les routes statiques
    }
  }

  // Routes destinations
  const destinationRoutes: MetadataRoute.Sitemap = DESTINATIONS.map((d) => ({
    url: `${SITE_URL}/destination/${d.slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [...staticRoutes, ...destinationRoutes, ...tripRoutes];
}
