import { View, Text, ScrollView, Pressable, FlatList, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Plane, ArrowRight, Search, Compass, MapPin, Users } from 'lucide-react-native';
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
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 40, paddingBottom: 100 }}>
            {/* Premium Logo */}
            <View style={{ alignItems: 'center', marginBottom: 32 }}>
              <View style={{
                width: 56, height: 56, borderRadius: 18,
                backgroundColor: colors.gold,
                justifyContent: 'center', alignItems: 'center',
                shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 16,
              }}>
                <Plane size={28} color={colors.bg} strokeWidth={2.5} />
              </View>
            </View>

            {/* Hero text */}
            <View style={{ marginBottom: 40 }}>
              <Text style={{
                color: colors.text, fontSize: 34, textAlign: 'center', lineHeight: 46,
                fontFamily: fonts.display, letterSpacing: -0.5
              }}>
                L&apos;excellence du{'\n'}
                <Text style={{ color: colors.gold }}>voyage sur-mesure</Text>
              </Text>

              <Text style={{
                color: colors.textSecondary, fontSize: 16, textAlign: 'center',
                marginTop: 20, lineHeight: 24, paddingHorizontal: 12,
                fontFamily: fonts.sans,
              }}>
                Narae conçoit votre itinéraire idéal en quelques secondes. Expériences exclusives et logistique parfaite.
              </Text>
            </View>

            {/* Value props - Glassy Cards */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
              {[
                { icon: Compass, label: 'Exploration\nIllimitée' },
                { icon: MapPin, label: 'Adaptation\nPrécise' },
                { icon: Users, label: 'Partage\nPrivilégié' },
              ].map((item, i) => (
                <View key={i} style={{
                  flex: 1, alignItems: 'center', paddingVertical: 20, paddingHorizontal: 10,
                  backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.card,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                }}>
                  <View style={{
                    width: 48, height: 48, borderRadius: 16,
                    backgroundColor: 'rgba(197,160,89,0.15)',
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 12,
                  }}>
                    <item.icon size={22} color={colors.gold} />
                  </View>
                  <Text style={{ 
                    color: colors.textSecondary, 
                    fontSize: 10, 
                    textAlign: 'center', 
                    lineHeight: 14, 
                    fontFamily: fonts.sansBold,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                  }}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* CTAs */}
            <View style={{ gap: 16 }}>
              <Button
                size="lg"
                icon={ArrowRight}
                iconPosition="right"
                onPress={() => { 
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); 
                  router.push('/(auth)/login'); 
                }}
              >
                Commencer gratuitement
              </Button>

              <Button
                variant="outline"
                size="lg"
                onPress={() => router.push('/(auth)/register')}
              >
                Créer un compte
              </Button>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ─── Authenticated Dashboard ───
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
  })();

  const name = profile?.display_name?.split(' ')[0] || '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <AuthenticatedHome greeting={greeting} name={name} router={router} userId={user?.id} />
      </SafeAreaView>
    </View>
  );
}

function AuthenticatedHome({ greeting, name, router, userId }: {
  greeting: string; name: string; router: any; userId?: string;
}) {
  const { data: trips, isLoading } = useApi(
    () => (userId ? fetchMyTrips() : Promise.resolve([])),
    [userId ?? null],
  );

  const recentTrips = (trips ?? []).slice(0, 5);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* Premium Header */}
      <View style={{ padding: 24, paddingTop: 20 }}>
        <Text style={{
          color: colors.gold, fontSize: 14,
          fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 3,
          marginBottom: 8
        }}>
          Tableau de bord
        </Text>
        <Text style={{
          color: colors.text, fontSize: 32,
          fontFamily: fonts.sansBold, letterSpacing: -0.5
        }}>
          {greeting}{name ? `, ${name}` : ''} !
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 6, fontFamily: fonts.sans }}>
          Prêt pour votre prochaine aventure ?
        </Text>
      </View>

      {/* Enhanced search bar */}
      <Pressable
        onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/plan'); }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          marginHorizontal: 24, backgroundColor: 'rgba(255,255,255,0.05)',
          borderRadius: radius.button, paddingHorizontal: 20, height: 60,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <Search size={20} color={colors.gold} />
        <Text style={{ color: colors.textMuted, fontSize: 16, fontFamily: fonts.sans }}>Où souhaitez-vous aller ?</Text>
      </Pressable>

      {/* Plan CTA Card - More Premium */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/plan'); }}
        style={{ marginHorizontal: 24, marginTop: 24 }}
      >
        <LinearGradient
          colors={goldGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            borderRadius: radius.card,
            padding: 28,
            shadowColor: colors.gold, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 20,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.bg, fontSize: 22, fontFamily: fonts.sansBold, letterSpacing: -0.3 }}>
              Créer un voyage
            </Text>
            <Text style={{ color: 'rgba(2,6,23,0.7)', fontSize: 14, marginTop: 6, fontFamily: fonts.sansSemiBold }}>
              Itinéraire sur-mesure en 2 min
            </Text>
          </View>
          <View style={{
            width: 56, height: 56, borderRadius: 20,
            backgroundColor: 'rgba(2,6,23,0.12)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(2,6,23,0.08)'
          }}>
            <Plane size={28} color={colors.bg} strokeWidth={2.5} />
          </View>
        </LinearGradient>
      </Pressable>

      {/* Recent trips */}
      {isLoading ? (
        <View style={{ padding: 24, gap: 14 }}>
          <Skeleton width={160} height={20} />
          <Skeleton height={180} radius={radius.card} />
        </View>
      ) : recentTrips.length > 0 ? (
        <View style={{ marginTop: 32 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 16 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.sansBold }}>
              Derniers voyages
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/trips')}>
              <Text style={{ color: colors.gold, fontSize: 14, fontFamily: fonts.sansSemiBold }}>Tout voir</Text>
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
        <Text style={{
          color: colors.text, fontSize: 20, paddingHorizontal: 24, marginBottom: 16,
          fontFamily: fonts.sansBold,
        }}>
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
              onPress={() => router.push({ pathname: '/(tabs)/plan', params: { destination: item.name } })}
              style={{
                width: 160, borderRadius: radius.card, overflow: 'hidden',
                backgroundColor: colors.card,
                borderWidth: 1, borderColor: colors.borderSubtle,
                shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10,
              }}
            >
              <Image source={{ uri: item.image }} style={{ width: 160, height: 110 }} resizeMode="cover" />
              <View style={{ padding: 12 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontFamily: fonts.sansBold }}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, fontFamily: fonts.sans }}>{item.idealDuration}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </ScrollView>
  );
}

