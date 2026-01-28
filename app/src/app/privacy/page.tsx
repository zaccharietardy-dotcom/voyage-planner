'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <h1 className="text-4xl font-bold mb-2">Politique de Confidentialité</h1>
        <p className="text-muted-foreground mb-8">Dernière mise à jour : 28 janvier 2025</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              Narae Voyage (&quot;nous&quot;, &quot;notre&quot;) s&apos;engage à protéger la vie privée de ses utilisateurs.
              Cette Politique de Confidentialité explique comment nous collectons, utilisons, partageons
              et protégeons vos données personnelles conformément au Règlement Général sur la Protection
              des Données (RGPD).
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Responsable du Traitement</h2>
            <p className="text-muted-foreground leading-relaxed">
              Le responsable du traitement des données est Narae Voyage.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-2">
              Contact : <a href="mailto:privacy@naraevoyage.com" className="text-primary hover:underline">
                privacy@naraevoyage.com
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. Données Collectées</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Nous collectons les données suivantes :
            </p>

            <h3 className="text-xl font-medium mb-2">3.1 Données d&apos;identification</h3>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground mb-4">
              <li>Nom et prénom</li>
              <li>Adresse email</li>
              <li>Photo de profil (optionnel)</li>
              <li>Identifiant Google (si connexion via Google)</li>
            </ul>

            <h3 className="text-xl font-medium mb-2">3.2 Données de voyage</h3>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground mb-4">
              <li>Destinations et dates de voyage</li>
              <li>Préférences de voyage (activités, budget, régime alimentaire)</li>
              <li>Itinéraires créés et sauvegardés</li>
              <li>Photos de voyage (si partagées)</li>
            </ul>

            <h3 className="text-xl font-medium mb-2">3.3 Données techniques</h3>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Adresse IP</li>
              <li>Type de navigateur et appareil</li>
              <li>Données de navigation (pages visitées, durée)</li>
              <li>Cookies et traceurs</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Finalités du Traitement</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Vos données sont utilisées pour :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Fournir le Service :</strong> Création de compte, génération d&apos;itinéraires, sauvegarde de voyages</li>
              <li><strong>Personnalisation :</strong> Recommandations basées sur vos préférences</li>
              <li><strong>Communication :</strong> Notifications, emails de service, newsletter (avec consentement)</li>
              <li><strong>Amélioration :</strong> Analyse d&apos;usage pour améliorer le Service</li>
              <li><strong>Sécurité :</strong> Détection de fraude et protection des comptes</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Base Légale du Traitement</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Le traitement de vos données repose sur :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>L&apos;exécution du contrat :</strong> Nécessaire pour fournir le Service</li>
              <li><strong>Le consentement :</strong> Pour la newsletter et les cookies non essentiels</li>
              <li><strong>L&apos;intérêt légitime :</strong> Amélioration du Service et sécurité</li>
              <li><strong>L&apos;obligation légale :</strong> Conservation des données selon la loi</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Partage des Données</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Vos données peuvent être partagées avec :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Supabase :</strong> Hébergement de la base de données (UE)</li>
              <li><strong>Vercel :</strong> Hébergement du site web</li>
              <li><strong>Google :</strong> Authentification (si vous utilisez &quot;Se connecter avec Google&quot;)</li>
              <li><strong>Autres utilisateurs :</strong> Voyages publics et profils partagés</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Nous ne vendons jamais vos données personnelles à des tiers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Durée de Conservation</h2>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Données de compte :</strong> Conservées tant que le compte est actif, puis 3 ans après suppression</li>
              <li><strong>Données de voyage :</strong> Conservées tant que vous les gardez dans votre compte</li>
              <li><strong>Données techniques :</strong> 13 mois maximum</li>
              <li><strong>Données de facturation :</strong> 10 ans (obligation légale)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Vos Droits (RGPD)</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Conformément au RGPD, vous disposez des droits suivants :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Droit d&apos;accès :</strong> Obtenir une copie de vos données</li>
              <li><strong>Droit de rectification :</strong> Corriger vos données inexactes</li>
              <li><strong>Droit à l&apos;effacement :</strong> Supprimer vos données (&quot;droit à l&apos;oubli&quot;)</li>
              <li><strong>Droit à la limitation :</strong> Restreindre le traitement de vos données</li>
              <li><strong>Droit à la portabilité :</strong> Recevoir vos données dans un format lisible</li>
              <li><strong>Droit d&apos;opposition :</strong> Vous opposer au traitement de vos données</li>
              <li><strong>Droit de retrait du consentement :</strong> Retirer votre consentement à tout moment</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Pour exercer ces droits, contactez-nous à{' '}
              <a href="mailto:privacy@naraevoyage.com" className="text-primary hover:underline">
                privacy@naraevoyage.com
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Cookies</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Nous utilisons des cookies pour :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li><strong>Cookies essentiels :</strong> Fonctionnement du site, authentification</li>
              <li><strong>Cookies de préférences :</strong> Thème (clair/sombre), langue</li>
              <li><strong>Cookies analytiques :</strong> Statistiques d&apos;utilisation (avec consentement)</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Vous pouvez gérer vos préférences de cookies dans les paramètres de votre navigateur.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Sécurité</h2>
            <p className="text-muted-foreground leading-relaxed">
              Nous mettons en œuvre des mesures techniques et organisationnelles appropriées pour
              protéger vos données contre tout accès non autorisé, modification, divulgation ou destruction :
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-1 text-muted-foreground">
              <li>Chiffrement des données en transit (HTTPS/TLS)</li>
              <li>Chiffrement des données au repos</li>
              <li>Authentification sécurisée</li>
              <li>Accès restreint aux données personnelles</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Transferts Internationaux</h2>
            <p className="text-muted-foreground leading-relaxed">
              Certaines données peuvent être transférées vers des pays hors de l&apos;Union Européenne
              (notamment les États-Unis pour Vercel). Ces transferts sont encadrés par des garanties
              appropriées (clauses contractuelles types, décisions d&apos;adéquation).
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Mineurs</h2>
            <p className="text-muted-foreground leading-relaxed">
              Le Service n&apos;est pas destiné aux personnes de moins de 16 ans. Nous ne collectons pas
              sciemment de données personnelles de mineurs. Si vous êtes parent et pensez que votre
              enfant nous a fourni des données, contactez-nous.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">13. Modifications</h2>
            <p className="text-muted-foreground leading-relaxed">
              Nous pouvons modifier cette Politique de Confidentialité. En cas de modification
              substantielle, nous vous en informerons par email ou via le Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">14. Réclamation</h2>
            <p className="text-muted-foreground leading-relaxed">
              Si vous estimez que le traitement de vos données n&apos;est pas conforme à la réglementation,
              vous pouvez introduire une réclamation auprès de la CNIL :{' '}
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                www.cnil.fr
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">15. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              Pour toute question relative à cette Politique de Confidentialité :{' '}
              <a href="mailto:privacy@naraevoyage.com" className="text-primary hover:underline">
                privacy@naraevoyage.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
