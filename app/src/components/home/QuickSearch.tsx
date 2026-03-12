'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

export function QuickSearch() {
  const router = useRouter();

  return (
    <div className="flex justify-center">
      <button
        className="w-full sm:w-auto flex items-center justify-center gap-3 rounded-2xl bg-[#d4a853] px-8 py-4 text-[#0a1628] text-lg font-semibold shadow-medium transition-all hover:bg-[#e8c068] hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
        onClick={() => router.push('/plan')}
      >
        Créer mon voyage
        <ArrowRight className="h-5 w-5" />
      </button>
    </div>
  );
}
