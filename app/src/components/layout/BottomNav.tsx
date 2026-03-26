'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, Plus, Compass, Globe, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';

export function BottomNav() {
  const pathname = usePathname();

  // Hide on certain pages for a cleaner immersive experience
  if (pathname.startsWith('/trip/') || pathname === '/globe') return null;

  const items = [
    { href: '/mes-voyages', label: 'Voyages', icon: Map },
    { href: '/explore', label: 'Explorer', icon: Compass },
    { href: '/plan', label: 'Créer', icon: Plus, isAction: true },
    { href: '/globe', label: 'Globe', icon: Globe },
    { href: '/profil', label: 'Profil', icon: User },
  ];

  return (
    <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center px-6 pointer-events-none md:hidden">
      <nav className="relative flex items-center justify-around h-20 px-4 rounded-[2.5rem] bg-black/40 backdrop-blur-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] pointer-events-auto w-full max-w-[400px]">
        {items.map((item) => {
          const isActive = pathname === item.href;

          if (item.isAction) {
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => hapticImpactMedium()}
                className="relative -mt-14 active:scale-90 transition-transform duration-200"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-[#E2B35C] via-[#C5A059] to-[#8B6E37] shadow-[0_10px_25px_rgba(197,160,89,0.4)] border border-white/20">
                  <item.icon className="h-8 w-8 text-black stroke-[2.5px]" />
                </div>
                <div className="absolute -inset-1 bg-gold/20 blur-xl rounded-full -z-10" />
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => hapticImpactLight()}
              className="relative flex flex-col items-center justify-center w-14 h-14 rounded-2xl"
            >
              <div
                className={cn(
                  'transition-transform duration-200',
                  isActive ? 'text-gold scale-110 -translate-y-0.5' : 'text-white/40'
                )}
              >
                <item.icon className="h-6 w-6 stroke-[2px]" />
              </div>

              {isActive && (
                <span className="absolute -bottom-1 text-[9px] font-bold uppercase tracking-[0.1em] text-gold">
                  {item.label}
                </span>
              )}

              {isActive && (
                <div className="absolute -top-1 w-1 h-1 rounded-full bg-gold shadow-[0_0_10px_rgba(197,160,89,0.8)]" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
