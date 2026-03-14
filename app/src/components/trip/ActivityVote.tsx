'use client';

import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActivityVoteProps {
  wantCount: number;
  skipCount: number;
  userVote: 'want' | 'skip' | null;
  onVote: (vote: 'want' | 'skip' | null) => void;
}

export function ActivityVote({ wantCount, skipCount, userVote, onVote }: ActivityVoteProps) {
  return (
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/40">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(userVote === 'want' ? null : 'want');
        }}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
          userVote === 'want'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <ThumbsUp className="h-3 w-3" />
        {wantCount > 0 && <span>{wantCount}</span>}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(userVote === 'skip' ? null : 'skip');
        }}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
          userVote === 'skip'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'text-muted-foreground hover:bg-muted'
        )}
      >
        <ThumbsDown className="h-3 w-3" />
        {skipCount > 0 && <span>{skipCount}</span>}
      </button>
    </div>
  );
}
