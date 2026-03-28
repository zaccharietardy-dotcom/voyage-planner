'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, Check, X, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { GoogleSignIn } from '@/components/auth/GoogleSignIn';
import { AppleSignIn } from '@/components/auth/AppleSignIn';
import { getSupabaseClient } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface PasswordStrength {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

function checkPasswordStrength(password: string): PasswordStrength {
  return {
    hasMinLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };
}

function PasswordRequirement({ met, text }: { met: boolean; text: string }) {
  return (
    <div className={cn(
      "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
      met ? "text-green-400" : "text-slate-500"
    )}>
      <div className={cn(
        "w-3 h-3 rounded-full flex items-center justify-center border",
        met ? "bg-green-500/20 border-green-500/50" : "bg-slate-800 border-slate-700"
      )}>
        {met && <Check className="h-2 w-2 text-green-400" />}
      </div>
      {text}
    </div>
  );
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });

  // Store referral code from URL for post-signup application
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) localStorage.setItem('narae-referral-code', ref.toUpperCase().trim());
  }, [searchParams]);

  const passwordStrength = checkPasswordStrength(formData.password);
  const isPasswordValid = Object.values(passwordStrength).every(Boolean);
  const passwordsMatch = formData.password === formData.confirmPassword && formData.confirmPassword !== '';

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.firstName || !formData.lastName) {
      setError('Veuillez renseigner votre nom et prénom');
      return;
    }

    if (!isPasswordValid) {
      setError('Le mot de passe ne respecte pas les critères de sécurité');
      return;
    }

    if (!passwordsMatch) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    if (!formData.acceptTerms) {
      setError('Vous devez accepter les conditions générales d\'utilisation');
      return;
    }

    setIsLoading(true);

    try {
      const supabase = getSupabaseClient();

      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: `${formData.firstName} ${formData.lastName}`,
            first_name: formData.firstName,
            last_name: formData.lastName,
          },
          emailRedirectTo: undefined,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError('Un compte existe déjà avec cet email');
        } else {
          setError(signUpError.message);
        }
        return;
      }

      await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          firstName: formData.firstName,
        }),
      });

      setSuccess(true);
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-[#020617]">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white/5 border border-gold/20 backdrop-blur-xl rounded-[2.5rem] p-10 text-center shadow-2xl"
        >
          <div className="mx-auto w-20 h-20 rounded-3xl bg-gold/10 flex items-center justify-center mb-8 border border-gold/20 shadow-lg shadow-gold/10">
            <Check className="h-10 w-10 text-gold" />
          </div>
          <h2 className="font-display text-3xl font-bold text-white mb-4">Vérifiez vos emails</h2>
          <p className="text-slate-400 mb-8 leading-relaxed">
            Un lien de confirmation a été envoyé à <br />
            <span className="text-gold font-bold">{formData.email}</span>. <br />
            L'aventure commence dans quelques instants.
          </p>
          <Button variant="outline" className="h-14 rounded-2xl border-white/10 hover:bg-white/5 transition-all text-white px-8" asChild>
            <Link href="/login">Retour à la connexion</Link>
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#020617]">
      {/* Right Side: Register Form (Swapped for variety) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 md:p-16 relative overflow-y-auto">
        <div className="lg:hidden absolute inset-0 -z-10">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gold/10 blur-[100px] rounded-full" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full" />
        </div>

        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md py-12"
        >
          <div className="mb-10 text-center lg:text-left">
            <div className="lg:hidden flex justify-center mb-8">
              <Link href="/">
                <div className="h-16 w-16 rounded-2xl bg-gold-gradient p-[1px] shadow-2xl">
                  <div className="h-full w-full rounded-[15px] bg-[#020617] flex items-center justify-center">
                    <img src="/logo-narae.png" alt="Narae" className="w-8 h-8 object-contain" />
                  </div>
                </div>
              </Link>
            </div>
            <h1 className="font-display text-4xl font-bold text-white mb-3">Rejoindre Narae</h1>
            <p className="text-slate-400 text-sm">Créez votre accès privilégié au monde du voyage sur-mesure.</p>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <AppleSignIn className="w-full h-14 rounded-2xl border-white/10 bg-white text-black hover:bg-white/90 font-bold transition-all" />
              <GoogleSignIn className="w-full h-14 rounded-2xl border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold transition-all" />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-bold">
                <span className="bg-[#020617] px-4 text-slate-500">Ou s'inscrire avec email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Prénom</Label>
                  <Input
                    id="firstName"
                    placeholder="Jean"
                    className="h-12 rounded-xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600"
                    value={formData.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Nom</Label>
                  <Input
                    id="lastName"
                    placeholder="Dupont"
                    className="h-12 rounded-xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600"
                    value={formData.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="votre@email.com"
                  className="h-12 rounded-xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="h-12 rounded-xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600"
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {formData.password && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 p-3 rounded-xl bg-white/5 border border-white/5">
                    <PasswordRequirement met={passwordStrength.hasMinLength} text="8 caract." />
                    <PasswordRequirement met={passwordStrength.hasUppercase} text="Majuscule" />
                    <PasswordRequirement met={passwordStrength.hasNumber} text="Chiffre" />
                    <PasswordRequirement met={passwordStrength.hasSpecial} text="Spécial" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Confirmer</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="h-12 rounded-xl bg-white/5 border-white/10 focus:border-gold/50 focus:ring-gold/20 transition-all text-white placeholder:text-slate-600"
                    value={formData.confirmPassword}
                    onChange={(e) => handleChange('confirmPassword', e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-start space-x-3 pt-2">
                <Checkbox
                  id="terms"
                  checked={formData.acceptTerms}
                  className="mt-1 border-white/20 data-[state=checked]:bg-gold data-[state=checked]:border-gold"
                  onCheckedChange={(checked) => handleChange('acceptTerms', checked as boolean)}
                />
                <label htmlFor="terms" className="text-[11px] text-slate-400 leading-relaxed">
                  J'accepte les{' '}
                  <Link href="/cgu" className="text-gold hover:underline">conditions</Link>{' '}
                  et la{' '}
                  <Link href="/privacy" className="text-gold hover:underline">politique de confidentialité</Link>.
                </label>
              </div>

              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full h-14 rounded-xl bg-gold-gradient text-[#020617] text-base font-bold shadow-xl shadow-gold/20 hover:scale-[1.02] active:scale-[0.98] transition-all mt-4" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Création...
                  </>
                ) : (
                  'Créer mon compte'
                )}
              </Button>
            </form>

            <div className="text-center">
              <p className="text-slate-400 text-sm font-medium">
                Déjà membre ?{' '}
                <Link href="/login" className="text-gold hover:text-gold-light font-bold underline decoration-gold/30 underline-offset-4 transition-all">
                  Se connecter
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Left Side: Visual Inspiration (Swapped) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=2070&auto=format&fit=crop" 
          alt="Adventure Awaits" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tl from-[#020617] via-[#020617]/40 to-transparent" />
        
        <div className="relative z-10 flex flex-col justify-end p-20 w-full text-right">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-20 h-1 bg-gold mb-8 rounded-full shadow-[0_0_15px_rgba(197,160,89,0.5)] ml-auto" />
            <h2 className="font-display text-6xl font-bold text-white leading-tight mb-6">
              L'exceptionnel <br />
              est à votre <span className="text-gold-gradient italic">portée</span>.
            </h2>
            <p className="text-xl text-white/70 max-w-md leading-relaxed ml-auto">
              Rejoignez une communauté de voyageurs exigeants et créez des souvenirs inoubliables.
            </p>
          </motion.div>
        </div>

        <div className="absolute top-10 right-10">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="font-display text-2xl font-bold text-white tracking-tight">Narae <span className="text-gold italic">Voyage</span></span>
            <div className="h-12 w-12 rounded-xl bg-gold-gradient p-[1px] shadow-2xl group-hover:scale-110 transition-transform">
              <div className="h-full w-full rounded-[11px] bg-[#020617] flex items-center justify-center">
                <img src="/logo-narae.png" alt="Narae" className="w-6 h-6 object-contain" />
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    }>
      <RegisterContent />
    </Suspense>
  );
}
