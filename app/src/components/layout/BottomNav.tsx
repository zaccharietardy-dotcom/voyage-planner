'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, Plus, Compass, Globe, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/utils/haptics';

export function BottomNav() {
  const pathname = usePathname();

  // Hide on certain pages for a cleaner immersive experience
  if (pathname.startsWith('/trip/') || pathname === '/globe' || pathname === '/plan') return null;

  const items = [
    { href: '/mes-voyages', label: 'Voyages', icon: Map },
    { href: '/explore', label: 'Explorer', icon: Compass },
    { href: '/plan', label: 'Créer', icon: Plus, isAction: true },
    { href: '/globe', label: 'Globe', icon: Globe },
    { href: '/profil', label: 'Profil', icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden pointer-events-none">
      {/* Background gradient for better readability of floating nav */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#020617] to-transparent pointer-events-none" />
      
      <div className="relative pb-[env(safe-area-inset-bottom)] px-6 mb-4 flex justify-center pointer-events-auto">
        <nav className="relative flex items-center justify-around w-full max-w-[400px] h-20 px-4 rounded-[2.5rem] bg-black/60 backdrop-blur-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          {items.map((item) => {
            const isActive = pathname === item.href;

            if (item.isAction) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  onClick={() => hapticSelection()}
                  className="relative -mt-14 active:scale-90 transition-transform duration-200"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-gold-gradient shadow-[0_10px_30px_rgba(197,160,89,0.5)] border border-white/20">
                    <item.icon className="h-8 w-8 text-black stroke-[2.5px]" />
                  </div>
                  <div className="absolute -inset-2 bg-gold/30 blur-2xl rounded-full -z-10" />
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                onClick={() => hapticSelection()}
                className="relative flex flex-col items-center justify-center w-14 h-14 rounded-2xl active:scale-95 transition-transform"
              >
                <div
                  className={cn(
                    'transition-all duration-300',
                    isActive ? 'text-gold scale-110 -translate-y-1' : 'text-white/40'
                  )}
                >
                  <item.icon className="h-6 w-6 stroke-[2px]" />
                </div>

                {isActive && (
                  <span className="absolute bottom-2 text-[8px] font-black uppercase tracking-[0.15em] text-gold">
                    {item.label}
                  </span>
                )}

                {isActive && (
                  <div className="absolute top-2 w-1.5 h-1.5 rounded-full bg-gold shadow-[0_0_12px_rgba(197,160,89,1)]" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
