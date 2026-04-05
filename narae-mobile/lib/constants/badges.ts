export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type BadgeCategory = 'explorer' | 'social' | 'planner' | 'reviewer' | 'milestone';

export interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: BadgeCategory;
  tier: BadgeTier;
  requirement: {
    type: 'trip_count' | 'country_count' | 'review_count' | 'photo_count' | 'follower_count' | 'like_count' | 'comment_count' | 'streak' | 'special';
    threshold: number;
  };
  xpReward: number;
}

export const BADGES: Badge[] = [
  // Explorer
  { id: 'first_steps', name: 'Premiers Pas', description: 'Créer son premier voyage', emoji: '👣', category: 'explorer', tier: 'bronze', requirement: { type: 'trip_count', threshold: 1 }, xpReward: 50 },
  { id: 'globe_trotter', name: 'Globe-Trotter', description: 'Planifier 5 voyages', emoji: '🌍', category: 'explorer', tier: 'silver', requirement: { type: 'trip_count', threshold: 5 }, xpReward: 100 },
  { id: 'adventurer', name: 'Aventurier', description: 'Visiter 5 pays différents', emoji: '🧭', category: 'explorer', tier: 'silver', requirement: { type: 'country_count', threshold: 5 }, xpReward: 150 },
  { id: 'ultimate_explorer', name: 'Explorateur Ultime', description: 'Planifier 20 voyages', emoji: '🏔️', category: 'explorer', tier: 'gold', requirement: { type: 'trip_count', threshold: 20 }, xpReward: 250 },
  { id: 'world_citizen', name: 'Citoyen du Monde', description: 'Visiter 15 pays', emoji: '🌏', category: 'explorer', tier: 'gold', requirement: { type: 'country_count', threshold: 15 }, xpReward: 300 },
  { id: 'polyglot', name: 'Polyglotte', description: 'Visiter 30 pays', emoji: '🗺️', category: 'explorer', tier: 'platinum', requirement: { type: 'country_count', threshold: 30 }, xpReward: 500 },

  // Social
  { id: 'sociable', name: 'Sociable', description: 'Obtenir 5 abonnés', emoji: '🤝', category: 'social', tier: 'bronze', requirement: { type: 'follower_count', threshold: 5 }, xpReward: 50 },
  { id: 'influencer', name: 'Influenceur', description: 'Obtenir 25 abonnés', emoji: '📢', category: 'social', tier: 'silver', requirement: { type: 'follower_count', threshold: 25 }, xpReward: 100 },
  { id: 'celebrity', name: 'Célébrité', description: 'Obtenir 100 abonnés', emoji: '⭐', category: 'social', tier: 'gold', requirement: { type: 'follower_count', threshold: 100 }, xpReward: 300 },
  { id: 'contributor', name: 'Contributeur', description: 'Écrire 5 commentaires', emoji: '💬', category: 'social', tier: 'bronze', requirement: { type: 'comment_count', threshold: 5 }, xpReward: 40 },
  { id: 'popular', name: 'Populaire', description: 'Recevoir 20 likes', emoji: '❤️', category: 'social', tier: 'silver', requirement: { type: 'like_count', threshold: 20 }, xpReward: 80 },
  { id: 'viral', name: 'Viral', description: 'Recevoir 100 likes', emoji: '🔥', category: 'social', tier: 'gold', requirement: { type: 'like_count', threshold: 100 }, xpReward: 200 },
  { id: 'inspiration', name: 'Inspiration', description: 'Recevoir 500 likes', emoji: '✨', category: 'social', tier: 'platinum', requirement: { type: 'like_count', threshold: 500 }, xpReward: 500 },

  // Planner
  { id: 'organized', name: 'Organisé', description: 'Compléter toutes les réservations', emoji: '📋', category: 'planner', tier: 'bronze', requirement: { type: 'special', threshold: 1 }, xpReward: 60 },
  { id: 'perfectionist', name: 'Perfectionniste', description: 'Planifier 10 voyages sans erreur', emoji: '💎', category: 'planner', tier: 'silver', requirement: { type: 'trip_count', threshold: 10 }, xpReward: 150 },
  { id: 'collaborator', name: 'Collaborateur', description: 'Participer à 5 voyages de groupe', emoji: '🤗', category: 'planner', tier: 'silver', requirement: { type: 'special', threshold: 5 }, xpReward: 120 },
  { id: 'photographer', name: 'Photographe', description: 'Ajouter 50 photos', emoji: '📸', category: 'planner', tier: 'gold', requirement: { type: 'photo_count', threshold: 50 }, xpReward: 200 },
  { id: 'memory_keeper', name: 'Gardien des Souvenirs', description: 'Ajouter 200 photos', emoji: '🏛️', category: 'planner', tier: 'gold', requirement: { type: 'photo_count', threshold: 200 }, xpReward: 300 },

  // Reviewer
  { id: 'critic', name: 'Critique', description: 'Écrire 3 avis', emoji: '🖊️', category: 'reviewer', tier: 'bronze', requirement: { type: 'review_count', threshold: 3 }, xpReward: 40 },
  { id: 'expert', name: 'Expert', description: 'Écrire 15 avis', emoji: '🎓', category: 'reviewer', tier: 'silver', requirement: { type: 'review_count', threshold: 15 }, xpReward: 120 },
  { id: 'local_guide', name: 'Guide Local', description: 'Écrire 50 avis', emoji: '🗣️', category: 'reviewer', tier: 'gold', requirement: { type: 'review_count', threshold: 50 }, xpReward: 250 },

  // Milestone
  { id: 'on_fire', name: 'En Feu', description: '3 jours consécutifs d\'activité', emoji: '🔥', category: 'milestone', tier: 'bronze', requirement: { type: 'streak', threshold: 3 }, xpReward: 40 },
  { id: 'dedicated', name: 'Dévoué', description: '7 jours consécutifs d\'activité', emoji: '💪', category: 'milestone', tier: 'silver', requirement: { type: 'streak', threshold: 7 }, xpReward: 100 },
  { id: 'veteran', name: 'Vétéran', description: 'Membre depuis 1 an', emoji: '🏅', category: 'milestone', tier: 'gold', requirement: { type: 'special', threshold: 365 }, xpReward: 200 },
];

export const BADGE_MAP = new Map(BADGES.map((b) => [b.id, b]));

export const TIER_COLORS: Record<BadgeTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#E5E4E2',
};

export const LEVEL_TITLES = [
  { min: 1, max: 5, title: 'Voyageur Débutant' },
  { min: 6, max: 10, title: 'Voyageur Confirmé' },
  { min: 11, max: 20, title: 'Voyageur Expert' },
  { min: 21, max: 30, title: 'Maître Voyageur' },
  { min: 31, max: 999, title: 'Légende du Voyage' },
];

export function getLevelTitle(level: number): string {
  return LEVEL_TITLES.find((t) => level >= t.min && level <= t.max)?.title ?? 'Voyageur';
}

export function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

export function getLevelFromXp(xp: number): number {
  let level = 1;
  while (getXpForLevel(level + 1) <= xp) level++;
  return level;
}
