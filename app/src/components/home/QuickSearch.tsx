'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export function QuickSearch() {
  const router = useRouter();

  return (
    <div className="flex justify-center w-full">
      <motion.button
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        className="group relative w-full overflow-hidden rounded-[2rem] bg-gold-gradient p-[1px] shadow-xl shadow-gold/20 transition-all hover:shadow-2xl hover:shadow-gold/30"
        onClick={() => router.push('/plan')}
      >
        <div className="flex h-full w-full items-center justify-center gap-4 rounded-[1.95rem] bg-[#020617] px-10 py-5 text-white transition-colors group-hover:bg-transparent">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 group-hover:bg-white/20 transition-colors">
            <Zap className="h-5 w-5 text-gold group-hover:text-white" />
          </div>
          <span className="text-xl font-display font-bold tracking-wide">
            Commencer une nouvelle aventure
          </span>
          <ArrowRight className="h-6 w-6 text-gold transition-transform group-hover:translate-x-1 group-hover:text-white" />
        </div>
      </motion.button>
    </div>
  );
}

