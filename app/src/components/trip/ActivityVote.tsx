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
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(userVote === 'want' ? null : 'want');
        }}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] font-black transition-all active:scale-95',
          userVote === 'want'
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
            : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60 border border-white/5'
        )}
      >
        <ThumbsUp className="h-2.5 w-2.5" />
        {wantCount > 0 && <span>{wantCount}</span>}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onVote(userVote === 'skip' ? null : 'skip');
        }}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[9px] font-black transition-all active:scale-95',
          userVote === 'skip'
            ? 'bg-red-500/20 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
            : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60 border border-white/5'
        )}
      >
        <ThumbsDown className="h-2.5 w-2.5" />
        {skipCount > 0 && <span>{skipCount}</span>}
      </button>
    </div>
  );
}
