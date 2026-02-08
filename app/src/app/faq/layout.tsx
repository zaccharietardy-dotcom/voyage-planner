import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL, OG_IMAGE_DEFAULT, LOCALE } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { faqCategories } from './faqData';

const title = `Foire aux questions | ${SITE_NAME}`;
const description =
  'Trouvez des réponses à toutes vos questions sur Narae Voyage : création de compte, planification de voyage, collaboration, préférences et plus.';

export const metadata: Metadata = {
  title: 'Foire aux questions',
  description,
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/faq`,
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
  alternates: { canonical: `${SITE_URL}/faq` },
};

// Construire le JSON-LD FAQPage à partir des données
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqCategories.flatMap((cat) =>
    cat.questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    }))
  ),
};

export default function FaqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <JsonLd data={faqJsonLd} />
      {children}
    </>
  );
}
