'use client';

import Link from 'next/link';
import { Home, Search, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* Illustration */}
        <div className="relative mb-8">
          <div className="text-[150px] font-bold text-muted-foreground/10 leading-none select-none">
            404
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <img src="/logo-narae.png" alt="Narae Voyage" className="w-24 h-24 rounded-lg object-cover animate-bounce" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-4">Page introuvable</h1>
        <p className="text-muted-foreground mb-8">
          Oups ! Cette page semble avoir pris son envol vers une destination inconnue.
          Peut-être qu&apos;elle planifie son propre voyage ?
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild variant="default" size="lg">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Retour à l&apos;accueil
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/plan">
              <Search className="mr-2 h-4 w-4" />
              Créer un voyage
            </Link>
          </Button>
        </div>

        <button
          onClick={() => window.history.back()}
          className="mt-8 text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Revenir en arrière
        </button>
      </div>
    </div>
  );
}
