'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Globe, Map, Plus, Users, User, Compass, Sparkles } from 'lucide-react';

const navItems = [
  { href: '/v2', icon: Compass, label: 'Parcourir' },
  { href: '/v2/trips', icon: Map, label: 'Voyages' },
  { href: '/v2/create', icon: Plus, label: 'Créer', isCenter: true },
  { href: '/v2/community', icon: Users, label: 'Amis' },
  { href: '/v2/profile', icon: User, label: 'Profil' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      {/* Blur background with subtle gold top border */}
      <div className="absolute inset-0 bg-[#0a1628]/90 backdrop-blur-xl border-t border-[#d4a853]/20" />

      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a1628] to-transparent opacity-50" />

      <div className="relative flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/v2' && pathname.startsWith(item.href));
          const Icon = item.icon;

          if (item.isCenter) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative -mt-6"
              >
                <motion.div
                  whileTap={{ scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  className="relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4a853] to-[#b8923d] shadow-lg shadow-[#d4a853]/40"
                >
                  {/* Glow effect */}
                  <div className="absolute inset-0 rounded-full bg-[#d4a853] blur-md opacity-40" />
                  <Icon className="relative w-6 h-6 text-[#0a1628]" strokeWidth={2.5} />
                </motion.div>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-col items-center justify-center flex-1 h-full"
            >
              <motion.div
                whileTap={{ scale: 0.9 }}
                className="flex flex-col items-center gap-1"
              >
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 transition-all duration-300 ${
                      isActive
                        ? 'text-[#d4a853] drop-shadow-[0_0_8px_rgba(212,168,83,0.5)]'
                        : 'text-[#6b8aab]'
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {isActive && (
                    <motion.div
                      layoutId="navIndicator"
                      className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#d4a853] shadow-[0_0_8px_rgba(212,168,83,0.6)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium transition-all duration-300 ${
                    isActive ? 'text-[#d4a853]' : 'text-[#6b8aab]'
                  }`}
                >
                  {item.label}
                </span>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
