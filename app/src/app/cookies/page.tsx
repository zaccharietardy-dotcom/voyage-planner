'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CookiesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-2">Politique de Cookies</h1>
        <p className="text-muted-foreground mb-8">Dernière mise à jour : 5 avril 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Qu&apos;est-ce qu&apos;un cookie ?</h2>
            <p className="text-muted-foreground leading-relaxed">
              Un cookie est un petit fichier texte déposé sur votre navigateur lors de la visite d&apos;un site web.
              Il permet au site de mémoriser des informations sur votre visite (langue préférée, identifiants
              de session, préférences d&apos;affichage) pour faciliter votre navigation ultérieure.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Cookies utilisés par Narae Voyage</h2>

            <h3 className="text-xl font-medium mt-6 mb-3">2.1 Cookies strictement nécessaires</h3>
            <p className="text-muted-foreground leading-relaxed">
              Ces cookies sont indispensables au fonctionnement du site. Ils ne peuvent pas être désactivés.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong>Session Supabase</strong> — Authentification et maintien de votre connexion.</li>
              <li><strong>narae-cookie-consent</strong> — Enregistrement de votre choix concernant les cookies (localStorage).</li>
              <li><strong>voyage-locale</strong> — Mémorisation de votre langue préférée (localStorage).</li>
            </ul>

            <h3 className="text-xl font-medium mt-6 mb-3">2.2 Cookies analytiques</h3>
            <p className="text-muted-foreground leading-relaxed">
              Ces cookies nous aident à comprendre comment les visiteurs interagissent avec le site.
              Ils ne sont activés qu&apos;avec votre consentement.
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong>Sentry</strong> — Suivi des erreurs techniques pour améliorer la stabilité du service. Les replays de session ne sont capturés qu&apos;en cas d&apos;erreur (100% des erreurs, 5% des sessions normales).</li>
              <li><strong>Vercel Analytics</strong> — Mesure d&apos;audience anonymisée (pages vues, performance).</li>
            </ul>

            <h3 className="text-xl font-medium mt-6 mb-3">2.3 Cookies tiers</h3>
            <p className="text-muted-foreground leading-relaxed">
              Narae Voyage n&apos;utilise aucun cookie publicitaire. Nous n&apos;intégrons aucun tracker
              de réseaux sociaux ni de régie publicitaire.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Gestion de vos préférences</h2>
            <p className="text-muted-foreground leading-relaxed">
              Lors de votre première visite, une bannière vous permet d&apos;accepter ou de refuser les cookies
              analytiques. Vous pouvez modifier votre choix à tout moment en supprimant le cookie
              &quot;narae-cookie-consent&quot; dans les paramètres de votre navigateur.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Vous pouvez également configurer votre navigateur pour bloquer tous les cookies ou être
              averti lorsqu&apos;un cookie est déposé. Notez que la désactivation des cookies strictement
              nécessaires peut empêcher le fonctionnement du site.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Durée de conservation</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1 text-muted-foreground">
              <li><strong>Session Supabase</strong> — Durée de la session (renouvelée automatiquement).</li>
              <li><strong>Consentement cookies</strong> — Jusqu&apos;à suppression manuelle par l&apos;utilisateur.</li>
              <li><strong>Préférence de langue</strong> — Jusqu&apos;à suppression manuelle par l&apos;utilisateur.</li>
              <li><strong>Sentry</strong> — 90 jours maximum.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Vos droits</h2>
            <p className="text-muted-foreground leading-relaxed">
              Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d&apos;un droit
              d&apos;accès, de rectification, d&apos;effacement et d&apos;opposition concernant vos données.
              Pour exercer ces droits, consultez notre{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                Politique de Confidentialité
              </Link>{' '}
              ou contactez-nous à{' '}
              <a href="mailto:contact@naraevoyage.com" className="text-primary hover:underline">
                contact@naraevoyage.com
              </a>.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Mise à jour</h2>
            <p className="text-muted-foreground leading-relaxed">
              Cette politique de cookies peut être mise à jour pour refléter des changements dans nos
              pratiques ou dans la réglementation. La date de dernière mise à jour est indiquée en haut
              de cette page.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
