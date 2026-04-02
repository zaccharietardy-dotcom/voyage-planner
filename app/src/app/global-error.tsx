'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="min-h-screen bg-background">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="max-w-md text-center">
            <div className="relative mb-8">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-12 w-12 text-red-600 dark:text-red-400" />
              </div>
            </div>

            <h1 className="mb-4 text-3xl font-bold">Une erreur critique est survenue</h1>
            <p className="mb-2 text-muted-foreground">
              Désolé, quelque chose s&apos;est mal passé. Notre équipe a été notifiée
              et travaille à résoudre le problème.
            </p>

            {error.digest && (
              <p className="mb-8 font-mono text-xs text-muted-foreground">
                Code erreur : {error.digest}
              </p>
            )}

            <div className="flex flex-col justify-center gap-3 sm:flex-row">
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
          </div>
        </div>
      </body>
    </html>
  );
}
