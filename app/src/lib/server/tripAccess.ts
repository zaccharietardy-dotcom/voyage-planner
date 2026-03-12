import type { MemberRole } from '@/lib/types/collaboration';

type TripVisibility = 'public' | 'friends' | 'private' | null;

export function canViewTrip(
  userId: string | null | undefined,
  tripOwnerId: string,
  visibility: TripVisibility,
  isCloseFriend: boolean,
  isMember: boolean
): boolean {
  if (userId && userId === tripOwnerId) {
    return true;
  }

  if (isMember) {
    return true;
  }

  if (visibility === 'public') {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (visibility === 'friends') {
    return isCloseFriend;
  }

  return false;
}

export function canEditTrip(userRole: MemberRole | null | undefined): boolean {
  return userRole === 'owner' || userRole === 'editor';
}

export function canManageTrip(userRole: MemberRole | null | undefined): boolean {
  return userRole === 'owner';
}
