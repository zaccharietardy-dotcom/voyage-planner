'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, Users, CheckCircle, XCircle } from 'lucide-react';
import Link from 'next/link';

type JoinStatus = 'loading' | 'checking' | 'joining' | 'success' | 'error' | 'already_member' | 'not_authenticated';

export default function JoinTripPage() {
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<JoinStatus>('loading');
  const [error, setError] = useState<string>('');
  const [tripInfo, setTripInfo] = useState<{ id: string; title: string; destination: string } | null>(null);

  // Read role from URL query params
  const [joinRole, setJoinRole] = useState<'viewer' | 'editor'>('viewer');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role');
    if (role === 'editor') setJoinRole('editor');
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus('not_authenticated');
      return;
    }

    joinTrip();
  }, [user, authLoading, code]);

  async function joinTrip() {
    setStatus('checking');
    const supabase = getSupabaseClient();

    try {
      // Trouver le voyage par code de partage
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .select('id, title, destination')
        .eq('share_code', code)
        .single();

      if (tripError || !trip) {
        setStatus('error');
        setError('Ce lien de partage est invalide ou a expiré.');
        return;
      }

      setTripInfo(trip);

      // Vérifier si l'utilisateur est déjà membre
      const { data: existingMember } = await supabase
        .from('trip_members')
        .select('id')
        .eq('trip_id', trip.id)
        .eq('user_id', user!.id)
        .single();

      if (existingMember) {
        setStatus('already_member');
        return;
      }

      // Ajouter comme membre (contrainte UNIQUE sur trip_id+user_id gère la race condition)
      setStatus('joining');
      const { error: joinError } = await supabase.from('trip_members').insert({
        trip_id: trip.id,
        user_id: user!.id,
        role: joinRole,
      });

      if (joinError) {
        // Si conflit de contrainte unique, l'utilisateur est déjà membre (race condition)
        if (joinError.code === '23505') {
          setStatus('already_member');
          return;
        }
        setStatus('error');
        setError('Impossible de rejoindre ce voyage. Veuillez réessayer.');
        return;
      }

      // Log d'activité
      await supabase.from('activity_log').insert({
        trip_id: trip.id,
        user_id: user!.id,
        action: 'member_joined',
        details: { joinMethod: 'share_link' },
      });

      setStatus('success');

      // Rediriger après 2 secondes
      setTimeout(() => {
        router.push(`/trip/${trip.id}`);
      }, 2000);
    } catch (err) {
      console.error('Error joining trip:', err);
      setStatus('error');
      setError('Une erreur est survenue. Veuillez réessayer.');
    }
  }

  // Non authentifié
  if (status === 'not_authenticated') {
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
            <Link href="/">Retour à l'accueil</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
