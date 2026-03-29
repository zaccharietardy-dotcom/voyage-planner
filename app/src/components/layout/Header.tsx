'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Map, PlusCircle, Users, Globe, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

export function Header() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);

  // ALL hooks must be called before any conditional return
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setIsScrolled(window.scrollY > 20);
        ticking = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Hide on pages with their own header/fullscreen layout
  const hidden = pathname.startsWith('/trip/');
  if (hidden) return null;

  const navLinks = [
    { href: '/plan', label: t('nav.createTrip'), icon: PlusCircle },
    { href: '/explore', label: t('nav.explore'), icon: Compass },
    { href: '/globe', label: t('nav.globe'), icon: Globe },
    { href: '/mes-voyages', label: t('nav.myTrips'), icon: Map },
    { href: '/community', label: t('nav.community'), icon: Users },
  ];

  return (
    <header
      className={cn(
        'fixed left-0 right-0 top-0 z-50 px-4 py-4'
      )}
    >
      <div
        className={cn(
          "container mx-auto rounded-3xl transition-[background-color,border-color,box-shadow,padding] duration-300 border",
          isScrolled
            ? "bg-white/80 dark:bg-[#020617]/80 backdrop-blur-xl border-gold/20 shadow-2xl py-2 px-6"
            : "bg-transparent border-transparent py-4 px-4"
        )}
      >
        <div className="flex items-center justify-between">
          <Link href="/" className="z-50 inline-flex items-center gap-2.5">
            <Image
              src="/logo-narae.png"
              alt="Narae"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />
            <span className="font-display text-xl font-bold tracking-tight text-foreground">
              Narae <span className="text-gold italic">Voyage</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'relative rounded-full px-5 py-2 text-[10px] font-bold tracking-widest transition-all uppercase',
                  pathname === link.href
                    ? 'text-gold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {link.label}
                {pathname === link.href && (
                  <motion.div
                    layoutId="nav-underline"
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-gold"
                  />
                )}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 mr-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
