import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Crown,
  Download,
  LogOut,
  MapPin,
  Settings,
  Trash2,
  Trophy,
  Plane,
  ChevronRight,
  CreditCard,
  Zap,
  FileDown,
  Award,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { fetchMyTrips } from '@/lib/api/trips';
import { deleteAccount, exportAccountData } from '@/lib/api/account';
import { fetchUserStats, type UserStats } from '@/lib/api/social';
import { BadgeShowcase } from '@/components/profile/BadgeShowcase';
import { LevelProgress } from '@/components/profile/LevelProgress';
import { StreakCounter } from '@/components/profile/StreakCounter';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TripCard } from '@/components/trip/TripCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { colors, fonts, radius } from '@/lib/theme';

type ProfileTab = 'voyages' | 'stats' | 'club';

const PROFILE_TABS = [
  { key: 'voyages' as const, label: 'Voyages', icon: MapPin },
  { key: 'stats' as const, label: 'Stats', icon: Trophy },
  { key: 'club' as const, label: 'Club', icon: Crown },
];

const CLUB_FEATURES = [
  { icon: Plane, label: 'Voyages illimités' },
  { icon: Zap, label: 'Régénération expert' },
  { icon: FileDown, label: 'Export PDF deluxe' },
  { icon: Award, label: 'Badge exclusif' },
];

