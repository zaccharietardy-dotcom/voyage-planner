import { View, Text, ScrollView, Pressable, FlatList, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Plane, ArrowRight, Search, Compass, MapPin, Users, Bell } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { fetchMyTrips } from '@/lib/api/trips';
import { DESTINATIONS } from '@/lib/destinations';
import { colors, fonts, radius, goldGradient } from '@/lib/theme';
import { TripCard } from '@/components/trip/TripCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { Button } from '@/components/ui/Button';

export default function HomeScreen() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ─── Unauthenticated Landing ───
  if (!user && !authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.landingContent}>
            {/* Logo Section */}
            <View style={styles.landingLogoContainer}>
              <View style={styles.landingLogoBox}>
                <Plane size={32} color={colors.bg} strokeWidth={2.5} />
              </View>
            </View>

            {/* Hero text */}
            <View style={styles.heroSection}>
              <Text style={styles.heroTitle}>
                Ton agence de voyage{'\n'}
                <Text style={{ color: colors.gold }}>personnelle</Text>
              </Text>

              <Text style={styles.heroSubtitle}>
                Narae génère un itinéraire sur-mesure en 2 minutes.{'\n'}Activités, restos, hôtels — tout est planifié.
              </Text>
            </View>

            {/* Value props */}
            <View style={styles.valuePropsContainer}>
              {[
                { icon: Compass, label: 'Exploration\nillimitée' },
                { icon: MapPin, label: 'Adaptation\nprécise' },
                { icon: Users, label: 'Partage\nprivilégié' },
              ].map((item, i) => (
                <View key={i} style={styles.valuePropCard}>
                  <View style={styles.valuePropIconBox}>
                    <item.icon size={20} color={colors.gold} />
                  </View>
                  <Text style={styles.valuePropLabel}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* CTAs */}
            <View style={styles.ctaContainer}>
              <Button
                variant="primary"
                size="lg"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/login'); }}
                icon={ArrowRight}
                iconPosition="right"
              >
                Commencer gratuitement
              </Button>

              <Button
                variant="outline"
                size="lg"
                onPress={() => router.push('/(auth)/register')}
                style={{ marginTop: 12 }}
              >
                Créer un compte
              </Button>
            </View>
          </ScrollView>
      </View>
    );
  }

  // ─── Authenticated: Home Dashboard ───
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const name = profile?.display_name?.split(' ')[0] || '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <AuthenticatedHome greeting={greeting} name={name} router={router} userId={user?.id} isAuthenticated />
    </View>
  );
}

function AuthenticatedHome({ greeting, name, router, userId, isAuthenticated }: {
  greeting: string; name: string; router: any; userId?: string; isAuthenticated?: boolean;
}) {
  const { data: trips, isLoading } = useApi(
    () => (userId ? fetchMyTrips() : Promise.resolve([])),
    [userId ?? null],
  );

  const recentTrips = (trips ?? []).slice(0, 5);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting + Bell */}
      <View style={styles.dashboardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetingTitle}>
            {greeting}{name ? `, ${name}` : ''} !
          </Text>
          <Text style={styles.greetingSubtitle}>
            Prêt pour votre prochaine aventure ?
          </Text>
        </View>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); router.push('/notifications' as any); }}
          style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Bell size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Quick search bar */}
      <Pressable
        onPress={() => { Haptics.selectionAsync(); router.push('/plan'); }}
        style={styles.searchBar}
      >
        <Search size={18} color={colors.textMuted} />
        <Text style={styles.searchPlaceholder}>Où souhaitez-vous aller ?</Text>
      </Pressable>

      {/* Plan CTA */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/plan'); }}
        style={styles.planCta}
      >
        <LinearGradient
          colors={goldGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.planCtaGradient}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.planCtaTitle}>
              Planifier un voyage
            </Text>
            <Text style={styles.planCtaSubtitle}>
              Itinéraire sur-mesure en 2 min
            </Text>
          </View>
          <View style={styles.planCtaIconBox}>
            <Plane size={26} color={colors.bg} strokeWidth={2.5} />
          </View>
        </LinearGradient>
      </Pressable>

      {/* Recent trips */}
      {isLoading ? (
        <View style={{ padding: 24, gap: 12 }}>
          <Skeleton width={140} height={18} />
          <Skeleton height={160} radius={radius.card} />
        </View>
      ) : recentTrips.length > 0 ? (
        <View style={{ marginTop: 32 }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Derniers voyages
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/trips')}>
              <Text style={styles.sectionLink}>Tout voir</Text>
            </Pressable>
          </View>
          <FlatList
            data={recentTrips}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => (
              <TripCard trip={item} compact onPress={() => router.push(`/trip/${item.id}`)} />
            )}
          />
        </View>
      ) : null}

      {/* Popular destinations */}
      <View style={{ marginTop: 32 }}>
        <Text style={[styles.sectionTitle, { paddingHorizontal: 24, marginBottom: 16 }]}>
          Destinations populaires
        </Text>
        <FlatList
          data={DESTINATIONS.slice(0, 6)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, gap: 14 }}
          keyExtractor={(d) => d.slug}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/plan', params: { destination: item.name } })}
              style={styles.destinationCard}
            >
              <Image source={{ uri: item.image }} style={styles.destinationImage} resizeMode="cover" />
              <View style={styles.destinationInfo}>
                <Text style={styles.destinationName}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={styles.destinationMeta}>{item.idealDuration}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Landing Styles
  landingContent: {
    padding: 24,
    paddingTop: 40,
    paddingBottom: 60,
  },
  landingLogoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  landingLogoBox: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0 6px 16px rgba(197,160,89,0.4)',
  },
  heroSection: {
    marginBottom: 40,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 36,
    textAlign: 'center',
    lineHeight: 44,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 24,
    paddingHorizontal: 12,
    fontFamily: fonts.sans,
  },
  valuePropsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 40,
  },
  valuePropCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  valuePropIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  valuePropLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 15,
    fontFamily: fonts.sansSemiBold,
  },
  ctaContainer: {
    marginTop: 8,
  },

  // Dashboard Styles
  dashboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    paddingTop: 16,
    gap: 12,
  },
  greetingTitle: {
    color: colors.text,
    fontSize: 32,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
  },
  greetingSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
    fontFamily: fonts.sans,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.button,
    borderCurve: 'continuous',
    paddingHorizontal: 20,
    height: 56,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchPlaceholder: {
    color: colors.textMuted,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  planCta: {
    marginHorizontal: 24,
    marginTop: 24,
  },
  planCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 24,
    boxShadow: '0 8px 15px rgba(197,160,89,0.3)',
  },
  planCtaTitle: {
    color: colors.bg,
    fontSize: 20,
    fontFamily: fonts.display,
  },
  planCtaSubtitle: {
    color: 'rgba(2,6,23,0.6)',
    fontSize: 13,
    marginTop: 4,
    fontFamily: fonts.sansSemiBold,
  },
  planCtaIconBox: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(2,6,23,0.05)',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.sansBold,
  },
  sectionLink: {
    color: colors.gold,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  destinationCard: {
    width: 150,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  destinationImage: {
    width: 150,
    height: 100,
  },
  destinationInfo: {
    padding: 12,
  },
  destinationName: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
  destinationMeta: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
    fontFamily: fonts.sans,
  },
});
