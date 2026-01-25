import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Users, Sparkles, Calendar, Share2, Wallet } from 'lucide-react';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'IA Intelligente',
    description: 'Génération automatique d\'itinéraires personnalisés selon vos préférences',
  },
  {
    icon: Users,
    title: 'Voyage en groupe',
    description: 'Invitez vos amis et planifiez ensemble en temps réel',
  },
  {
    icon: Calendar,
    title: 'Planning détaillé',
    description: 'Horaires, restaurants, activités - tout organisé jour par jour',
  },
  {
    icon: MapPin,
    title: 'Carte interactive',
    description: 'Visualisez votre itinéraire et tous les points d\'intérêt',
  },
  {
    icon: Share2,
    title: 'Partage facile',
    description: 'Partagez vos voyages et inspirez-vous de la communauté',
  },
  {
    icon: Wallet,
    title: 'Gestion des dépenses',
    description: 'Tricount intégré pour partager les frais équitablement',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            Planification de voyage propulsée par l'IA
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Planifiez votre voyage
            <span className="text-primary"> parfait</span>
            <br />en quelques clics
          </h1>

          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Dites-nous où vous voulez aller, vos préférences, et notre IA génère
            un itinéraire complet. Modifiez-le avec vos amis en temps réel.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/plan">
              <Button size="lg" className="text-lg px-8 py-6 gap-2">
                <MapPin className="h-5 w-5" />
                Planifier un voyage
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="text-lg px-8 py-6">
              Voir un exemple
            </Button>
          </div>
        </div>

        {/* Demo preview */}
        <div className="mt-16 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none h-32 bottom-0 top-auto" />
          <Card className="max-w-4xl mx-auto overflow-hidden shadow-2xl border-2">
            <CardContent className="p-0">
              <div className="bg-muted/50 p-4 border-b flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-sm text-muted-foreground ml-2">voyage.app</span>
              </div>
              <div className="p-8 bg-gradient-to-br from-card to-muted/20 min-h-[300px] flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <MapPin className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-lg">Aperçu de l'interface à venir...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Features Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Tout ce dont vous avez besoin</h2>
          <p className="text-muted-foreground text-lg">
            Des outils puissants pour planifier le voyage parfait
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="border-2 hover:border-primary/50 transition-colors">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-3xl mx-auto bg-primary text-primary-foreground">
          <CardContent className="p-8 md:p-12 text-center">
            <h2 className="text-3xl font-bold mb-4">Prêt à partir ?</h2>
            <p className="text-lg opacity-90 mb-6">
              Créez votre premier itinéraire en moins de 2 minutes
            </p>
            <Link href="/plan">
              <Button size="lg" variant="secondary" className="text-lg px-8 py-6">
                Commencer maintenant
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>Voyage - Planificateur de voyage IA</p>
        </div>
      </footer>
    </div>
  );
}