export default function ProfileScreen() {
  const { user, profile, isLoading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ProfileTab>('voyages');
  const [exporting, setExporting] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const { data: stats } = useApi(
    () => (user ? fetchUserStats(user.id) : Promise.resolve(null)),
    [user?.id ?? null],
  );

  const { data: trips, isLoading: tripsLoading } = useApi(
    () => (user ? fetchMyTrips() : Promise.resolve([])),
    [user?.id ?? null],
  );

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur';
  const isPro = profile?.subscription_status === 'pro';
  const tripCount = trips?.length ?? 0;

  const handleLogin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/(auth)/login',
      params: { redirect: '/profile' },
    });
  };

  const handleSignOut = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert('Se déconnecter', 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportAccountData();
    } catch (error) {
      Alert.alert('Export impossible', error instanceof Error ? error.message : 'Une erreur est survenue.');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Supprimer mon compte',
      'Cette action est définitive. Toutes vos données et vos voyages seront supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer définitivement',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteAccount();
              await signOut();
              router.replace('/(tabs)');
            } catch (error) {
              Alert.alert('Suppression impossible', error instanceof Error ? error.message : 'Une erreur est survenue.');
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  };

  if (!authLoading && !user) {
    return (
      <View style={styles.container}>
        <PremiumBackground />
        <View style={[styles.loggedOutWrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.loggedOutCard}>
            <View style={styles.loggedOutIcon}>
              <Plane size={32} color={colors.gold} />
            </View>
            <View style={styles.loggedOutCopy}>
              <Text style={styles.loggedOutTitle}>Connectez-vous</Text>
              <Text style={styles.loggedOutText}>
                Retrouvez votre profil, vos voyages et vos réglages sans scroller dans le vide.
              </Text>
            </View>
            <Button size="lg" onPress={handleLogin}>Se connecter</Button>
          </View>
        </View>
      </View>
    );
  }

  if (authLoading) {
    return (
      <View style={styles.container}>
        <PremiumBackground />
        <View style={[styles.loadingWrap, { paddingTop: insets.top + 24 }]}>
          <Skeleton height={240} radius={radius.card} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PremiumBackground />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 136 },
        ]}
      >
        {/* Profile card — centered layout like web */}
        <View style={styles.heroCard}>
          <View style={styles.heroBody}>
            {/* Centered avatar */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <View style={styles.avatarRing}>
                <Avatar url={profile?.avatar_url} name={displayName} size="lg" />
              </View>
              {isPro ? (
                <View style={styles.proBadge}>
                  <Crown size={14} color={colors.gold} />
                </View>
              ) : null}
            </View>

            {/* Name centered */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={styles.displayName}>{displayName}</Text>
              <Text style={styles.username}>@{displayName.toLowerCase().replace(/\s+/g, '_')}</Text>
              <Text style={styles.email}>{user?.email}</Text>
            </View>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 20 }} />

            {/* Stats — 3 columns */}
            <View style={styles.statsCard}>
              <Stat value={tripCount} label="Voyages" />
              <View style={styles.statsDivider} />
              <Stat value={stats?.followerCount ?? 0} label="Abonnés" />
              <View style={styles.statsDivider} />
              <Stat value={stats?.followingCount ?? 0} label="Suivis" />
            </View>
          </View>
        </View>

        {/* Compact action row */}
        <View style={styles.actionsRow}>
          <Pressable onPress={() => { Haptics.selectionAsync(); router.push('/preferences'); }} style={styles.actionButton}>
            <Settings size={18} color={colors.gold} />
            <Text style={styles.actionLabel}>Réglages</Text>
          </Pressable>
          <Pressable onPress={handleSignOut} style={styles.actionButton}>
            <LogOut size={18} color="rgba(255,255,255,0.5)" />
            <Text style={styles.actionLabel}>Déconnexion</Text>
          </Pressable>
        </View>

        <View style={styles.tabsRow}>
          {PROFILE_TABS.map((tab) => {
            const active = activeTab === tab.key;

            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTab(tab.key);
                }}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <tab.icon size={16} color={active ? colors.gold : colors.textMuted} />
                <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeTab === 'voyages' ? (
          <View style={styles.tabContent}>
            {tripsLoading ? (
              <>
                <Skeleton height={220} radius={radius.card} />
                <Skeleton height={220} radius={radius.card} />
              </>
            ) : tripCount === 0 ? (
              <Card variant="elevated" style={styles.emptyTripsCard}>
                <MapPin size={36} color={colors.textMuted} />
                <Text style={styles.emptyTripsTitle}>Aucun voyage pour le moment</Text>
                <Text style={styles.emptyTripsText}>
                  Lancez votre premier itinéraire depuis le bouton central.
                </Text>
              </Card>
            ) : (
              (trips ?? []).map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onPress={() => {
                    Haptics.selectionAsync();
                    router.push(`/trip/${trip.id}`);
                  }}
                />
              ))
            )}
          </View>
        ) : null}

        {activeTab === 'stats' ? (
          <View style={styles.tabContent}>
            <Card variant="premium" style={styles.statsOverview}>
              <Stat value={tripCount} label="Créés" />
              <Stat value={(trips ?? []).filter((trip) => new Date(trip.end_date) < new Date()).length} label="Terminés" />
              <Stat value={(trips ?? []).filter((trip) => new Date(trip.start_date) > new Date()).length} label="À venir" />
            </Card>

            {stats ? (
              <>
                <LevelProgress level={stats.level} totalXp={stats.totalXp} />
                <StreakCounter currentStreak={stats.currentStreak} longestStreak={stats.longestStreak} />
                <BadgeShowcase earnedBadgeIds={stats.badges} />
              </>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'club' ? (
          <View style={styles.tabContent}>
            <Card variant={isPro ? 'premium' : 'elevated'} style={styles.clubCard}>
              <View style={[styles.clubIconWrap, isPro ? styles.clubIconWrapActive : null]}>
                {isPro ? <Crown size={30} color={colors.gold} /> : <CreditCard size={30} color={colors.textMuted} />}
              </View>
              <Text style={styles.clubTitle}>{isPro ? 'Membre Privilège' : 'Accès Standard'}</Text>
              <Text style={styles.clubText}>
                {isPro
                  ? 'Voyages illimités et fonctionnalités exclusives.'
                  : 'Passez à Pro pour débloquer toutes les fonctionnalités.'}
              </Text>
            </Card>

            {!isPro ? (
              <>
                <View style={styles.featureGrid}>
                  {CLUB_FEATURES.map((feature) => (
                    <View key={feature.label} style={styles.featureCard}>
                      <feature.icon size={24} color={colors.gold} />
                      <Text style={styles.featureLabel}>{feature.label}</Text>
                    </View>
                  ))}
                </View>

                <Button
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push('/pricing');
                  }}
                >
                  Devenir Pro
                </Button>
              </>
            ) : (
              <Button
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/pricing');
                }}
                variant="outline"
              >
                Gérer mon abonnement
              </Button>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stat({ value, label, gold }: { value: string | number; label: string; gold?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, gold ? styles.statValueGold : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  danger,
  disabled,
  loading,
}: {
  icon: typeof Settings;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.menuItem,
        pressed ? styles.menuItemPressed : null,
        disabled ? styles.menuItemDisabled : null,
      ]}
    >
      <View style={[styles.menuIconWrap, danger ? styles.menuIconWrapDanger : null]}>
        {loading ? (
          <ActivityIndicator size="small" color={danger ? colors.danger : colors.gold} />
        ) : (
          <Icon size={20} color={danger ? colors.danger : colors.gold} />
        )}
      </View>
      <Text style={[styles.menuLabel, danger ? styles.menuLabelDanger : null]}>{label}</Text>
      {!danger ? <ChevronRight size={18} color={colors.textDim} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loggedOutWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loggedOutCard: {
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 28,
    gap: 18,
  },
  loggedOutIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loggedOutCopy: {
    gap: 8,
  },
  loggedOutTitle: {
    color: colors.text,
    fontSize: 34,
    fontFamily: fonts.display,
    lineHeight: 40,
  },
  loggedOutText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontFamily: fonts.sans,
    lineHeight: 24,
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 18,
  },
  heroCard: {
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(10,17,40,0.9)',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    overflow: 'hidden',
  },
  heroBody: {
    paddingHorizontal: 22,
    paddingVertical: 28,
    gap: 16,
    alignItems: 'center',
  },
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderCurve: 'continuous',
    padding: 4,
    backgroundColor: colors.bg,
    borderWidth: 3,
    borderColor: 'rgba(197,160,89,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: {
    color: colors.text,
    fontSize: 28,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  username: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  email: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sans,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  proBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    minWidth: 80,
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.sansSemiBold,
  },
  statsCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 18,
    borderRadius: radius['2xl'],
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statsDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: colors.gold,
    fontSize: 24,
    fontFamily: fonts.display,
  },
  statValueGold: {
    color: colors.gold,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  actionsSection: {
    gap: 10,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  menuItemPressed: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  menuItemDisabled: {
    opacity: 0.6,
  },
  menuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconWrapDanger: {
    backgroundColor: colors.dangerBg,
  },
  menuLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansMedium,
  },
  menuLabelDanger: {
    color: colors.danger,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tabActive: {
    backgroundColor: colors.goldBg,
    borderColor: 'rgba(197,160,89,0.22)',
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  tabLabelActive: {
    color: colors.gold,
  },
  tabContent: {
    gap: 12,
  },
  emptyTripsCard: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 10,
  },
  emptyTripsTitle: {
    color: colors.text,
    fontSize: 17,
    fontFamily: fonts.sansSemiBold,
  },
  emptyTripsText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlign: 'center',
    lineHeight: 22,
  },
  statsOverview: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 24,
  },
  clubCard: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 12,
  },
  clubIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubIconWrapActive: {
    backgroundColor: colors.goldBg,
  },
  clubTitle: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.display,
  },
  clubText: {
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlign: 'center',
    lineHeight: 22,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    width: '48%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 18,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  featureLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    textAlign: 'center',
  },
});
