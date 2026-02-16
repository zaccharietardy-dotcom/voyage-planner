'use client';

import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { isNativeApp } from '@/lib/mobile/runtime';
import { toast } from 'sonner';

interface GoogleSignInProps {
  redirectTo?: string;
  className?: string;
}

type AppUrlOpenEvent = { url?: string };

type NativeListenerHandle = {
  remove: () => Promise<void> | void;
};

type NativeAppPlugin = {
  addListener?: (
    eventName: 'appUrlOpen',
    listenerFunc: (event: AppUrlOpenEvent) => void | Promise<void>
  ) => Promise<NativeListenerHandle> | NativeListenerHandle;
};

type NativeBrowserPlugin = {
  open?: (options: { url: string }) => Promise<void>;
  close?: () => Promise<void>;
};

type CapacitorGlobal = {
  Plugins?: {
    App?: NativeAppPlugin;
    Browser?: NativeBrowserPlugin;
  };
  registerPlugin?: <T>(pluginName: string) => T;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function getAuthToastMessage(error: unknown): string {
  const message = toErrorMessage(error).toLowerCase();

  if (message.includes('redirect') || message.includes('redirect_to') || message.includes('not allowed')) {
    return 'Redirect Google non autorisé. Ajoute com.naraevoyage.app://auth/callback dans Supabase Auth > Redirect URLs.';
  }

  if (message.includes('cancel')) {
    return 'Connexion annulée.';
  }

  return 'Connexion Google impossible, réessayez.';
}

export function GoogleSignIn({ redirectTo, className }: GoogleSignInProps) {
  const [isLoading, setIsLoading] = useState(false);

  const resolveNativePlugins = () => {
    const capacitor = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
    const appFromPlugins = capacitor?.Plugins?.App;
    const browserFromPlugins = capacitor?.Plugins?.Browser;

    if (!capacitor?.registerPlugin) {
      return {
        App: appFromPlugins,
        Browser: browserFromPlugins,
      };
    }

    let appFromRegister: NativeAppPlugin | undefined;
    let browserFromRegister: NativeBrowserPlugin | undefined;

    try {
      appFromRegister = capacitor.registerPlugin<NativeAppPlugin>('App');
      browserFromRegister = capacitor.registerPlugin<NativeBrowserPlugin>('Browser');
    } catch {
      // ignore plugin registration errors and fallback to Plugins map
    }

    return {
      App: appFromPlugins || appFromRegister,
      Browser: browserFromPlugins || browserFromRegister,
    };
  };

  const handleSignIn = async () => {
    setIsLoading(true);
    const supabase = getSupabaseClient();
    let postLoginPath = '/mes-voyages';
    if (redirectTo?.startsWith('/')) {
      postLoginPath = redirectTo;
    } else if (redirectTo) {
      try {
        const parsed = new URL(redirectTo);
        const parsedRedirect = parsed.searchParams.get('redirect');
        if (parsedRedirect?.startsWith('/')) {
          postLoginPath = parsedRedirect;
        }
      } catch {
        // ignore invalid redirect values
      }
    }
    const nativeRedirectUrl = 'com.naraevoyage.app://auth/callback';
    const nativeOAuthRedirect = nativeRedirectUrl;
    const webCallback = `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(postLoginPath)}`;

    try {
      if (isNativeApp()) {
        const { App, Browser } = resolveNativePlugins();

        // Capacitor bridge indisponible: fallback OAuth web dans la WebView native.
        if (!App?.addListener) {
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: webCallback,
              queryParams: {
                prompt: 'select_account',
              },
            },
          });

          if (error) throw error;
          return;
        }

        let listenerHandle: NativeListenerHandle | null = null;
        let timeoutId: number | null = null;

        const cleanup = async () => {
          if (timeoutId) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (listenerHandle) {
            await Promise.resolve(listenerHandle.remove());
            listenerHandle = null;
          }
        };

        listenerHandle = await Promise.resolve(
          App.addListener('appUrlOpen', async ({ url }) => {
            if (!url?.startsWith(nativeRedirectUrl)) return;

            try {
              const parsedUrl = new URL(url);
              const callbackError = parsedUrl.searchParams.get('error');
              if (callbackError) {
                throw new Error(callbackError);
              }

              const code = parsedUrl.searchParams.get('code');
              const queryAccessToken = parsedUrl.searchParams.get('access_token');
              const queryRefreshToken = parsedUrl.searchParams.get('refresh_token');
              const callbackRedirect = parsedUrl.searchParams.get('redirect');
              const hashParams = new URLSearchParams(parsedUrl.hash.replace('#', ''));
              const hashAccessToken = hashParams.get('access_token');
              const hashRefreshToken = hashParams.get('refresh_token');

              if (code) {
                const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                if (exchangeError) {
                  throw exchangeError;
                }
              } else {
                const accessToken = hashAccessToken || queryAccessToken;
                const refreshToken = hashRefreshToken || queryRefreshToken;

                if (!accessToken || !refreshToken) {
                  throw new Error('Jetons OAuth manquants');
                }

                const { error: setSessionError } = await supabase.auth.setSession({
                  access_token: accessToken,
                  refresh_token: refreshToken,
                });

                if (setSessionError) {
                  throw setSessionError;
                }
              }

              if (Browser?.close) {
                await Browser.close();
              }

              window.location.replace(
                callbackRedirect?.startsWith('/') ? callbackRedirect : postLoginPath
              );
            } catch (callbackError) {
              console.error('[Auth] Native OAuth callback error:', callbackError);
              toast.error(getAuthToastMessage(callbackError));
            } finally {
              await cleanup();
              setIsLoading(false);
            }
          })
        );

        timeoutId = window.setTimeout(async () => {
          await cleanup();
          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();

            if (session) {
              window.location.replace(postLoginPath);
              return;
            }
          } catch {
            // ignore fallback session check failure
          }

          setIsLoading(false);
          toast.error('La connexion a expiré. Réessayez.');
        }, 90000);

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: nativeOAuthRedirect,
            skipBrowserRedirect: true,
            queryParams: {
              prompt: 'select_account',
            },
          },
        });

        if (error || !data?.url) {
          await cleanup();
          throw error || new Error('URL OAuth manquante');
        }

        if (Browser?.open) {
          await Browser.open({ url: data.url });
        } else {
          window.location.assign(data.url);
        }

        return;
      }

      const webRedirect = redirectTo?.startsWith('http')
        ? redirectTo
        : webCallback;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: webRedirect,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error signing in:', error);
      toast.error(getAuthToastMessage(error));
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleSignIn}
      disabled={isLoading}
      variant="outline"
      className={`gap-2 ${className || ''}`}
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <GoogleIcon className="h-5 w-5" />
      )}
      Continuer avec Google
    </Button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
