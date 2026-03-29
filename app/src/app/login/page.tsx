'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { GoogleSignIn, AppleSignIn } from '@/components/auth';
import { useAuth } from '@/components/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { cn } from '@/lib/utils';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const redirectTo = searchParams.get('redirect') || '/mes-voyages';
  const errorParam = searchParams.get('error');

  useEffect(() => {
    if (user && !authLoading) {
      router.push(redirectTo);
    }
  }, [user, authLoading, router, redirectTo]);

  useEffect(() => {
    if (errorParam === 'auth_error') {
      setError('Une erreur est survenue lors de la connexion. Veuillez réessayer.');
    }
  }, [errorParam]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Server-side rate limit check before attempting login
      const rlRes = await fetch('/api/auth/login', { method: 'POST' });
      if (rlRes.status === 429) {
        const rlData = await rlRes.json();
        setError(rlData.error || 'Trop de tentatives. Réessayez plus tard.');
        return;
      }

      const supabase = getSupabaseClient();

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          setError('Email ou mot de passe incorrect');
        } else if (signInError.message.includes('Email not confirmed')) {
          setError('Veuillez confirmer votre email avant de vous connecter');
        } else {
          setError(signInError.message);
        }
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#020617] pt-[env(safe-area-inset-top)]">
      {/* Left Side: Visual Inspiration */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?q=80&w=2070&auto=format&fit=crop" 
          alt="Travel Inspiration" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#020617] via-[#020617]/40 to-transparent" />
        
        <div className="relative z-10 flex flex-col justify-end p-20 w-full">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-20 h-1 bg-gold mb-8 rounded-full shadow-[0_0_15px_rgba(197,160,89,0.5)]" />
            <h2 className="font-display text-6xl font-bold text-white leading-tight mb-6">
              Votre prochaine <br />
              <span className="text-gold-gradient italic">odyssée</span> commence ici.
            </h2>
            <p className="text-xl text-white/70 max-w-md leading-relaxed">
              Reconnectez-vous à vos envies d'évasion et planifiez des moments qui resteront gravés.
            </p>
          </motion.div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-10 left-10">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="h-12 w-12 rounded-xl bg-gold-gradient p-[1px] shadow-2xl group-hover:scale-110 transition-transform">
              <div className="h-full w-full rounded-[11px] bg-[#020617] flex items-center justify-center">
                <img src="/logo-narae.png" alt="Narae" className="w-6 h-6 object-contain" />
              </div>
            </div>
            <span className="font-display text-2xl font-bold text-white tracking-tight">Narae <span className="text-gold italic">Voyage</span></span>
          </Link>
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-16 relative z-10">
        {/* Background glow for mobile (optimized for performance, no heavy blur) */}
        <div className="lg:hidden absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gold/10 via-[#020617] to-[#020617]" />

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md bg-[#020617]/80 lg:bg-transparent backdrop-blur-md lg:backdrop-blur-none p-8 lg:p-0 rounded-[2rem] border border-white/5 lg:border-none shadow-2xl lg:shadow-none"
        >
          <div className="mb-10 text-center lg:text-left">
            <div className="lg:hidden flex justify-center mb-6">
              <Link href="/">
                <div className="h-16 w-16 rounded-2xl bg-gold-gradient p-[1px] shadow-2xl">
                  <div className="h-full w-full rounded-[15px] bg-[#020617] flex items-center justify-center">
                    <img src="/logo-narae.png" alt="Narae" className="w-8 h-8 object-contain" />
                  </div>
                </div>
              </Link>
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-2">Bon retour parmi nous</h1>
            <p className="text-slate-400 text-sm md:text-base">Accédez à vos carnets de route et vos projets d'évasion.</p>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <AppleSignIn
                redirectTo={redirectTo}
                className="w-full h-14 rounded-2xl border-white/10 bg-white text-black hover:bg-white/90 font-bold transition-all shadow-md"
              />
              <GoogleSignIn
                redirectTo={redirectTo}
                className="w-full h-14 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold transition-all shadow-sm"
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-bold">
                <span className="bg-[#020617] px-4 text-slate-500">Ou continuer avec email</span>
              </div>
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[11px] font-bold uppercase tracking-widest text-slate-400 ml-1">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="votre@email.com"
                  className="h-14 rounded-2xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600 px-5 shadow-inner"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between ml-1">
                  <Label htmlFor="password" className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Mot de passe</Label>
                  <Link
                    href="/forgot-password"
                    className="text-[10px] font-bold uppercase tracking-widest text-gold hover:text-gold-light transition-colors"
                  >
                    Oublié ?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-14 rounded-2xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600 px-5 shadow-inner"
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-3"
                >
                  <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                  <span className="font-medium">{error}</span>
                </motion.div>
              )}

              <Button 
                type="submit" 
                className="w-full h-14 rounded-2xl bg-gold-gradient text-[#020617] text-base font-bold shadow-lg shadow-gold/20 hover:scale-[1.02] active:scale-[0.98] transition-all mt-2" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Authentification...
                  </>
                ) : (
                  'Se connecter'
                )}
              </Button>
            </form>

            <div className="pt-4 text-center">
              <p className="text-slate-400 text-sm font-medium">
                Pas encore de compte ?{' '}
                <Link href="/register" className="text-gold hover:text-gold-light font-bold underline decoration-gold/30 underline-offset-4 transition-all">
                  Créer un compte
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
