import { useState } from 'react';
import { View, Text, ScrollView, FlatList, Pressable, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Settings, CreditCard, LogOut, ChevronRight, Crown, Plane, Trophy,
  Users, Download, Trash2, MapPin, Zap, FileDown, Award,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { fetchMyTrips, type TripListItem } from '@/lib/api/trips';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TripCard } from '@/components/trip/TripCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { colors, fonts, radius } from '@/lib/theme';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

type ProfileTab = 'voyages' | 'stats' | 'club';

export default function ProfileScreen() {
  const { user, profile, isLoading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>('voyages');

  const { data: trips, isLoading: tripsLoading } = useApi(
    () => (user ? fetchMyTrips() : Promise.resolve([])),
    [user?.id ?? null],
  );

  // Not logged in
  if (!authLoading && !user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 20,
              backgroundColor: colors.goldBg,
              alignItems: 'center', justifyContent: 'center', marginBottom: 20,
            }}>
              <Plane size={32} color={colors.gold} />
            </View>
            <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display, marginBottom: 8, textAlign: 'center', fontWeight: 'bold' }}>
              Connectez-vous
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 28 }}>
              Accédez à votre profil et vos voyages
            </Text>
            <Button onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/login'); }}>Se connecter</Button>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ padding: 20, gap: 16, alignItems: 'center', paddingTop: 60 }}>
            <Skeleton width={72} height={72} radius={36} />
            <Skeleton width={140} height={20} />
            <Skeleton width={200} height={14} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur';
  const isPro = profile?.subscription_status === 'pro';
  const tripCount = trips?.length ?? 0;

  const handleSignOut = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert('Se déconnecter', 'Êtes-vous sûr ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Cover + Avatar */}
          <View style={{ height: 120, backgroundColor: 'rgba(255,255,255,0.02)' }}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(197,160,89,0.08)' }} />
          </View>

          <View style={{ alignItems: 'center', marginTop: -40, paddingHorizontal: 20 }}>
            <View style={{ borderWidth: 3, borderColor: colors.gold, borderRadius: 44, padding: 2, backgroundColor: colors.bg }}>
              <Avatar url={profile?.avatar_url} name={displayName} size="lg" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Text style={{ color: colors.text, fontSize: 26, fontFamily: fonts.display, fontWeight: 'bold' }}>
                {displayName}
              </Text>
              {isPro && (
                <View style={{ backgroundColor: colors.goldBg, padding: 4, borderRadius: 8 }}>
                  <Crown size={16} color={colors.gold} />
                </View>
              )}
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>{user?.email}</Text>

            {/* Stats bar */}
            <View style={{ flexDirection: 'row', gap: 32, marginTop: 24, backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 32, paddingVertical: 16, borderRadius: radius['2xl'], borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
              <StatItem value={tripCount} label="Voyages" />
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <StatItem value={isPro ? 'Pro' : 'Free'} label="Abonnement" gold={isPro} />
            </View>
          </View>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 4, marginTop: 28, marginBottom: 16 }}>
            {([
              { key: 'voyages' as const, label: 'Voyages', icon: MapPin },
              { key: 'stats' as const, label: 'Stats', icon: Trophy },
              { key: 'club' as const, label: 'Club', icon: Crown },
            ]).map((tab) => (
              <Pressable
                key={tab.key}
                onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  paddingVertical: 12, borderRadius: radius.lg,
                  backgroundColor: activeTab === tab.key ? colors.goldBg : 'transparent',
                  borderWidth: 1, borderColor: activeTab === tab.key ? 'rgba(197,160,89,0.2)' : 'transparent',
                }}
              >
                <tab.icon size={16} color={activeTab === tab.key ? colors.gold : colors.textMuted} />
                <Text style={{
                  color: activeTab === tab.key ? colors.gold : colors.textMuted,
                  fontSize: 13, fontWeight: '700',
                }}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Tab content */}
          {activeTab === 'voyages' && (
            <View style={{ paddingHorizontal: 20 }}>
              {tripsLoading ? (
                <View style={{ gap: 12 }}>
                  <Skeleton height={200} radius={radius['3xl']} />
                  <Skeleton height={200} radius={radius['3xl']} />
                </View>
              ) : (trips ?? []).length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <MapPin size={40} color={colors.textMuted} />
                  <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 12 }}>Aucun voyage</Text>
                </View>
              ) : (
                (trips ?? []).map((trip) => (
                  <TripCard key={trip.id} trip={trip} onPress={() => { Haptics.selectionAsync(); router.push(`/trip/${trip.id}`); }} />
                ))
              )}
            </View>
          )}

          {activeTab === 'stats' && (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {/* Referral */}
              {profile?.referral_code && (
                <Card variant="premium" style={{ gap: 8 }}>
                  <Text style={{ color: colors.gold, fontSize: 16, fontFamily: fonts.display, fontWeight: 'bold' }}>Parrainage</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Partagez votre code pour gagner des voyages gratuits</Text>
                  <View style={{
                    backgroundColor: 'rgba(2,6,23,0.3)', borderRadius: radius.md,
                    padding: 14, alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: 'rgba(197,160,89,0.2)'
                  }}>
                    <Text style={{ color: colors.gold, fontSize: 22, fontWeight: '800', letterSpacing: 6 }}>
                      {profile.referral_code}
                    </Text>
                  </View>
                </Card>
              )}
              {/* Stats cards */}
              <Card style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 24, backgroundColor: 'rgba(255,255,255,0.03)' }}>
                <StatItem value={tripCount} label="Voyages créés" />
                <StatItem value={(trips ?? []).filter((t) => new Date(t.end_date) < new Date()).length} label="Terminés" />
                <StatItem value={(trips ?? []).filter((t) => new Date(t.start_date) > new Date()).length} label="À venir" />
              </Card>
            </View>
          )}

          {activeTab === 'club' && (
            <View style={{ paddingHorizontal: 20, gap: 16 }}>
              {/* Status card */}
              <Card variant={isPro ? 'premium' : 'default'} style={{ alignItems: 'center', paddingVertical: 28, gap: 12, backgroundColor: isPro ? undefined : 'rgba(255,255,255,0.03)' }}>
                <View style={{
                  width: 60, height: 60, borderRadius: 18,
                  backgroundColor: isPro ? colors.goldBg : 'rgba(255,255,255,0.05)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {isPro ? <Crown size={30} color={colors.gold} /> : <CreditCard size={30} color={colors.textMuted} />}
                </View>
                <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.display, fontWeight: 'bold' }}>
                  {isPro ? 'Membre Privilège' : 'Accès Standard'}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
                  {isPro ? 'Voyages illimités & fonctionnalités exclusives' : 'Passez à Pro pour débloquer toutes les fonctionnalités'}
                </Text>
              </Card>

              {!isPro && (
                <>
                  {/* Features grid */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                    {[
                      { icon: Plane, label: 'Voyages illimités' },
                      { icon: Zap, label: 'Régénération expert' },
                      { icon: FileDown, label: 'Export PDF deluxe' },
                      { icon: Award, label: 'Badge exclusif' },
                    ].map((f) => (
                      <View key={f.label} style={{
                        width: '48%', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius.xl,
                        padding: 18, alignItems: 'center', gap: 10,
                        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
                      }}>
                        <f.icon size={24} color={colors.gold} />
                        <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', fontWeight: '700' }}>
                          {f.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Button onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/pricing'); }} style={{ marginTop: 8 }}>
                    Devenir Pro — 9.99€/an
                  </Button>
                </>
              )}
            </View>
          )}

          {/* Action menu */}
          <View style={{ paddingHorizontal: 20, gap: 10, marginTop: 32 }}>
            <MenuItem icon={Settings} label="Préférences de voyage" onPress={() => { Haptics.selectionAsync(); router.push('/preferences'); }} />
            <MenuItem icon={Download} label="Exporter mes données" onPress={() => Haptics.selectionAsync()} />
            <MenuItem icon={Trash2} label="Supprimer mon compte" danger onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); Alert.alert('Supprimer', 'Contactez-nous à contact@naraevoyage.com'); }} />
            <MenuItem icon={LogOut} label="Se déconnecter" danger onPress={handleSignOut} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function StatItem({ value, label, gold }: { value: string | number; label: string; gold?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: gold ? colors.gold : colors.text, fontSize: 24, fontFamily: fonts.display, fontWeight: 'bold' }}>
        {value}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

function MenuItem({ icon: Icon, label, danger, onPress }: {
  icon: typeof Settings; label: string; danger?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
        borderRadius: radius.xl, padding: 18,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
      })}
    >
      <View style={{
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: danger ? colors.dangerBg : colors.goldBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} color={danger ? colors.danger : colors.gold} />
      </View>
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: '700', flex: 1 }}>
        {label}
      </Text>
      {!danger && <ChevronRight size={20} color={colors.textDim} />}
    </Pressable>
  );
}
