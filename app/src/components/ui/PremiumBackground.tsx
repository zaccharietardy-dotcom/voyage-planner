'use client';

export function PremiumBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#020617]">
      {/* Static mesh gradients — pure CSS, no JS animations */}
      <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gold/10 blur-[120px] animate-drift1" />
      <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[100px] animate-drift2" />
      <div className="absolute -bottom-[10%] left-[20%] w-[40%] h-[40%] rounded-full bg-gold/5 blur-[110px] animate-drift3" />

      {/* Subtle Noise Texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
    </div>
  );
}
