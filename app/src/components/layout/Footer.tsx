'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import Link from 'next/link';
import { Twitter, Instagram, Facebook, Youtube } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

const socialLinks = [
  { icon: Twitter, href: 'https://twitter.com/naraevoyage', label: 'Twitter' },
  { icon: Instagram, href: 'https://instagram.com/naraevoyage', label: 'Instagram' },
  { icon: Facebook, href: 'https://facebook.com/naraevoyage', label: 'Facebook' },
  { icon: Youtube, href: 'https://youtube.com/@naraevoyage', label: 'YouTube' },
];

export function Footer() {
  const { t } = useTranslation();

  const footerLinks = useMemo(() => ({
    product: {
      title: t('footer.productTitle'),
      links: [
        { label: t('footer.createTrip'), href: '/plan' },
        { label: t('footer.explore'), href: '/explore' },
        { label: t('footer.myTrips'), href: '/mes-voyages' },
        { label: t('footer.features'), href: '/#features' },
      ],
    },
    company: {
      title: t('footer.companyTitle'),
      links: [
        { label: t('footer.about'), href: '/about' },
        { label: t('footer.contact'), href: '/contact' },
        { label: t('footer.faq'), href: '/faq' },
      ],
    },
    legal: {
      title: t('footer.legalTitle'),
      links: [
        { label: t('footer.terms'), href: '/cgu' },
        { label: t('footer.privacy'), href: '/privacy' },
      ],
    },
  }), [t]);

  return (
    <footer className="relative overflow-hidden bg-[#020617] text-white pt-24 pb-12">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-6 mb-20">
          <div className="lg:col-span-2">
            <Link href="/" className="mb-8 inline-flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gold-gradient p-[1px]">
                <div className="h-full w-full rounded-[10px] bg-[#020617] flex items-center justify-center">
                  <Image
                    src="/logo-narae.png"
                    alt="Narae"
                    width={24}
                    height={24}
                    className="h-6 w-6"
                  />
                </div>
              </div>
              <span className="font-display text-2xl font-bold tracking-tight">Narae <span className="text-gold italic">Voyage</span></span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-slate-400 mb-8">
              {t('footer.tagline')}
            </p>
            <div className="flex items-center gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-10 w-10 rounded-full border border-white/10 flex items-center justify-center text-slate-400 transition-all hover:border-gold hover:text-gold hover:scale-110"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {Object.entries(footerLinks).map(([key, section]) => (
            <div key={key} className="lg:col-span-1">
              <h3 className="mb-6 text-xs font-bold uppercase tracking-[0.2em] text-gold">{section.title}</h3>
              <ul className="space-y-4">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-slate-400 transition-colors hover:text-white font-medium">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          
          <div className="lg:col-span-1">
            <h3 className="mb-6 text-xs font-bold uppercase tracking-[0.2em] text-gold">News</h3>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-1 flex items-center">
              <input 
                type="email" 
                placeholder="Votre email" 
                className="bg-transparent border-none focus:ring-0 text-xs px-3 py-2 w-full text-white placeholder:text-slate-500"
              />
              <button className="bg-gold text-[#020617] px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider">OK</button>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-6 border-t border-white/10 pt-10 md:flex-row text-slate-500 font-medium">
          <p className="text-xs">&copy; {new Date().getFullYear()} Narae Voyage. {t('footer.allRights')}</p>
          <div className="flex items-center gap-8 text-[10px] uppercase tracking-widest font-bold">
            <Link href="/privacy" className="hover:text-gold transition-colors">Privacy</Link>
            <Link href="/cgu" className="hover:text-gold transition-colors">Terms</Link>
            <Link href="/cookies" className="hover:text-gold transition-colors">Cookies</Link>
          </div>
          <p className="text-xs">{t('footer.madeIn')}</p>
        </div>
      </div>
    </footer>
  );
}

