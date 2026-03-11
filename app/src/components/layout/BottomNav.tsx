'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, PlusCircle, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const pathname = usePathname();

  // Hide on trip pages (fullscreen map + bottom sheet)
  if (pathname.startsWith('/trip/')) return null;

  const items = [
    { href: '/mes-voyages', label: 'Voyages', icon: Map },
    { href: '/plan', label: 'Créer', icon: PlusCircle, accent: true },
    { href: '/explore', label: 'Explorer', icon: Compass },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 px-4 py-1.5 transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground',
                item.accent && !isActive && 'text-foreground'
              )}
            >
              {item.accent ? (
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full -mt-4 shadow-md transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-primary/90 text-primary-foreground'
                )}>
                  <item.icon className="h-5 w-5" />
                </div>
              ) : (
                <item.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5px]')} />
              )}
              <span className={cn(
                'text-[10px] font-medium',
                item.accent && '-mt-0.5'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
