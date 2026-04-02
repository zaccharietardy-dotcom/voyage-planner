import Script from 'next/script';

/**
 * Composant utilitaire pour injecter des données structurées JSON-LD
 * dans le <head> via les conventions Next.js App Router.
 */
export function JsonLd({ data, id }: { data: Record<string, unknown>; id?: string }) {
  const payload = JSON.stringify(data);
  const scriptId = id || `jsonld-${Object.keys(data).join('-')}-${payload.length}`;

  return (
    <Script
      id={scriptId}
      strategy="beforeInteractive"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}
