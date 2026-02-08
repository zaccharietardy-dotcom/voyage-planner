import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';

const title = `Explorer les voyages | ${SITE_NAME}`;
const description =
  "Découvrez les itinéraires de la communauté Narae et inspirez-vous pour votre prochain voyage. Parcourez des centaines de voyages partagés par d'autres voyageurs.";

export const metadata: Metadata = {
  title: 'Explorer les voyages',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/explore`,
    siteName: SITE_NAME,
    images: [{ url: OG_IMAGE_DEFAULT, width: 1200, height: 630, alt: title }],
    locale: LOCALE,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [OG_IMAGE_DEFAULT],
  },
  alternates: { canonical: `${SITE_URL}/explore` },
};

export default function ExploreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
