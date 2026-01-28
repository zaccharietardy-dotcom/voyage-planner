'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CGUPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-2">Conditions Générales d&apos;Utilisation</h1>
        <p className="text-muted-foreground mb-8">Dernière mise à jour : 28 janvier 2025</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Objet</h2>
            <p className="text-muted-foreground leading-relaxed">
              Les présentes Conditions Générales d&apos;Utilisation (CGU) ont pour objet de définir les modalités
              et conditions d&apos;utilisation du service Narae Voyage, accessible à l&apos;adresse naraevoyage.com
              (ci-après &quot;le Service&quot;).
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              En accédant et en utilisant le Service, vous acceptez sans réserve les présentes CGU.
              Si vous n&apos;acceptez pas ces conditions, veuillez ne pas utiliser le Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Description du Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              Narae Voyage est une plateforme de planification de voyages assistée par intelligence artificielle.
              Le Service permet aux utilisateurs de :
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Générer des itinéraires de voyage personnalisés</li>
              <li>Partager leurs voyages avec d&apos;autres utilisateurs</li>
              <li>Collaborer sur la planification de voyages en groupe</li>
              <li>Découvrir des destinations et activités recommandées</li>
              <li>Sauvegarder et gérer leurs projets de voyage</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Inscription et Compte Utilisateur</h2>
            <p className="text-muted-foreground leading-relaxed">
              L&apos;utilisation de certaines fonctionnalités du Service nécessite la création d&apos;un compte utilisateur.
              Lors de l&apos;inscription, vous vous engagez à fournir des informations exactes et à jour.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Vous êtes responsable de la confidentialité de vos identifiants de connexion et de toutes
              les activités effectuées sous votre compte. En cas d&apos;utilisation non autorisée de votre compte,
              vous devez nous en informer immédiatement.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Utilisation du Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              Vous vous engagez à utiliser le Service de manière conforme aux lois en vigueur et aux présentes CGU.
              Il est notamment interdit de :
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2 text-muted-foreground">
              <li>Utiliser le Service à des fins illégales ou non autorisées</li>
              <li>Tenter d&apos;accéder aux systèmes informatiques de Narae Voyage sans autorisation</li>
              <li>Publier du contenu offensant, diffamatoire ou portant atteinte aux droits d&apos;autrui</li>
              <li>Collecter des données personnelles d&apos;autres utilisateurs sans leur consentement</li>
              <li>Perturber le bon fonctionnement du Service</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Propriété Intellectuelle</h2>
            <p className="text-muted-foreground leading-relaxed">
              Le Service, incluant notamment son design, ses fonctionnalités, ses textes, images et logos,
              est protégé par les droits de propriété intellectuelle. Toute reproduction, représentation
              ou exploitation non autorisée est interdite.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Les contenus que vous créez sur le Service (itinéraires, commentaires, photos) restent votre propriété.
              Vous accordez toutefois à Narae Voyage une licence non exclusive pour utiliser ces contenus
              dans le cadre du fonctionnement du Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Limitation de Responsabilité</h2>
            <p className="text-muted-foreground leading-relaxed">
              Le Service est fourni &quot;en l&apos;état&quot;. Narae Voyage ne garantit pas que le Service sera
              exempt d&apos;erreurs ou d&apos;interruptions. Les itinéraires générés sont des suggestions
              et ne constituent pas des conseils professionnels de voyage.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Narae Voyage ne saurait être tenu responsable des dommages directs ou indirects résultant
              de l&apos;utilisation du Service, notamment en cas de réservations effectuées sur des sites tiers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Protection des Données</h2>
            <p className="text-muted-foreground leading-relaxed">
              Le traitement de vos données personnelles est soumis à notre{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                Politique de Confidentialité
              </Link>
              , qui fait partie intégrante des présentes CGU.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Modification des CGU</h2>
            <p className="text-muted-foreground leading-relaxed">
              Narae Voyage se réserve le droit de modifier les présentes CGU à tout moment.
              Les utilisateurs seront informés des modifications par email ou via le Service.
              La poursuite de l&apos;utilisation du Service après modification vaut acceptation des nouvelles CGU.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Résiliation</h2>
            <p className="text-muted-foreground leading-relaxed">
              Vous pouvez supprimer votre compte à tout moment depuis les paramètres de votre profil.
              Narae Voyage se réserve le droit de suspendre ou supprimer tout compte en cas de violation des présentes CGU.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Droit Applicable et Juridiction</h2>
            <p className="text-muted-foreground leading-relaxed">
              Les présentes CGU sont régies par le droit français. En cas de litige, et après tentative
              de résolution amiable, les tribunaux français seront seuls compétents.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              Pour toute question concernant les présentes CGU, vous pouvez nous contacter à l&apos;adresse :{' '}
              <a href="mailto:contact@naraevoyage.com" className="text-primary hover:underline">
                contact@naraevoyage.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
