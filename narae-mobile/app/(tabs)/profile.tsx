import { useState } from 'react';
import { View, Text, ScrollView, FlatList, Pressable, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Settings, CreditCard, LogOut, ChevronRight, Crown, Plane, Trophy,
  Users, Download, Trash2, MapPin, Zap, FileDown, Award,
} from 'lucide-react-native';
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

type ProfileTab = 'voyages' | 'stats' | 'club';

export default function ProfileScreen() {
  const { user, profile, isLoading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>('voyages');

  const { data: trips, isLoading: tripsLoading } = useApi(
    () => (user ? fetchMyTrips() : Promise.resolve([])),
    [user?.id],
  );

  // Not logged in
  if (!authLoading && !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 20,
            backgroundColor: colors.goldBg,
            alignItems: 'center', justifyContent: 'center', marginBottom: 20,
          }}>
            <Plane size={32} color={colors.gold} />
          </View>
          <Text style={{ color: colors.text, fontSize: 22, fontFamily: fonts.display, marginBottom: 8, textAlign: 'center' }}>
            Connectez-vous
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            Accédez à votre profil et vos voyages
          </Text>
          <Button onPress={() => router.push('/(auth)/login')}>Se connecter</Button>
        </View>
      </SafeAreaView>
    );
  }

  if (authLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 20, gap: 16, alignItems: 'center', paddingTop: 60 }}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={140} height={20} />
          <Skeleton width={200} height={14} />
        </View>
      </SafeAreaView>
    );
  }

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur';
  const isPro = profile?.subscription_status === 'pro';
  const tripCount = trips?.length ?? 0;

  const handleSignOut = () => {
    Alert.alert('Se déconnecter', 'Êtes-vous sûr ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Cover + Avatar */}
        <View style={{ height: 120, backgroundColor: colors.surface }}>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(197,160,89,0.08)' }} />
        </View>

        <View style={{ alignItems: 'center', marginTop: -40, paddingHorizontal: 20 }}>
          <View style={{ borderWidth: 3, borderColor: colors.gold, borderRadius: 40, padding: 2 }}>
            <Avatar url={profile?.avatar_url} name={displayName} size="lg" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display }}>
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
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 20 }}>
            <StatItem value={tripCount} label="Voyages" />
            <StatItem value={isPro ? 'Pro' : 'Free'} label="Abonnement" gold={isPro} />
          </View>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 4, marginTop: 24, marginBottom: 16 }}>
          {([
            { key: 'voyages' as const, label: 'Voyages', icon: MapPin },
            { key: 'stats' as const, label: 'Stats', icon: Trophy },
            { key: 'club' as const, label: 'Club', icon: Crown },
          ]).map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                paddingVertical: 10, borderRadius: radius.md,
                backgroundColor: activeTab === tab.key ? colors.goldBg : 'transparent',
              }}
            >
              <tab.icon size={15} color={activeTab === tab.key ? colors.gold : colors.textMuted} />
              <Text style={{
                color: activeTab === tab.key ? colors.gold : colors.textMuted,
                fontSize: 13, fontWeight: '600',
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
                <TripCard key={trip.id} trip={trip} onPress={() => router.push(`/trip/${trip.id}`)} />
              ))
            )}
          </View>
        )}

        {activeTab === 'stats' && (
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {/* Referral */}
            {profile?.referral_code && (
              <Card variant="premium" style={{ gap: 8 }}>
                <Text style={{ color: colors.gold, fontSize: 15, fontFamily: fonts.display }}>Parrainage</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Partagez votre code pour gagner des voyages gratuits</Text>
                <View style={{
                  backgroundColor: colors.surface, borderRadius: radius.md,
                  padding: 12, alignItems: 'center',
                }}>
                  <Text style={{ color: colors.gold, fontSize: 20, fontWeight: '800', letterSpacing: 4 }}>
                    {profile.referral_code}
                  </Text>
                </View>
              </Card>
            )}
            {/* Stats cards */}
            <Card style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 20 }}>
              <StatItem value={tripCount} label="Voyages créés" />
              <StatItem value={(trips ?? []).filter((t) => new Date(t.end_date) < new Date()).length} label="Terminés" />
              <StatItem value={(trips ?? []).filter((t) => new Date(t.start_date) > new Date()).length} label="À venir" />
            </Card>
          </View>
        )}

        {activeTab === 'club' && (
          <View style={{ paddingHorizontal: 20, gap: 16 }}>
            {/* Status card */}
            <Card variant={isPro ? 'premium' : 'default'} style={{ alignItems: 'center', paddingVertical: 24, gap: 12 }}>
              <View style={{
                width: 56, height: 56, borderRadius: 16,
                backgroundColor: isPro ? colors.goldBg : colors.surface,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {isPro ? <Crown size={28} color={colors.gold} /> : <CreditCard size={28} color={colors.textMuted} />}
              </View>
              <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display }}>
                {isPro ? 'Membre Privilège' : 'Accès Standard'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                {isPro ? 'Voyages illimités & fonctionnalités exclusives' : 'Passez à Pro pour débloquer toutes les fonctionnalités'}
              </Text>
            </Card>

            {!isPro && (
              <>
                {/* Features grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {[
                    { icon: Plane, label: 'Voyages illimités' },
                    { icon: Zap, label: 'Régénération expert' },
                    { icon: FileDown, label: 'Export PDF deluxe' },
                    { icon: Award, label: 'Badge exclusif' },
                  ].map((f) => (
                    <View key={f.label} style={{
                      width: '48%', backgroundColor: colors.surface, borderRadius: radius.xl,
                      padding: 16, alignItems: 'center', gap: 8,
                      borderWidth: 1, borderColor: colors.borderSubtle,
                    }}>
                      <f.icon size={22} color={colors.gold} />
                      <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center', fontWeight: '600' }}>
                        {f.label}
                      </Text>
                    </View>
                  ))}
                </View>
                <Button onPress={() => router.push('/pricing')}>
                  Devenir Pro — 9.99€/an
                </Button>
              </>
            )}
          </View>
        )}

        {/* Action menu */}
        <View style={{ paddingHorizontal: 20, gap: 8, marginTop: 24 }}>
          <MenuItem icon={Settings} label="Préférences de voyage" onPress={() => router.push('/preferences')} />
          <MenuItem icon={Download} label="Exporter mes données" onPress={() => {}} />
          <MenuItem icon={Trash2} label="Supprimer mon compte" danger onPress={() => Alert.alert('Supprimer', 'Contactez-nous à contact@naraevoyage.com')} />
          <MenuItem icon={LogOut} label="Se déconnecter" danger onPress={handleSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({ value, label, gold }: { value: string | number; label: string; gold?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: gold ? colors.gold : colors.text, fontSize: 22, fontFamily: fonts.display }}>
        {value}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{label}</Text>
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
        backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : colors.surface,
        borderRadius: radius.xl, padding: 16,
        borderWidth: 1, borderColor: colors.borderSubtle,
      })}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: danger ? colors.dangerBg : colors.goldBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} color={danger ? colors.danger : colors.gold} />
      </View>
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: 15, fontWeight: '600', flex: 1 }}>
        {label}
      </Text>
      {!danger && <ChevronRight size={18} color={colors.textDim} />}
    </Pressable>
  );
}
