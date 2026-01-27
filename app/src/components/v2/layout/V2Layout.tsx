'use client';

import { ReactNode } from 'react';
import { BottomNav } from './BottomNav';

interface V2LayoutProps {
  children: ReactNode;
  hideNav?: boolean;
}

export function V2Layout({ children, hideNav = false }: V2LayoutProps) {
  return (
    <div className="min-h-screen bg-[#0a1628] text-white relative">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 bg-gradient-to-b from-[#0a1628] via-[#0d1f35] to-[#0a1628] pointer-events-none" />

      {/* Optional subtle pattern overlay */}
      <div
        className="fixed inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, #d4a853 1px, transparent 1px)`,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Main content */}
      <main className={`relative ${hideNav ? '' : 'pb-20'}`}>
        {children}
      </main>

      {/* Bottom navigation */}
      {!hideNav && <BottomNav />}
    </div>
  );
}
