'use client';

import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

export function QuickSearch() {
  const router = useRouter();

  return (
    <button
      className="w-full flex items-center gap-3 rounded-2xl border border-border/60 bg-card/80 px-4 py-3.5 text-left shadow-soft backdrop-blur-sm transition-all hover:shadow-medium hover:border-primary/30 active:scale-[0.99]"
      onClick={() => router.push('/plan')}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Search className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">Où voulez-vous aller ?</p>
        <p className="text-xs text-muted-foreground">Destinations, dates, activités...</p>
      </div>
    </button>
  );
}
