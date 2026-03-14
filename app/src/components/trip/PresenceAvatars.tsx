'use client';

import type { PresenceUser } from '@/hooks/usePresence';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface PresenceAvatarsProps {
  users: PresenceUser[];
  className?: string;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-cyan-500', 'bg-amber-500', 'bg-indigo-500',
];

export function PresenceAvatars({ users, className }: PresenceAvatarsProps) {
  if (users.length === 0) return null;

  return (
    <TooltipProvider>
      <div className={cn('flex items-center -space-x-2', className)}>
        {users.slice(0, 5).map((user, idx) => (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <div className="relative">
                <Avatar className="h-7 w-7 border-2 border-background">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
                  <AvatarFallback className={cn('text-[10px] text-white font-bold', AVATAR_COLORS[idx % AVATAR_COLORS.length])}>
                    {getInitials(user.displayName)}
                  </AvatarFallback>
                </Avatar>
                {/* Online dot */}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              <p className="font-medium">{user.displayName}</p>
              {user.currentView && (
                <p className="text-muted-foreground">Vue: {user.currentView}</p>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
        {users.length > 5 && (
          <Avatar className="h-7 w-7 border-2 border-background">
            <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-bold">
              +{users.length - 5}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </TooltipProvider>
  );
}
