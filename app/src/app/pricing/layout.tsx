import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';

const title = `Tarifs | ${SITE_NAME}`;
const description =
  "Découvrez nos offres pour planifier vos voyages avec l'IA. Gratuit ou Pro, choisissez le plan adapté à vos besoins.";

export const metadata: Metadata = {
  title: 'Tarifs',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/pricing`,
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
  alternates: { canonical: `${SITE_URL}/pricing` },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: `${SITE_NAME} Pro`,
          description:
            "Abonnement Pro pour la planification de voyage assistée par IA avec fonctionnalités avancées.",
          brand: {
            '@type': 'Brand',
            name: SITE_NAME,
          },
          offers: [
            {
              '@type': 'Offer',
              name: 'Gratuit',
              price: '0',
              priceCurrency: 'EUR',
              description:
                'Planification de voyage IA de base, collaboration et partage inclus.',
              url: `${SITE_URL}/pricing`,
              availability: 'https://schema.org/InStock',
            },
            {
              '@type': 'Offer',
              name: 'Pro',
              price: '9.99',
              priceCurrency: 'EUR',
              description:
                'Toutes les fonctionnalités avancées : itinéraires illimités, personnalisation poussée et support prioritaire.',
              url: `${SITE_URL}/pricing`,
              availability: 'https://schema.org/InStock',
            },
          ],
        }}
      />
      {children}
    </>
  );
}
