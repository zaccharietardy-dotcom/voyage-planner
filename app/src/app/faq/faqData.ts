export interface FaqQuestion {
  question: string;
  answer: string;
}

export interface FaqCategory {
  category: string;
  questions: FaqQuestion[];
}

export const faqCategories: FaqCategory[] = [
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
