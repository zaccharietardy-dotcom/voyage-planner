/**
 * Composant utilitaire pour injecter des données structurées JSON-LD
 * dans le <head> via les conventions Next.js App Router.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
