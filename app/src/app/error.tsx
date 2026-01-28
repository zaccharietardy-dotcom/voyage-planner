'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* Illustration */}
        <div className="relative mb-8">
          <div className="w-24 h-24 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-12 h-12 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-4">Une erreur est survenue</h1>
        <p className="text-muted-foreground mb-2">
          Désolé, quelque chose s&apos;est mal passé. Notre équipe a été notifiée
          et travaille à résoudre le problème.
        </p>

        {error.digest && (
          <p className="text-xs text-muted-foreground mb-8 font-mono">
            Code erreur : {error.digest}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset} variant="default" size="lg">
            <RefreshCw className="mr-2 h-4 w-4" />
            Réessayer
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/">
              <Home className="mr-2 h-4 w-4" />
              Retour à l&apos;accueil
            </Link>
          </Button>
        </div>

        <div className="mt-12 p-4 rounded-lg bg-muted/50">
          <p className="text-sm text-muted-foreground">
            Si le problème persiste, n&apos;hésitez pas à{' '}
            <Link href="/contact" className="text-primary hover:underline">
              nous contacter
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
