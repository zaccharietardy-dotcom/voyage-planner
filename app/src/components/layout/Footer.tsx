'use client';

import Image from 'next/image';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Check, Twitter, Instagram, Facebook, Youtube } from 'lucide-react';

const footerLinks = {
  product: {
    title: 'Produit',
    links: [
      { label: 'Créer un voyage', href: '/plan' },
      { label: 'Explorer', href: '/explore' },
      { label: 'Mes voyages', href: '/mes-voyages' },
      { label: 'Fonctionnalités', href: '/#features' },
    ],
  },
  company: {
    title: 'Entreprise',
    links: [
      { label: 'À propos', href: '/about' },
      { label: 'Contact', href: '/contact' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  legal: {
    title: 'Légal',
    links: [
      { label: 'CGU', href: '/cgu' },
      { label: 'Confidentialité', href: '/privacy' },
    ],
  },
};

const socialLinks = [
  { icon: Twitter, href: 'https://twitter.com/naraevoyage', label: 'Twitter' },
  { icon: Instagram, href: 'https://instagram.com/naraevoyage', label: 'Instagram' },
  { icon: Facebook, href: 'https://facebook.com/naraevoyage', label: 'Facebook' },
  { icon: Youtube, href: 'https://youtube.com/@naraevoyage', label: 'YouTube' },
];

export function Footer() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    setIsSubscribed(true);
    setEmail('');
  };

  return (
    <footer className="relative overflow-hidden border-t border-[#1e3a5f]/12 bg-gradient-to-b from-transparent to-[#102a45]/5">
      <div className="container mx-auto px-4 py-14">
        <div className="rounded-3xl border border-[#1e3a5f]/10 bg-background/75 p-8 shadow-xl backdrop-blur-lg md:p-10">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-2">
              <Link href="/" className="mb-4 inline-flex items-center gap-2">
                <Image
                  src="/logo-narae.png"
                  alt="Narae Voyage"
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover"
                />
                <span className="font-display text-2xl font-semibold tracking-tight">Narae Voyage</span>
              </Link>
              <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Planifie, collabore et partage des voyages de qualité avec une expérience pensée pour aller vite,
                sans perdre la précision.
              </p>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-[#b8923d]">Newsletter</p>
                {isSubscribed ? (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    Merci pour votre inscription.
                  </div>
                ) : (
                  <form onSubmit={handleNewsletterSubmit} className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="votre@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="max-w-[240px] border-[#1e3a5f]/15 bg-background/80"
                      required
                    />
                    <Button type="submit" size="icon" className="bg-[#102a45] text-white hover:bg-[#173a5f]" disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </form>
                )}
                <p className="text-xs text-muted-foreground">Conseils pratiques, nouveautés produit, idées d&apos;itinéraires.</p>
              </div>
            </div>

            {Object.entries(footerLinks).map(([key, section]) => (
              <div key={key}>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-foreground/80">{section.title}</h3>
                <ul className="space-y-3">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-[#1e3a5f]/10 pt-6 md:flex-row">
            <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Narae Voyage. Tous droits réservés.</p>

            <div className="flex items-center gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-[#1e3a5f]/15 p-2 text-muted-foreground transition-all hover:border-[#d4a853]/50 hover:text-[#d4a853]"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>

            <p className="text-sm text-muted-foreground">Conçu en France</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
