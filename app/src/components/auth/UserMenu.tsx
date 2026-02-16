'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, User, Map, Settings, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface UserMenuProps {
  onAction?: () => void;
  mode?: 'dropdown' | 'panel';
}

export function UserMenu({ onAction, mode = 'dropdown' }: UserMenuProps) {
  const { user, profile, isLoading, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleNavigate = () => {
    setIsOpen(false);
    onAction?.();
  };

  const handleSignOut = async () => {
    setIsOpen(false);
    onAction?.();
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
    }
    window.location.href = '/';
  };

  if (isLoading) {
    return (
      <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
    );
  }

  if (!user) {
    return (
      <Button asChild variant="default" size="default" className="px-6">
        <Link href="/login" onClick={handleNavigate}>Connexion</Link>
      </Button>
    );
  }

  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || undefined;
  const displayName = profile?.display_name || user.user_metadata?.full_name || 'Utilisateur';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  if (mode === 'panel') {
    return (
      <div className="space-y-3">
        <Link
          href="/profil"
          onClick={handleNavigate}
          className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
        >
          <Avatar className="h-10 w-10 border-2 border-primary/20">
            <AvatarImage src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" />
            <AvatarFallback className="text-sm font-semibold bg-primary/10">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            {(profile?.email || user.email) && (
              <p className="truncate text-xs text-muted-foreground">{profile?.email || user.email}</p>
            )}
          </div>
        </Link>

        <div className="grid gap-1.5">
          <Link
            href="/mes-voyages"
            onClick={handleNavigate}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Map className="h-4 w-4" />
            Mes voyages
          </Link>
          <Link
            href="/profil"
            onClick={handleNavigate}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <User className="h-4 w-4" />
            Mon profil
          </Link>
          <Link
            href="/preferences"
            onClick={handleNavigate}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Settings className="h-4 w-4" />
            Préférences
          </Link>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={isSigningOut}
          onClick={handleSignOut}
          className="w-full justify-start gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/40 dark:hover:bg-red-950"
        >
          {isSigningOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          {isSigningOut ? 'Déconnexion...' : 'Déconnexion'}
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0 hover:ring-2 hover:ring-primary/50 transition-all">
          <Avatar className="h-10 w-10 border-2 border-primary/20">
            <AvatarImage src={avatarUrl} alt={displayName} referrerPolicy="no-referrer" />
            <AvatarFallback className="text-sm font-semibold bg-primary/10">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 z-[120]" align="end" forceMount>
        <div className="flex items-center justify-start gap-2 p-2">
          <div className="flex flex-col space-y-1 leading-none">
            {profile?.display_name && (
              <p className="font-medium">{profile.display_name}</p>
            )}
            {profile?.email && (
              <p className="w-[200px] truncate text-sm text-muted-foreground">
                {profile.email}
              </p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer" onSelect={handleNavigate}>
          <Link href="/mes-voyages" onClick={handleNavigate} className="w-full flex items-center">
            <Map className="mr-2 h-4 w-4" />
            Mes voyages
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer" onSelect={handleNavigate}>
          <Link href="/profil" onClick={handleNavigate} className="w-full flex items-center">
            <User className="mr-2 h-4 w-4" />
            Mon profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer" onSelect={handleNavigate}>
          <Link href="/preferences" onClick={handleNavigate} className="w-full flex items-center">
            <Settings className="mr-2 h-4 w-4" />
            Préférences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none text-red-600 hover:bg-red-50 dark:hover:bg-red-950 focus:bg-red-50 dark:focus:bg-red-950 disabled:pointer-events-none disabled:opacity-50"
        >
          {isSigningOut ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          {isSigningOut ? 'Déconnexion...' : 'Déconnexion'}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
