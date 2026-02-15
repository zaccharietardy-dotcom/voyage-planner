// Gamification service - User stats, levels, badges, streaks

import { Badge, BADGES } from '@/lib/constants/badges';

export interface UserStats {
  tripCount: number;
  countryCount: number;
  reviewCount: number;
  photoCount: number;
  followerCount: number;
  likeCount: number;
  commentCount: number;
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  badges: string[]; // badge IDs earned
  memberSince: string; // ISO date
}

export interface UserLevel {
  level: number;
  title: string;
  nextLevelXp: number;
  progress: number; // 0-100
  currentXp: number;
}

// XP required for each level (exponential growth)
// Level 1: 0 XP, Level 2: 100 XP, Level 3: 250 XP, etc.
export function getXpForLevel(level: number): number {
  if (level === 1) return 0;
  // Formula: 100 * (level - 1)^1.5
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

// Get level title based on level number
export function getLevelTitle(level: number): string {
  if (level >= 31) return 'Légende du Voyage';
  if (level >= 21) return 'Maître Voyageur';
  if (level >= 11) return 'Voyageur Expert';
  if (level >= 6) return 'Voyageur Confirmé';
  return 'Voyageur Débutant';
}

// Calculate user level from XP
export function calculateUserLevel(xp: number): UserLevel {
  let level = 1;

  // Find current level
  while (getXpForLevel(level + 1) <= xp) {
    level++;
  }

  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const xpInCurrentLevel = xp - currentLevelXp;
  const xpNeededForNextLevel = nextLevelXp - currentLevelXp;
  const progress = Math.min(100, Math.floor((xpInCurrentLevel / xpNeededForNextLevel) * 100));

  return {
    level,
    title: getLevelTitle(level),
    nextLevelXp,
    progress,
    currentXp: xp,
  };
}

// Check which badges user is eligible for
export function checkBadgeEligibility(stats: UserStats): Badge[] {
  const earnedBadges: Badge[] = [];

  for (const badge of BADGES) {
    const req = badge.requirement;
    let isEarned = false;

    switch (req.type) {
      case 'trip_count':
        isEarned = stats.tripCount >= req.threshold;
        break;
      case 'country_count':
        isEarned = stats.countryCount >= req.threshold;
        break;
      case 'review_count':
        isEarned = stats.reviewCount >= req.threshold;
        break;
      case 'photo_count':
        isEarned = stats.photoCount >= req.threshold;
        break;
      case 'follower_count':
        isEarned = stats.followerCount >= req.threshold;
        break;
      case 'like_count':
        isEarned = stats.likeCount >= req.threshold;
        break;
      case 'comment_count':
        isEarned = stats.commentCount >= req.threshold;
        break;
      case 'streak':
        isEarned = stats.currentStreak >= req.threshold;
        break;
      case 'special':
        // Special badges require manual checking
        if (badge.id === 'veteran') {
          const memberSinceDate = new Date(stats.memberSince);
          const daysSinceMember = Math.floor(
            (Date.now() - memberSinceDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          isEarned = daysSinceMember >= req.threshold;
        }
        break;
    }

    if (isEarned) {
      earnedBadges.push(badge);
    }
  }

  return earnedBadges;
}

// Get badge progress (percentage to next badge)
export function getBadgeProgress(badge: Badge, stats: UserStats): number {
  const req = badge.requirement;
  let current = 0;

  switch (req.type) {
    case 'trip_count':
      current = stats.tripCount;
      break;
    case 'country_count':
      current = stats.countryCount;
      break;
    case 'review_count':
      current = stats.reviewCount;
      break;
    case 'photo_count':
      current = stats.photoCount;
      break;
    case 'follower_count':
      current = stats.followerCount;
      break;
    case 'like_count':
      current = stats.likeCount;
      break;
    case 'comment_count':
      current = stats.commentCount;
      break;
    case 'streak':
      current = stats.currentStreak;
      break;
    case 'special':
      if (badge.id === 'veteran') {
        const memberSinceDate = new Date(stats.memberSince);
        const daysSinceMember = Math.floor(
          (Date.now() - memberSinceDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        current = daysSinceMember;
      }
      break;
  }

  return Math.min(100, Math.floor((current / req.threshold) * 100));
}

// Get newly earned badges (not yet in stats.badges)
export function getNewBadges(stats: UserStats): Badge[] {
  const allEligible = checkBadgeEligibility(stats);
  return allEligible.filter(badge => !stats.badges.includes(badge.id));
}

// Calculate streak from login dates (client-side approximation)
export function calculateStreak(loginDates: Date[]): { current: number; longest: number } {
  if (loginDates.length === 0) return { current: 0, longest: 0 };

  // Sort dates in descending order
  const sorted = loginDates.sort((a, b) => b.getTime() - a.getTime());

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lastLogin = new Date(sorted[0]);
  lastLogin.setHours(0, 0, 0, 0);

  // Check if last login was today or yesterday
  const daysSinceLastLogin = Math.floor((today.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceLastLogin <= 1) {
    currentStreak = 1;

    // Count consecutive days backwards
    for (let i = 1; i < sorted.length; i++) {
      const currentDate = new Date(sorted[i - 1]);
      currentDate.setHours(0, 0, 0, 0);

      const prevDate = new Date(sorted[i]);
      prevDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === 1) {
        currentStreak++;
        tempStreak++;
      } else {
        break;
      }
    }
  } else {
    currentStreak = 0;
  }

  // Calculate longest streak
  longestStreak = currentStreak;

  for (let i = 1; i < sorted.length; i++) {
    const currentDate = new Date(sorted[i - 1]);
    currentDate.setHours(0, 0, 0, 0);

    const prevDate = new Date(sorted[i]);
    prevDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
  }

  return { current: currentStreak, longest: longestStreak };
}

// Get user stats from API responses
export async function getUserStats(userId: string): Promise<UserStats | null> {
  try {
    const response = await fetch(`/api/users/${userId}/stats`);
    if (!response.ok) return null;

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch user stats:', error);
    return null;
  }
}

// Award XP for an action
export function getXpForAction(action: 'create_trip' | 'complete_trip' | 'get_like' | 'get_follower' | 'write_review' | 'upload_photo' | 'earn_badge', badgeId?: string): number {
  switch (action) {
    case 'create_trip':
      return 100;
    case 'complete_trip':
      return 200;
    case 'get_like':
      return 10;
    case 'get_follower':
      return 20;
    case 'write_review':
      return 50;
    case 'upload_photo':
      return 5;
    case 'earn_badge':
      if (badgeId) {
        const badge = BADGES.find(b => b.id === badgeId);
        return badge?.xpReward || 0;
      }
      return 0;
    default:
      return 0;
  }
}
