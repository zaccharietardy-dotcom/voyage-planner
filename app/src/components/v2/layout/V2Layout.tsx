'use client';

import { ReactNode } from 'react';
import { BottomNav } from './BottomNav';

interface V2LayoutProps {
  children: ReactNode;
  hideNav?: boolean;
}

export function V2Layout({ children, hideNav = false }: V2LayoutProps) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Main content */}
      <main className={`${hideNav ? '' : 'pb-20'}`}>
        {children}
      </main>

      {/* Bottom navigation */}
      {!hideNav && <BottomNav />}
    </div>
  );
}
