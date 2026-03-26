'use client';

export function PremiumBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#020617]">
      {/* Static mesh gradients — no JS animations, pure CSS for mobile perf */}
      <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] rounded-full bg-gold/10 blur-[120px] animate-[drift1_20s_ease-in-out_infinite]" />
      <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[100px] animate-[drift2_25s_ease-in-out_infinite]" />
      <div className="absolute -bottom-[10%] left-[20%] w-[40%] h-[40%] rounded-full bg-gold/5 blur-[110px] animate-[drift3_18s_ease-in-out_infinite]" />

      {/* Subtle Noise Texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      <style jsx>{`
        @keyframes drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, 30px) scale(1.2); }
        }
        @keyframes drift2 {
          0%, 100% { transform: translate(0, 0) scale(1.2); }
          50% { transform: translate(-50px, -40px) scale(1); }
        }
        @keyframes drift3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, 60px) scale(1.3); }
        }
      `}</style>
    </div>
  );
}
