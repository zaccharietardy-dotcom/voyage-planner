'use client';

import { LogOut, Loader2, ArrowLeft, MapPin, Settings, Users, UserPlus, Crown, CreditCard, Zap, Check, Trophy, ShieldCheck, Mail, Calendar, Settings2, Globe, Heart } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfileCard } from '@/components/social/UserProfileCard';
import { GamificationSection } from '@/components/gamification/GamificationSection';
import { ReferralCard } from '@/components/ReferralCard';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { getPlatform, isNativeApp } from '@/lib/mobile/runtime';
import { purchaseProPlan, restoreMobilePurchases } from '@/lib/mobile/purchases';
import { toast } from 'sonner';

interface ProfileData {
  followers_count: number;
  following_count: number;
  trips_count: number;
  username: string | null;
  bio: string | null;
}

interface TripItem {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  duration_days: number;
}

export default function ProfilPage() {
  const { user, profile, isLoading, signOut } = useAuth();
  const router = useRouter();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('trips');
  const [dataLoading, setDataLoading] = useState(true);
  const { isPro, expiresAt } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'yearly' | 'monthly'>('yearly');
  const nativeApp = isNativeApp();
  const platform = getPlatform();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async (retries = 0) => {
      setDataLoading(true);
      try {
        const responses = await Promise.all([
          fetch(`/api/users/${user.id}`),
          fetch('/api/trips'),
          fetch('/api/follows?type=followers'),
          fetch('/api/follows?type=following'),
        ]);

        const has401 = responses.some(r => r.status === 401);
        if (has401 && retries < 3) {
          setTimeout(() => fetchData(retries + 1), (retries + 1) * 800);
          return;
        }

        const [profileRes, tripsRes, followersRes, followingRes] = await Promise.all(
          responses.map(r => r.ok ? r.json() : null)
        );

        if (profileRes) setProfileData(profileRes);
        setTrips(tripsRes || []);
        setFollowers(followersRes || []);
        setFollowing(followingRes || []);
      } catch (e) {
        if (retries < 3) {
          setTimeout(() => fetchData(retries + 1), (retries + 1) * 800);
          return;
        }
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-gold mb-4" />
        <p className="text-gold font-display text-lg tracking-widest">Préparation de votre espace...</p>
      </div>
    );
  }

  if (!user) return null;

  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null;
  const email = profile?.email || user.email || '';
  const username = profileData?.username || displayName.toLowerCase().replace(/\s+/g, '_');

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const handleCheckout = async (plan: 'monthly' | 'yearly') => {
    setCheckoutLoading('pro');
    try {
      if (nativeApp) {
        const result = await purchaseProPlan(plan, user.id);
        if (!result.success) { toast.error(result.message || 'Échec de l\'achat'); return; }
        window.location.reload();
        return;
      }
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } finally { setCheckoutLoading(null); }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Visual Cover */}
      <div className="relative h-64 bg-[#020617] overflow-hidden">
        <img 
          src="https://images.unsplash.com/photo-1436491865332-7a61a109c0f2?q=80&w=2070&auto=format&fit=crop" 
          alt="Travel Cover" 
          className="w-full h-full object-cover opacity-40 grayscale-[0.5]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-20">
          <Link href="/" className="h-10 w-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-gold/20 transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Link href="/preferences" className="h-10 w-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-gold/20 transition-all">
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Profile Card Overlay */}
      <div className="max-w-2xl mx-auto px-4 -mt-32 relative z-30">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="premium-card bg-[#020617]/80 backdrop-blur-2xl rounded-[2.5rem] border border-gold/20 shadow-2xl p-8"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <Avatar className="w-24 h-24 md:w-32 md:h-32 border-4 border-[#020617] shadow-2xl ring-2 ring-gold/30">
                <AvatarImage src={avatarUrl || undefined} className="object-cover" />
                <AvatarFallback className="text-3xl md:text-4xl font-display font-bold bg-gold text-[#020617]">
                  {displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {isPro && (
                <div className="absolute -bottom-2 -right-2 bg-gold-gradient p-2 rounded-xl shadow-xl border border-[#020617]">
                  <Crown className="h-5 w-5 text-[#020617]" />
                </div>
              )}
            </div>

            <div className="mt-6 w-full overflow-hidden px-2">
              <h1 className="font-display text-2xl md:text-3xl font-bold text-white flex items-center justify-center gap-3 truncate">
                {displayName}
                {isPro && <ShieldCheck className="h-5 w-5 text-gold shrink-0" />}
              </h1>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 mt-2">
                <p className="text-gold font-bold text-[10px] sm:text-xs uppercase tracking-[0.2em] truncate max-w-full">@{username}</p>
                <div className="hidden sm:block h-1 w-1 rounded-full bg-slate-600" />
                <p className="text-slate-400 text-[10px] sm:text-xs font-bold uppercase tracking-widest flex items-center gap-1 truncate max-w-full px-2">
                  <Mail className="h-3 w-3 shrink-0" />
                  {email}
                </p>
              </div>
              {profileData?.bio && (
                <p className="text-slate-400 text-sm mt-4 max-w-sm italic leading-relaxed">
                  "{profileData.bio}"
                </p>
              )}
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-8 w-full mt-10 pt-8 border-t border-white/5">
              <button onClick={() => setActiveTab('trips')} className="group">
                <p className="font-display text-2xl font-bold text-white group-hover:text-gold transition-colors">
                  {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : trips.length}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Voyages</p>
              </button>
              <button onClick={() => setActiveTab('followers')} className="group">
                <p className="font-display text-2xl font-bold text-white group-hover:text-gold transition-colors">
                  {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : followers.length}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Abonnés</p>
              </button>
              <button onClick={() => setActiveTab('following')} className="group">
                <p className="font-display text-2xl font-bold text-white group-hover:text-gold transition-colors">
                  {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : following.length}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">Suivis</p>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Tabs System */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-12">
          <TabsList className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl p-1 backdrop-blur-xl">
            <TabsTrigger value="trips" className="flex-1 rounded-xl text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-gold data-[state=active]:text-[#020617]">
              Voyages
            </TabsTrigger>
            <TabsTrigger value="gamification" className="flex-1 rounded-xl text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-gold data-[state=active]:text-[#020617] gap-2">
              <Trophy className="h-3.5 w-3.5" /> Stats
            </TabsTrigger>
            <TabsTrigger value="followers" className="flex-1 rounded-xl text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-gold data-[state=active]:text-[#020617]">
              Abonnés
            </TabsTrigger>
            <TabsTrigger value="pro" className="flex-1 rounded-xl text-[10px] font-bold uppercase tracking-widest data-[state=active]:bg-gold data-[state=active]:text-[#020617] gap-2">
              <Crown className="h-3.5 w-3.5" /> Club
            </TabsTrigger>
          </TabsList>

          <AnimatePresence mode="wait">
            <TabsContent value="trips" className="mt-8 outline-none">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                {trips.length === 0 ? (
                  <div className="text-center py-20 bg-white/5 rounded-[2rem] border border-dashed border-white/10">
                    <MapPin className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Aucun voyage pour le moment</p>
                    <Link href="/plan">
                      <Button variant="link" className="text-gold font-bold mt-2">Planifier mon premier départ</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {trips.map((trip) => (
                      <button
                        key={trip.id}
                        onClick={() => router.push(`/trip/${trip.id}`)}
                        className="w-full text-left group"
                      >
                        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 hover:border-gold/30 hover:bg-white/10 transition-all flex items-center justify-between">
                          <div className="flex items-center gap-5">
                            <div className="h-14 w-14 rounded-xl bg-gold/10 flex items-center justify-center shrink-0 border border-gold/20 text-gold group-hover:bg-gold group-hover:text-[#020617] transition-all">
                              <Globe className="h-6 w-6" />
                            </div>
                            <div>
                              <h4 className="font-display font-bold text-white text-lg group-hover:text-gold transition-colors">{trip.title}</h4>
                              <div className="flex items-center gap-3 mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-gold" /> {trip.destination}</span>
                                <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3 text-gold" /> {format(new Date(trip.start_date), 'd MMM yyyy', { locale: fr })}</span>
                              </div>
                            </div>
                          </div>
                          <ArrowLeft className="h-5 w-5 text-slate-700 group-hover:text-gold group-hover:translate-x-1 transition-all rotate-180" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            </TabsContent>

            <TabsContent value="gamification" className="mt-8 outline-none">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <ReferralCard />
                {user && <GamificationSection userId={user.id} isOwnProfile={true} />}
              </motion.div>
            </TabsContent>

            <TabsContent value="pro" className="mt-8 outline-none space-y-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                {/* Status Card */}
                <div className={cn(
                  "p-8 rounded-[2.5rem] border flex flex-col items-center text-center relative overflow-hidden",
                  isPro ? "bg-gold-gradient border-white/20" : "bg-white/5 border-white/10"
                )}>
                  <div className={cn(
                    "w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-2xl",
                    isPro ? "bg-[#020617] text-gold" : "bg-slate-800 text-slate-500"
                  )}>
                    {isPro ? <Crown className="h-10 w-10" /> : <CreditCard className="h-10 w-10" />}
                  </div>
                  <h3 className={cn("text-2xl font-display font-bold mb-2", isPro ? "text-[#020617]" : "text-white")}>
                    {isPro ? "Membre Privilège Narae" : "Accès Standard"}
                  </h3>
                  <p className={cn("text-sm max-w-xs mb-8 font-medium", isPro ? "text-[#020617]/70" : "text-slate-400")}>
                    {isPro 
                      ? (expiresAt ? `Abonnement actif jusqu'au ${format(new Date(expiresAt), 'd MMMM yyyy', { locale: fr })}` : "Accès illimité à vie")
                      : "Découvrez l'intégralité des fonctionnalités de Narae Voyage en rejoignant le Club Pro."}
                  </p>

                  {!isPro && (
                    <div className="grid gap-4 w-full">
                      <div className="grid grid-cols-2 gap-3 bg-muted/50 p-1 rounded-xl mb-4">
                        <button onClick={() => setBillingPeriod('yearly')} className={cn("py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all", billingPeriod === 'yearly' ? "bg-gold text-[#020617] shadow-lg" : "text-slate-500")}>Annuel</button>
                        <button onClick={() => setBillingPeriod('monthly')} className={cn("py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all", billingPeriod === 'monthly' ? "bg-gold text-[#020617] shadow-lg" : "text-slate-500")}>Mensuel</button>
                      </div>
                      <Button 
                        onClick={() => handleCheckout(billingPeriod)} 
                        className="h-16 rounded-2xl bg-gold-gradient text-[#020617] font-bold text-lg shadow-xl shadow-gold/20"
                        disabled={!!checkoutLoading}
                      >
                        {checkoutLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : `Devenir Pro — ${billingPeriod === 'yearly' ? '9.99€/an' : '1.99€/mois'}`}
                      </Button>
                    </div>
                  )}
                </div>

                {!isPro && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { icon: Globe, label: "Voyages illimités", desc: "Planifiez sans aucune limite." },
                      { icon: Zap, label: "Régénération Experte", desc: "Optimisation infinie de vos trajets." },
                      { icon: Download, label: "Export PDF Deluxe", desc: "Vos carnets de route imprimables." },
                      { icon: Crown, label: "Badge Exclusif", desc: "Affirmez votre statut d'explorateur." }
                    ].map((feat, i) => (
                      <div key={i} className="p-5 bg-white/5 border border-white/5 rounded-2xl flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl bg-gold/10 flex items-center justify-center shrink-0 text-gold">
                          <feat.icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white mb-1">{feat.label}</p>
                          <p className="text-[10px] font-medium text-slate-500 leading-relaxed uppercase tracking-wider">{feat.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </Tabs>

        {/* Action Menu */}
        <div className="mt-12 space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600 mb-6 ml-2 text-center">Menu Privé</h3>
          
          <div className="grid grid-cols-1 gap-4">
            <Link href="/mes-voyages" className="group">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-6 hover:bg-white/10 hover:border-gold/30 transition-all flex items-center gap-6">
                <div className="h-12 w-12 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-gold group-hover:bg-gold/10 transition-all">
                  <MapPin className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white mb-1">Gérer mes voyages</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Modifier, supprimer ou archiver</p>
                </div>
                <ArrowLeft className="h-5 w-5 text-slate-700 rotate-180 group-hover:text-gold group-hover:translate-x-1 transition-all" />
              </div>
            </Link>

            <Link href="/preferences" className="group">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-6 hover:bg-white/10 hover:border-gold/30 transition-all flex items-center gap-6">
                <div className="h-12 w-12 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-gold group-hover:bg-gold/10 transition-all">
                  <Settings2 className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white mb-1">Préférences Expert</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Style, budget & régime alimentaire</p>
                </div>
                <ArrowLeft className="h-5 w-5 text-slate-700 rotate-180 group-hover:text-gold group-hover:translate-x-1 transition-all" />
              </div>
            </Link>
          </div>

          <Button 
            variant="outline" 
            onClick={handleSignOut}
            className="w-full h-16 rounded-2xl mt-8 border-red-500/20 bg-red-500/5 text-red-400 font-bold text-[10px] uppercase tracking-[0.2em] hover:bg-red-500 hover:text-white transition-all"
          >
            <LogOut className="h-4 w-4 mr-2" /> Quitter l'application
          </Button>
        </div>
      </div>
    </div>
  );
}

// Placeholder for missing Download icon in imports if needed (it was used in my feature list)
const Download = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
);
