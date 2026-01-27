'use client';

import { V2Layout } from '@/components/v2/layout/V2Layout';
import { Map, Plus } from 'lucide-react';
import Link from 'next/link';

export default function TripsPage() {
  return (
    <V2Layout>
      <div className="min-h-screen p-4 pt-12 safe-area-top">
        <h1 className="text-2xl font-bold text-white mb-6">Mes Voyages</h1>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-20 h-20 rounded-full bg-[#1a1a24] flex items-center justify-center mb-4">
            <Map className="w-10 h-10 text-gray-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Pas encore de voyages
          </h2>
          <p className="text-gray-400 text-center mb-6 max-w-xs">
            Commence à planifier ton premier voyage avec l'aide de l'IA
          </p>
          <Link
            href="/v2/create"
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-medium"
          >
            <Plus className="w-5 h-5" />
            Créer un voyage
          </Link>
        </div>
      </div>
    </V2Layout>
  );
}
