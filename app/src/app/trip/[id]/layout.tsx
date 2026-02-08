import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: trip } = await supabase
    .from('trips')
    .select('title, destination, duration_days, visibility')
    .eq('id', id)
    .single();

  // Fallback pour les voyages privés ou introuvables
  if (!trip || trip.visibility === 'private') {
    return {
      title: 'Voyage',
      robots: { index: false, follow: false },
    };
  }

  const tripTitle = trip.title || trip.destination;
  const title = `${tripTitle} — ${trip.duration_days}j`;
  const description = `Découvrez cet itinéraire de ${trip.duration_days} jours à ${trip.destination} sur ${SITE_NAME}. Planifié avec l'IA, personnalisable et partageable.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      url: `${SITE_URL}/trip/${id}`,
      siteName: SITE_NAME,
      images: [
        { url: OG_IMAGE_DEFAULT, width: 1200, height: 630, alt: tripTitle },
      ],
      locale: LOCALE,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [OG_IMAGE_DEFAULT],
    },
    alternates: { canonical: `${SITE_URL}/trip/${id}` },
  };
}

export default async function TripLayout({ params, children }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: trip } = await supabase
    .from('trips')
    .select('title, destination, duration_days, start_date, end_date, visibility')
    .eq('id', id)
    .single();

  // JSON-LD uniquement pour les voyages publics
  if (!trip || trip.visibility === 'private') {
    return <>{children}</>;
  }

  const tripTitle = trip.title || trip.destination;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TravelAction',
    name: `Voyage à ${trip.destination} — ${trip.duration_days} jours`,
    description: `Itinéraire de ${trip.duration_days} jours à ${trip.destination} planifié sur ${SITE_NAME}.`,
    toLocation: {
      '@type': 'Place',
      name: trip.destination,
    },
    startTime: trip.start_date,
    endTime: trip.end_date,
    agent: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
