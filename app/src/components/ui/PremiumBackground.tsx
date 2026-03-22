'use client';

import { motion } from 'framer-motion';

export function PremiumBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#020617]">
      {/* Mesh Gradients */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 50, 0],
          y: [0, 30, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gold/10 blur-[120px]"
      />
      <motion.div
        animate={{
          scale: [1.2, 1, 1.2],
          x: [0, -50, 0],
          y: [0, -40, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[100px]"
      />
      <motion.div
        animate={{
          scale: [1, 1.3, 1],
          x: [0, 30, 0],
          y: [0, 60, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-[10%] left-[20%] w-[40%] h-[40%] rounded-full bg-gold/5 blur-[110px]"
      />
      
      {/* Subtle Noise Texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
    </div>
  );
}
