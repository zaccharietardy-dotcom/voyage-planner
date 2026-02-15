// Badge definitions for gamification system

export type BadgeCategory = 'explorer' | 'social' | 'planner' | 'reviewer' | 'milestone';
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface BadgeRequirement {
  type: 'trip_count' | 'country_count' | 'review_count' | 'photo_count' | 'follower_count' | 'like_count' | 'comment_count' | 'streak' | 'special';
  threshold: number;
}

export interface Badge {
  id: string;
  name: string; // French
  description: string; // French
  icon: string; // Emoji
  category: BadgeCategory;
  tier: BadgeTier;
  requirement: BadgeRequirement;
  xpReward: number;
}

// Badge tier colors
export const TIER_COLORS: Record<BadgeTier, { bg: string; border: string; text: string; glow: string }> = {
  bronze: {
    bg: 'bg-gradient-to-br from-amber-600/20 to-orange-800/20',
    border: 'border-amber-700/50',
    text: 'text-amber-700 dark:text-amber-400',
    glow: 'shadow-amber-500/20',
  },
  silver: {
    bg: 'bg-gradient-to-br from-slate-300/20 to-slate-500/20',
    border: 'border-slate-400/50',
    text: 'text-slate-600 dark:text-slate-300',
    glow: 'shadow-slate-400/20',
  },
  gold: {
    bg: 'bg-gradient-to-br from-yellow-400/20 to-amber-600/20',
    border: 'border-yellow-500/50',
    text: 'text-yellow-600 dark:text-yellow-400',
    glow: 'shadow-yellow-500/20',
  },
  platinum: {
    bg: 'bg-gradient-to-br from-indigo-300/20 to-purple-500/20',
    border: 'border-purple-400/50',
    text: 'text-purple-600 dark:text-purple-300',
    glow: 'shadow-purple-500/20',
  },
};

