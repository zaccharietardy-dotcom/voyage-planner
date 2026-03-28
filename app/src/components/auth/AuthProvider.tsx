'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { getSupabaseClient, Profile } from '@/lib/supabase';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  isLoading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [supabase] = useState(() => getSupabaseClient());

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (data) {
      setProfile(data);
    }
    return data;
  }, [supabase]);

  const createProfile = useCallback(async (authUser: User) => {
    const newProfile = {
      id: authUser.id,
      email: authUser.email || '',
      display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Voyageur',
      avatar_url: authUser.user_metadata?.avatar_url || null,
    };

    const { data, error } = await supabase
      .from('profiles')
      .insert(newProfile)
      .select()
      .single();

    if (!error && data) {
      setProfile(data);
    }
    return data;
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [fetchProfile, user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  }, [supabase]);

  useEffect(() => {
    // Timeout fallback - give enough time for session restore
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 8000);

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout);
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);

      // Fetch/create profile in background (don't block render)
      if (session?.user) {
        fetchProfile(session.user.id).then(existingProfile => {
          if (!existingProfile) {
            createProfile(session.user!);
          }
        });
      }
    }).catch(() => {
      clearTimeout(timeout);
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (event === 'SIGNED_IN' && session?.user) {
        void (async () => {
          try {
            const existingProfile = await fetchProfile(session.user.id);
            if (!existingProfile) {
              await createProfile(session.user);
            }

            // Apply referral code if stored from registration
            const refCode = localStorage.getItem('narae-referral-code');
            if (refCode) {
              localStorage.removeItem('narae-referral-code');
              fetch('/api/referral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: refCode }),
              }).catch(() => {});
            }
          } catch (profileError) {
            console.error('Erreur chargement profil:', profileError);
          }
        })();
      }

      if (event === 'SIGNED_OUT') {
        setProfile(null);
      }

      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [createProfile, fetchProfile, supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        isLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
