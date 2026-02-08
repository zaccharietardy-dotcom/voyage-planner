import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';

const title = `À propos | ${SITE_NAME}`;
const description =
  "Découvrez Narae Voyage, la plateforme de planification de voyage assistée par IA. Notre mission : rendre le voyage accessible, collaboratif et authentique.";

export const metadata: Metadata = {
  title: 'À propos',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/about`,
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
  alternates: { canonical: `${SITE_URL}/about` },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
