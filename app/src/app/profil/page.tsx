'use client';

import { LogOut, Loader2, ArrowLeft, MapPin, Settings } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ProfilPage() {
  const { user, profile, isLoading, signOut } = useAuth();
  const router = useRouter();

  // Rediriger si non connecté
  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Données du profil Google ou Supabase
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null;
  const email = profile?.email || user.email || '';

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="relative h-32 bg-gradient-to-r from-primary to-primary/80">
        <Link
          href="/"
          className="absolute top-4 left-4 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </Link>
        <Link
          href="/preferences"
          className="absolute top-4 right-4 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          <Settings className="w-5 h-5 text-white" />
        </Link>
      </div>

      {/* Profile info */}
      <div className="px-4 -mt-16 relative z-10 max-w-lg mx-auto">
        <div className="flex flex-col items-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-24 h-24 rounded-full border-4 border-background object-cover shadow-lg"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-24 h-24 rounded-full border-4 border-background bg-primary flex items-center justify-center shadow-lg">
              <span className="text-3xl font-bold text-primary-foreground">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold mt-4">{displayName}</h1>
          <p className="text-muted-foreground text-sm">{email}</p>
        </div>

        {/* Quick actions */}
        <div className="mt-8 space-y-3">
          <Link href="/mes-voyages" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Mes voyages</h3>
                  <p className="text-sm text-muted-foreground">Voir et gérer mes voyages</p>
                </div>
                <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/preferences" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Settings className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Préférences de voyage</h3>
                  <p className="text-sm text-muted-foreground">Style, budget, régime alimentaire</p>
                </div>
                <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Sign out button */}
        <Button
          variant="outline"
          onClick={handleSignOut}
          className="w-full mt-8 text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}