// All badges (24 total)
export const BADGES: Badge[] = [
  // EXPLORER BADGES (6)
  {
    id: 'first_steps',
    name: 'Premier Pas',
    description: 'Créer ton premier voyage',
    icon: '🗺️',
    category: 'explorer',
    tier: 'bronze',
    requirement: { type: 'trip_count', threshold: 1 },
    xpReward: 50,
  },
  {
    id: 'globe_trotter',
    name: 'Globe-Trotter',
    description: 'Créer 5 voyages',
    icon: '✈️',
    category: 'explorer',
    tier: 'silver',
    requirement: { type: 'trip_count', threshold: 5 },
    xpReward: 100,
  },
  {
    id: 'adventurer',
    name: 'Aventurier',
    description: 'Créer 10 voyages',
    icon: '🌍',
    category: 'explorer',
    tier: 'gold',
    requirement: { type: 'trip_count', threshold: 10 },
    xpReward: 200,
  },
  {
    id: 'ultimate_explorer',
    name: 'Explorateur Ultime',
    description: 'Créer 25 voyages',
    icon: '🚀',
    category: 'explorer',
    tier: 'platinum',
    requirement: { type: 'trip_count', threshold: 25 },
    xpReward: 500,
  },
  {
    id: 'world_citizen',
    name: 'Citoyen du Monde',
    description: 'Visiter 5 pays différents',
    icon: '🌏',
    category: 'explorer',
    tier: 'silver',
    requirement: { type: 'country_count', threshold: 5 },
    xpReward: 150,
  },
  {
    id: 'polyglot',
    name: 'Polyglotte',
    description: 'Visiter 10 pays différents',
    icon: '🗣️',
    category: 'explorer',
    tier: 'gold',
    requirement: { type: 'country_count', threshold: 10 },
    xpReward: 300,
  },

  // SOCIAL BADGES (7)
  {
    id: 'sociable',
    name: 'Sociable',
    description: 'Obtenir 5 abonnés',
    icon: '👋',
    category: 'social',
    tier: 'bronze',
    requirement: { type: 'follower_count', threshold: 5 },
    xpReward: 50,
  },
  {
    id: 'influencer',
    name: 'Influenceur',
    description: 'Obtenir 25 abonnés',
    icon: '⭐',
    category: 'social',
    tier: 'silver',
    requirement: { type: 'follower_count', threshold: 25 },
    xpReward: 150,
  },
  {
    id: 'celebrity',
    name: 'Célébrité',
    description: 'Obtenir 100 abonnés',
    icon: '🌟',
    category: 'social',
    tier: 'gold',
    requirement: { type: 'follower_count', threshold: 100 },
    xpReward: 300,
  },
  {
    id: 'contributor',
    name: 'Contributeur',
    description: 'Écrire 10 commentaires',
    icon: '💬',
    category: 'social',
    tier: 'bronze',
    requirement: { type: 'comment_count', threshold: 10 },
    xpReward: 50,
  },
  {
    id: 'popular',
    name: 'Populaire',
    description: 'Recevoir 50 likes',
    icon: '❤️',
    category: 'social',
    tier: 'silver',
    requirement: { type: 'like_count', threshold: 50 },
    xpReward: 100,
  },
  {
    id: 'viral',
    name: 'Viral',
    description: 'Recevoir 200 likes',
    icon: '🔥',
    category: 'social',
    tier: 'gold',
    requirement: { type: 'like_count', threshold: 200 },
    xpReward: 250,
  },
  {
    id: 'inspiration',
    name: 'Inspiration',
    description: 'Recevoir 500 likes',
    icon: '💎',
    category: 'social',
    tier: 'platinum',
    requirement: { type: 'like_count', threshold: 500 },
    xpReward: 500,
  },

  // PLANNER BADGES (5)
  {
    id: 'organized',
    name: 'Organisé',
    description: 'Compléter ta première checklist',
    icon: '📋',
    category: 'planner',
    tier: 'bronze',
    requirement: { type: 'special', threshold: 1 },
    xpReward: 30,
  },
  {
    id: 'perfectionist',
    name: 'Perfectionniste',
    description: 'Créer 3 voyages détaillés',
    icon: '🎯',
    category: 'planner',
    tier: 'silver',
    requirement: { type: 'trip_count', threshold: 3 },
    xpReward: 75,
  },
  {
    id: 'collaborator',
    name: 'Collaborateur',
    description: 'Inviter un ami sur un voyage',
    icon: '🤝',
    category: 'planner',
    tier: 'bronze',
    requirement: { type: 'special', threshold: 1 },
    xpReward: 50,
  },
  {
    id: 'photographer',
    name: 'Photographe',
    description: 'Ajouter 50 photos',
    icon: '📸',
    category: 'planner',
    tier: 'silver',
    requirement: { type: 'photo_count', threshold: 50 },
    xpReward: 100,
  },
  {
    id: 'memory_keeper',
    name: 'Gardien de Souvenirs',
    description: 'Ajouter 200 photos',
    icon: '🎞️',
    category: 'planner',
    tier: 'gold',
    requirement: { type: 'photo_count', threshold: 200 },
    xpReward: 250,
  },

  // REVIEWER BADGES (3)
  {
    id: 'critic',
    name: 'Critique',
    description: 'Écrire ton premier avis',
    icon: '✍️',
    category: 'reviewer',
    tier: 'bronze',
    requirement: { type: 'review_count', threshold: 1 },
    xpReward: 30,
  },
  {
    id: 'expert',
    name: 'Expert',
    description: 'Écrire 10 avis',
    icon: '📝',
    category: 'reviewer',
    tier: 'silver',
    requirement: { type: 'review_count', threshold: 10 },
    xpReward: 100,
  },
  {
    id: 'local_guide',
    name: 'Guide Local',
    description: 'Écrire 25 avis',
    icon: '🏆',
    category: 'reviewer',
    tier: 'gold',
    requirement: { type: 'review_count', threshold: 25 },
    xpReward: 250,
  },

  // MILESTONE BADGES (3)
  {
    id: 'on_fire',
    name: 'En Feu',
    description: 'Se connecter 3 jours de suite',
    icon: '🔥',
    category: 'milestone',
    tier: 'bronze',
    requirement: { type: 'streak', threshold: 3 },
    xpReward: 40,
  },
  {
    id: 'dedicated',
    name: 'Dévoué',
    description: 'Se connecter 7 jours de suite',
    icon: '⚡',
    category: 'milestone',
    tier: 'silver',
    requirement: { type: 'streak', threshold: 7 },
    xpReward: 100,
  },
  {
    id: 'veteran',
    name: 'Vétéran',
    description: 'Membre depuis 1 an',
    icon: '🎂',
    category: 'milestone',
    tier: 'gold',
    requirement: { type: 'special', threshold: 365 },
    xpReward: 200,
  },
];

// Category labels
export const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  explorer: 'Explorateur',
  social: 'Social',
  planner: 'Planificateur',
  reviewer: 'Critique',
  milestone: 'Jalons',
};

// Get badge by ID
export function getBadgeById(id: string): Badge | undefined {
  return BADGES.find(b => b.id === id);
}

// Get badges by category
export function getBadgesByCategory(category: BadgeCategory): Badge[] {
  return BADGES.filter(b => b.category === category);
}

// Get badges by tier
export function getBadgesByTier(tier: BadgeTier): Badge[] {
  return BADGES.filter(b => b.tier === tier);
}
