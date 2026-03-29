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

export default function HomeScreen() {
  const { user, profile, isLoading: authLoading } = useAuth();
  const router = useRouter();

  // ─── Unauthenticated Landing ───
  if (!user && !authLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 50, paddingBottom: 60 }}>
            {/* Logo */}
            <View style={{ alignItems: 'center', marginBottom: 36 }}>
              <View style={{
                width: 76, height: 76, borderRadius: 22,
                backgroundColor: colors.gold,
                justifyContent: 'center', alignItems: 'center',
                shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16,
              }}>
                <Plane size={38} color={colors.bg} />
              </View>
            </View>

            {/* Hero text */}
            <Text style={{
              color: colors.text, fontSize: 34, textAlign: 'center', lineHeight: 42,
              fontFamily: fonts.display,
            }}>
              Ton agence de voyage{'\n'}
              <Text style={{ color: colors.gold, fontStyle: 'italic' }}>personnelle</Text>
            </Text>

            <Text style={{
              color: colors.textSecondary, fontSize: 15, textAlign: 'center',
              marginTop: 16, lineHeight: 22, paddingHorizontal: 16,
            }}>
              Narae génère un itinéraire sur-mesure en 2 minutes.{'\n'}Activités, restos, hôtels — tout est planifié.
            </Text>

            {/* Value props */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 32 }}>
              {[
                { icon: Compass, label: 'Exploration\nillimitée' },
                { icon: MapPin, label: 'Adaptation\nprécise' },
                { icon: Users, label: 'Partage\nprivilégié' },
              ].map((item, i) => (
                <View key={i} style={{
                  flex: 1, alignItems: 'center', padding: 16, gap: 10,
                  backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius['3xl'],
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
                }}>
                  <View style={{
                    width: 44, height: 44, borderRadius: 14,
                    backgroundColor: colors.goldBg,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <item.icon size={20} color={colors.gold} />
                  </View>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 15, fontWeight: '600' }}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>

            {/* CTA */}
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(auth)/login'); }}
              style={{ marginTop: 32 }}
            >
              <LinearGradient
                colors={goldGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: radius.xl, paddingVertical: 18,
                  flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
                  shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12,
                }}
              >
                <Text style={{ color: colors.bg, fontSize: 16, fontWeight: '800' }}>Commencer gratuitement</Text>
                <ArrowRight size={20} color={colors.bg} />
              </LinearGradient>
            </Pressable>

            <Pressable
              onPress={() => router.push('/(auth)/register')}
              style={{
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.xl, paddingVertical: 16,
                marginTop: 12, alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '700' }}>Créer un compte</Text>
            </Pressable>
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
    [userId],
  );

  const recentTrips = (trips ?? []).slice(0, 5);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* Greeting */}
      <View style={{ padding: 20, paddingTop: 16 }}>
        <Text style={{
          color: colors.text, fontSize: 32,
          fontFamily: fonts.display, fontWeight: 'bold'
        }}>
          {greeting}{name ? `, ${name}` : ''} !
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>
          Prêt pour votre prochaine aventure ?
        </Text>
      </View>

      {/* Quick search bar */}
      <Pressable
        onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/plan'); }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginHorizontal: 20, backgroundColor: 'rgba(255,255,255,0.05)',
          borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 14,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        }}
      >
        <Search size={18} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, fontSize: 15 }}>Où souhaitez-vous aller ?</Text>
      </Pressable>

      {/* Plan CTA */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/plan'); }}
        style={{ marginHorizontal: 20, marginTop: 20 }}
      >
        <LinearGradient
          colors={goldGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            borderRadius: radius['3xl'],
            padding: 24,
            shadowColor: colors.gold, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.bg, fontSize: 20, fontFamily: fonts.display, fontWeight: 'bold' }}>
              Planifier un voyage
            </Text>
            <Text style={{ color: 'rgba(2,6,23,0.6)', fontSize: 13, marginTop: 4, fontWeight: '600' }}>
              Itinéraire sur-mesure en 2 min
            </Text>
          </View>
          <View style={{
            width: 52, height: 52, borderRadius: 18,
            backgroundColor: 'rgba(2,6,23,0.1)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(2,6,23,0.05)'
          }}>
            <Plane size={26} color={colors.bg} strokeWidth={2.5} />
          </View>
        </LinearGradient>
      </Pressable>

      {/* Recent trips */}
      {isLoading ? (
        <View style={{ padding: 20, gap: 12 }}>
          <Skeleton width={140} height={18} />
          <Skeleton height={160} radius={radius['3xl']} />
        </View>
      ) : recentTrips.length > 0 ? (
        <View style={{ marginTop: 28 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 }}>
            <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display }}>
              Derniers voyages
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/trips')}>
              <Text style={{ color: colors.gold, fontSize: 13, fontWeight: '600' }}>Tout voir</Text>
            </Pressable>
          </View>
          <FlatList
            data={recentTrips}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}
            keyExtractor={(t) => t.id}
            renderItem={({ item }) => (
              <TripCard trip={item} compact onPress={() => router.push(`/trip/${item.id}`)} />
            )}
          />
        </View>
      ) : null}

      {/* Popular destinations */}
      <View style={{ marginTop: 28 }}>
        <Text style={{
          color: colors.text, fontSize: 18, paddingHorizontal: 20, marginBottom: 14,
          fontFamily: fonts.display,
        }}>
          Destinations populaires
        </Text>
        <FlatList
          data={DESTINATIONS.slice(0, 6)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          keyExtractor={(d) => d.slug}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/(tabs)/plan', params: { destination: item.name } })}
              style={{
                width: 140, borderRadius: radius['3xl'], overflow: 'hidden',
                backgroundColor: colors.card,
                borderWidth: 1, borderColor: colors.borderSubtle,
              }}
            >
              <Image source={{ uri: item.image }} style={{ width: 140, height: 100 }} resizeMode="cover" />
              <View style={{ padding: 10 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>{item.idealDuration}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </ScrollView>
  );
}
