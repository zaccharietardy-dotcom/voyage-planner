'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, Compass, Map, PlusCircle, Users, Globe, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/plan', label: 'Créer un voyage', icon: PlusCircle },
  { href: '/explore', label: 'Explorer', icon: Compass },
  { href: '/globe', label: 'Globe', icon: Globe },
  { href: '/mes-voyages', label: 'Mes voyages', icon: Map },
  { href: '/community', label: 'Communauté', icon: Users },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
];

export function Header() {
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <header
        className={cn(
          'fixed left-0 right-0 top-0 z-50 transition-all duration-300',
          isScrolled
            ? 'border-b border-[#1e3a5f]/12 bg-background/85 shadow-[0_8px_30px_rgba(10,22,40,0.08)] backdrop-blur-xl'
            : 'bg-transparent'
        )}
      >
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="z-50 inline-flex items-center gap-2" onClick={closeMobileMenu}>
              <Image
                src="/logo-narae.png"
                alt="Narae Voyage"
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg object-cover shadow-sm"
                priority
              />
              <span className="font-display hidden text-xl font-semibold tracking-tight sm:inline">Narae Voyage</span>
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
              <div className="hidden md:block">
                <UserMenu />
              </div>
              <ThemeToggle />

              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              >
                {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/45 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      <div
        className={cn(
          'fixed bottom-0 right-0 top-0 z-40 w-72 border-l border-[#1e3a5f]/15 bg-background/95 px-4 pb-6 pt-20 backdrop-blur-xl transition-transform duration-300 md:hidden',
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <nav className="flex flex-col gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={closeMobileMenu}
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition-colors',
                pathname === link.href
                  ? 'bg-[#102a45]/10 text-[#102a45] dark:bg-[#d4a853]/20 dark:text-[#f4d03f]'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <link.icon className="h-5 w-5" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="mt-6 border-t border-border pt-4">
          <UserMenu />
        </div>
      </div>
    </>
  );
}
