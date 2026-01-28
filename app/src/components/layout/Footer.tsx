'use client';

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
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSubmitting(false);
    setIsSubscribed(true);
    setEmail('');
  };

  return (
    <footer className="bg-muted/30 border-t">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#0f2744] flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 32 32">
                  <defs>
                    <linearGradient id="wing-footer" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" style={{ stopColor: '#c9a227' }} />
                      <stop offset="50%" style={{ stopColor: '#f4d03f' }} />
                      <stop offset="100%" style={{ stopColor: '#fff8dc' }} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M8 24 C10 20, 14 12, 24 6 C20 10, 18 14, 18 18 C18 14, 16 12, 12 14 C14 16, 14 20, 10 24 Z"
                    fill="url(#wing-footer)"
                  />
                </svg>
              </div>
              <span className="font-bold text-xl">Narae Voyage</span>
            </Link>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs">
              Planifie tes voyages avec l&apos;IA, partage tes aventures et découvre le monde avec Narae.
            </p>

            {/* Newsletter */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Newsletter</p>
              {isSubscribed ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Merci pour votre inscription !
                </div>
              ) : (
                <form onSubmit={handleNewsletterSubmit} className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="votre@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="max-w-[220px]"
                    required
                  />
                  <Button type="submit" size="icon" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              )}
              <p className="text-xs text-muted-foreground">
                Recevez nos conseils voyage et nouveautés
              </p>
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([key, section]) => (
            <div key={key}>
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-8 border-t flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Narae Voyage. Tous droits réservés.
          </p>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            {socialLinks.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={social.label}
              >
                <social.icon className="h-5 w-5" />
              </a>
            ))}
          </div>

          <p className="text-sm text-muted-foreground">
            Made with ❤️ in France
          </p>
        </div>
      </div>
    </footer>
  );
}
