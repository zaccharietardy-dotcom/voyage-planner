'use client';

import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ChevronRight } from 'lucide-react';

interface UserProfileCardProps {
  user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username?: string | null;
    bio?: string | null;
  };
  subtitle?: string;
  showArrow?: boolean;
}

export function UserProfileCard({ user, subtitle, showArrow = true }: UserProfileCardProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/user/${user.id}`)}
      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left"
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={user.avatar_url || undefined} />
        <AvatarFallback>
          {(user.display_name || '?')[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {user.display_name || 'Utilisateur'}
        </p>
        {(subtitle || user.username) && (
          <p className="text-muted-foreground text-xs truncate">
            {subtitle || `@${user.username}`}
          </p>
        )}
      </div>
      {showArrow && (
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
}
