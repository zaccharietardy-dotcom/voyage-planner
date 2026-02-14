'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, Users, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';

type JoinStatus = 'loading' | 'checking' | 'joining' | 'success' | 'error' | 'already_member';

export default function JoinTripPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<JoinStatus>('loading');
  const [error, setError] = useState<string>('');
  const [tripInfo, setTripInfo] = useState<{ id: string; title: string; destination: string } | null>(null);

  const joinTrip = useCallback(async () => {
    if (!user) {
      return;
    }

    setStatus('checking');

    try {
      const response = await fetch('/api/trips/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const payload = await response.json() as {
        error?: string;
        status?: 'joined' | 'already_member';
        trip?: { id: string; title: string; destination: string };
      };

      if (!response.ok || !payload.trip || !payload.status) {
        setStatus('error');
        setError(payload.error || 'Ce lien de partage est invalide ou a expiré.');
        return;
      }

      setTripInfo(payload.trip);
      setStatus(payload.status === 'already_member' ? 'already_member' : 'success');

      // Rediriger après 2 secondes
      setTimeout(() => {
        router.push(`/trip/${payload.trip!.id}`);
      }, 2000);
    } catch (err) {
      console.error('Error joining trip:', err);
      setStatus('error');
      setError('Une erreur est survenue. Veuillez réessayer.');
    }
  }, [code, router, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    joinTrip();
  }, [user, authLoading, joinTrip]);

  // Non authentifié
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Rejoindre un voyage</CardTitle>
            <CardDescription>
              Connectez-vous pour rejoindre ce voyage partagé
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href={`/login?redirect=/join/${code}`}>
                Se connecter pour rejoindre
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Chargement
  if (status === 'loading' || status === 'checking' || status === 'joining') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
            <p className="text-muted-foreground">
              {status === 'checking' && 'Vérification du lien...'}
              {status === 'joining' && 'Vous rejoignez le voyage...'}
              {status === 'loading' && 'Chargement...'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Succès
  if (status === 'success' && tripInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle>Bienvenue !</CardTitle>
            <CardDescription>
              Vous avez rejoint le voyage
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <div className="p-4 bg-muted rounded-lg mb-4">
              <h3 className="font-semibold">{tripInfo.title}</h3>
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <MapPin className="h-3 w-3" />
                {tripInfo.destination}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Redirection en cours...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Déjà membre
  if (status === 'already_member' && tripInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <CardTitle>Déjà membre</CardTitle>
            <CardDescription>
              Vous faites déjà partie de ce voyage
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <div className="p-4 bg-muted rounded-lg mb-4">
              <h3 className="font-semibold">{tripInfo.title}</h3>
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <MapPin className="h-3 w-3" />
                {tripInfo.destination}
              </p>
            </div>
            <Button asChild className="w-full">
              <Link href={`/trip/${tripInfo.id}`}>
                Voir le voyage
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Erreur
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle>Lien invalide</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Retour à l&apos;accueil</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
