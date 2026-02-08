import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';

const title = `Contact | ${SITE_NAME}`;
const description =
  "Contactez l'équipe Narae Voyage. Question, suggestion, partenariat ou signalement de bug — nous sommes à votre écoute.";

export const metadata: Metadata = {
  title: 'Contact',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/contact`,
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
  alternates: { canonical: `${SITE_URL}/contact` },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
