'use client';

import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const faqCategories = [
  {
    category: 'Général',
    questions: [
      {
        question: 'Qu\'est-ce que Narae Voyage ?',
        answer: 'Narae Voyage est une plateforme de planification de voyage assistée par intelligence artificielle. Elle vous permet de générer des itinéraires personnalisés en quelques minutes, de collaborer avec vos amis et de découvrir les voyages d\'autres voyageurs.',
      },
      {
        question: 'Est-ce que Narae Voyage est gratuit ?',
        answer: 'Oui, Narae Voyage est entièrement gratuit ! Vous pouvez créer un compte, générer des itinéraires et partager vos voyages sans aucun frais.',
      },
      {
        question: 'Comment fonctionne la génération d\'itinéraire ?',
        answer: 'Notre IA analyse vos préférences (destination, dates, budget, activités, régime alimentaire) et génère un itinéraire jour par jour avec des restaurants authentiques, des activités adaptées et des hébergements. Vous pouvez ensuite personnaliser chaque élément.',
      },
    ],
  },
  {
    category: 'Compte',
    questions: [
      {
        question: 'Comment créer un compte ?',
        answer: 'Cliquez sur "Connexion" puis choisissez de vous connecter avec Google ou de créer un compte avec votre email. La création de compte prend moins d\'une minute.',
      },
      {
        question: 'Comment supprimer mon compte ?',
        answer: 'Rendez-vous dans Paramètres > Données > Supprimer mon compte. Cette action est irréversible et supprimera tous vos voyages et données personnelles.',
      },
      {
        question: 'Mes données sont-elles sécurisées ?',
        answer: 'Oui, nous prenons la sécurité très au sérieux. Vos données sont chiffrées et stockées de manière sécurisée. Consultez notre politique de confidentialité pour plus de détails.',
      },
    ],
  },
  {
    category: 'Voyages',
    questions: [
      {
        question: 'Comment créer un voyage ?',
        answer: 'Cliquez sur "Créer mon voyage", renseignez votre destination, vos dates et vos préférences, puis laissez notre IA générer votre itinéraire personnalisé.',
      },
      {
        question: 'Puis-je modifier mon itinéraire après génération ?',
        answer: 'Absolument ! Vous pouvez réorganiser les activités par glisser-déposer, modifier les horaires, remplacer une activité par une alternative, ou régénérer tout ou partie de l\'itinéraire.',
      },
      {
        question: 'Comment partager mon voyage avec des amis ?',
        answer: 'Ouvrez votre voyage et cliquez sur le bouton "Partager". Vous pouvez envoyer un lien d\'invitation par email, WhatsApp ou copier le lien. Vos amis pourront voir et collaborer sur le voyage.',
      },
      {
        question: 'Qu\'est-ce que le mode collaboratif ?',
        answer: 'Le mode collaboratif permet à plusieurs personnes de travailler sur le même voyage. Chacun peut proposer des modifications (ajouter, supprimer, déplacer des activités) et les autres membres votent pour accepter ou refuser.',
      },
      {
        question: 'Puis-je rendre mon voyage public ?',
        answer: 'Oui, dans les paramètres de votre voyage, vous pouvez le passer en "Public". Il sera alors visible dans le feed Explorer et d\'autres voyageurs pourront le découvrir et le cloner.',
      },
    ],
  },
  {
    category: 'Préférences',
    questions: [
      {
        question: 'Quelles préférences alimentaires sont supportées ?',
        answer: 'Nous supportons : végétarien, vegan, halal, casher, sans gluten, et bien d\'autres. Vous pouvez aussi indiquer des allergies spécifiques.',
      },
      {
        question: 'Comment enregistrer mes préférences ?',
        answer: 'Rendez-vous dans votre profil > Préférences pour définir vos goûts par défaut. Ces préférences seront automatiquement utilisées pour vos prochains voyages.',
      },
      {
        question: 'Les restaurants recommandés sont-ils fiables ?',
        answer: 'Nous privilégions les restaurants locaux authentiques avec une note minimale de 3.7/5. Nous excluons automatiquement les chaînes de fast-food et privilégions les adresses recommandées par les locaux.',
      },
    ],
  },
  {
    category: 'Technique',
    questions: [
      {
        question: 'L\'application fonctionne-t-elle hors-ligne ?',
        answer: 'Partiellement. Vous pouvez consulter vos voyages sauvegardés hors-ligne, mais la génération de nouveaux itinéraires nécessite une connexion internet.',
      },
      {
        question: 'Sur quels appareils puis-je utiliser Narae Voyage ?',
        answer: 'Narae Voyage est une application web responsive qui fonctionne sur tous les appareils : ordinateur, tablette et smartphone (iOS et Android via le navigateur).',
      },
      {
        question: 'Comment signaler un bug ?',
        answer: 'Utilisez le formulaire de contact avec le sujet "Signaler un bug" ou envoyez un email à support@naraevoyage.com avec une description détaillée du problème.',
      },
    ],
  },
];

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCategories = faqCategories
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) =>
          q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          q.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.questions.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Foire Aux Questions</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Trouvez rapidement des réponses à vos questions
          </p>

          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une question..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              Aucune question ne correspond à votre recherche.
            </p>
            <Button variant="outline" onClick={() => setSearchQuery('')}>
              Effacer la recherche
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredCategories.map((category) => (
              <div key={category.category}>
                <h2 className="text-xl font-semibold mb-4 text-primary">
                  {category.category}
                </h2>
                <Accordion type="single" collapsible className="space-y-2">
                  {category.questions.map((item, index) => (
                    <AccordionItem
                      key={index}
                      value={`${category.category}-${index}`}
                      className="border rounded-lg px-4 data-[state=open]:bg-muted/50"
                    >
                      <AccordionTrigger className="text-left hover:no-underline">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        )}

        <div className="mt-16 text-center py-12 px-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
          <h2 className="text-xl font-semibold mb-4">Vous n&apos;avez pas trouvé votre réponse ?</h2>
          <p className="text-muted-foreground mb-6">
            Notre équipe est là pour vous aider
          </p>
          <Button asChild>
            <Link href="/contact">Contactez-nous</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
