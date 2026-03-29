'use client';

import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { isNativeApp } from '@/lib/mobile/runtime';
import { toast } from 'sonner';

interface AppleSignInProps {
  redirectTo?: string;
  className?: string;
}

export function AppleSignIn({ redirectTo, className }: AppleSignInProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    const supabase = getSupabaseClient();

    let postLoginPath = '/mes-voyages';
    if (redirectTo?.startsWith('/')) {
      postLoginPath = redirectTo;
    }

    const webCallback = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(postLoginPath)}`;
    const nativeRedirectUrl = 'com.naraevoyage.app://auth/callback';

    try {
      if (isNativeApp()) {
        // On native, use the same pattern as Google but with Apple provider
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: {
            redirectTo: nativeRedirectUrl,
            skipBrowserRedirect: true,
          },
        });

        if (error || !data?.url) {
          throw error || new Error('URL OAuth manquante');
        }

        // Open in system browser — the appUrlOpen listener in GoogleSignIn
        // already handles the callback for all OAuth providers
        const capacitor = (window as Window & { Capacitor?: { Plugins?: { Browser?: { open?: (opts: { url: string }) => Promise<void> } } } }).Capacitor;
        if (capacitor?.Plugins?.Browser?.open) {
          await capacitor.Plugins.Browser.open({ url: data.url });
        } else {
          window.location.assign(data.url);
        }
        return;
      }

      // Web flow
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: webCallback,
        },
      });

      if (error) throw error;
    } catch (error) {
      console.error('Error signing in with Apple:', error);
      toast.error('Connexion Apple impossible, réessayez.');
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleSignIn}
      disabled={isLoading}
      className={`gap-2 ${className || 'variant-outline'}`}
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <AppleIcon className="h-5 w-5" />
      )}
      Continuer avec Apple
    </Button>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
