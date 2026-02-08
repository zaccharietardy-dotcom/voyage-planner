import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';

const title = `Planifier un voyage | ${SITE_NAME}`;
const description =
  "Créez votre itinéraire de voyage personnalisé en quelques minutes grâce à l'intelligence artificielle. Destination, dates, budget : notre IA s'occupe de tout.";

export const metadata: Metadata = {
  title: 'Planifier un voyage',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/plan`,
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
  alternates: { canonical: `${SITE_URL}/plan` },
};

export default function PlanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
