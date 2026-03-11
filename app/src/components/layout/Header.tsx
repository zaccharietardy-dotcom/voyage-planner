'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Map, PlusCircle, Users, Globe, MessageCircle } from 'lucide-react';
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

  const navLinks = [
    { href: '/plan', label: t('nav.createTrip'), icon: PlusCircle },
    { href: '/explore', label: t('nav.explore'), icon: Compass },
    { href: '/globe', label: t('nav.globe'), icon: Globe },
    { href: '/mes-voyages', label: t('nav.myTrips'), icon: Map },
    { href: '/community', label: t('nav.community'), icon: Users },
    { href: '/messages', label: t('nav.messages'), icon: MessageCircle },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed left-0 right-0 top-0 z-50 transition-all duration-300',
        isScrolled
          ? 'border-b border-[#1e3a5f]/12 bg-background/85 shadow-[0_8px_30px_rgba(10,22,40,0.08)] backdrop-blur-xl dark:bg-[#0a1628]/90'
          : 'bg-transparent'
      )}
    >
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="z-50 inline-flex items-center gap-2">
            <Image
              src="/logo-narae.png"
              alt="Narae Voyage"
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg object-cover shadow-sm"
              priority
            />
            <span className="font-display text-xl font-semibold tracking-tight">Narae Voyage</span>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-[#1e3a5f]/10 bg-background/70 p-1 backdrop-blur-md md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-medium transition-all',
                  pathname === link.href
                    ? 'bg-[#102a45] text-white shadow-sm dark:bg-[#d4a853] dark:text-[#102a45]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <NotificationBell />
            <UserMenu />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
