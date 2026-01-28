'use client';

import Link from 'next/link';
import { ArrowLeft, Sparkles, Users, Globe, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const values = [
  {
    icon: Sparkles,
    title: 'Intelligence Artificielle',
    description: 'Notre IA génère des itinéraires personnalisés en quelques secondes, adaptés à vos préférences et contraintes.',
  },
  {
    icon: Users,
    title: 'Collaboration',
    description: 'Planifiez à plusieurs, votez sur les activités et créez ensemble le voyage parfait.',
  },
  {
    icon: Globe,
    title: 'Authenticité',
    description: 'Nous privilégions les expériences locales authentiques, loin des pièges à touristes.',
  },
  {
    icon: Leaf,
    title: 'Éco-responsabilité',
    description: 'Calculez l\'empreinte carbone de votre voyage et faites des choix éclairés.',
  },
];

const team = [
  {
    name: 'Équipe Narae',
    role: 'Fondateurs',
    description: 'Passionnés de voyage et de technologie, nous avons créé Narae Voyage pour révolutionner la planification de voyage.',
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#0f2744] mb-6">
            <svg className="w-10 h-10" viewBox="0 0 32 32">
              <defs>
                <linearGradient id="wing-about" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" style={{ stopColor: '#c9a227' }} />
                  <stop offset="50%" style={{ stopColor: '#f4d03f' }} />
                  <stop offset="100%" style={{ stopColor: '#fff8dc' }} />
                </linearGradient>
              </defs>
              <path
                d="M8 24 C10 20, 14 12, 24 6 C20 10, 18 14, 18 18 C18 14, 16 12, 12 14 C14 16, 14 20, 10 24 Z"
                fill="url(#wing-about)"
              />
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">À propos de Narae Voyage</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Narae signifie &quot;aile&quot; en coréen. Notre mission : vous donner des ailes
            pour explorer le monde, simplement.
          </p>
        </div>

        {/* Story */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-6">Notre Histoire</h2>
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed text-lg">
              Narae Voyage est né d&apos;un constat simple : planifier un voyage prend trop de temps.
              Entre les recherches sur les blogs, les comparaisons d&apos;hôtels, les listes d&apos;activités
              et la coordination avec les amis, des heures s&apos;écoulent avant même de partir.
            </p>
            <p className="text-muted-foreground leading-relaxed text-lg mt-4">
              Nous avons créé une solution qui combine l&apos;intelligence artificielle et
              l&apos;expertise voyage pour générer des itinéraires sur mesure en quelques minutes.
              Plus qu&apos;un simple outil, Narae Voyage est un réseau social où vous pouvez
              partager vos aventures et vous inspirer des voyages des autres.
            </p>
          </div>
        </section>

        {/* Values */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-6">Nos Valeurs</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {values.map((value) => (
              <Card key={value.title} className="border-border/50">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <value.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">{value.title}</h3>
                      <p className="text-sm text-muted-foreground">{value.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Team */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-6">L&apos;Équipe</h2>
          <div className="grid gap-4">
            {team.map((member) => (
              <Card key={member.name} className="border-border/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <Users className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{member.name}</h3>
                      <p className="text-sm text-primary">{member.role}</p>
                      <p className="text-sm text-muted-foreground mt-1">{member.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold mb-6">Narae en Chiffres</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { number: '10K+', label: 'Voyages créés' },
              { number: '50+', label: 'Destinations' },
              { number: '4.8', label: 'Note moyenne' },
              { number: '100%', label: 'Gratuit' },
            ].map((stat) => (
              <Card key={stat.label} className="border-border/50">
                <CardContent className="p-6 text-center">
                  <div className="text-3xl font-bold text-primary">{stat.number}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center py-12 px-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
          <h2 className="text-2xl font-semibold mb-4">Prêt à voyager ?</h2>
          <p className="text-muted-foreground mb-6">
            Rejoignez des milliers de voyageurs qui planifient leurs aventures avec Narae.
          </p>
          <Button asChild size="lg">
            <Link href="/plan">Créer mon voyage</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
