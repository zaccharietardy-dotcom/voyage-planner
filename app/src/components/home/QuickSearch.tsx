'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export function QuickSearch() {
  const router = useRouter();

  return (
    <div className="flex justify-center w-full">
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        className="group w-full max-w-lg rounded-2xl bg-gold-gradient px-8 py-4 shadow-lg shadow-gold/20 transition-all hover:shadow-xl hover:shadow-gold/30"
        onClick={() => router.push('/plan')}
      >
        <div className="flex items-center justify-center gap-3">
          <span className="text-lg font-display font-bold tracking-wide text-[#020617]">
            Planifier un voyage
          </span>
          <ArrowRight className="h-5 w-5 text-[#020617]/70 transition-transform group-hover:translate-x-1" />
        </div>
      </motion.button>
    </div>
  );
}

