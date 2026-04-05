import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MapPin, UserPlus, UserCheck, MessageCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { useFollow } from '@/hooks/useFollow';
import { fetchProfile } from '@/lib/api/users';
import { api } from '@/lib/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { FeedCard } from '@/components/explore/FeedCard';
import { colors, fonts, radius } from '@/lib/theme';
import type { FeedTrip } from '@/lib/api/feed';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isOwnProfile = user?.id === id;

  const { data: profile, isLoading } = useApi(
    () => fetchProfile(id!),
    [id],
  );

  const { data: trips } = useApi(
    () => api.get<{ trips: FeedTrip[] }>(`/api/feed?userId=${id}&limit=20`).then((r) => r.trips).catch(() => []),
    [id],
  );

  const { isFollowing, followerCount, followingCount, stats, toggleFollow } = useFollow(id!);

  const handleFollow = () => {
    if (!user) {
      router.push('/(auth)/login');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toggleFollow();
  };

  const handleMessage = () => {
    if (!user) {
      router.push('/(auth)/login');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/messages?newConversation=${id}` as any);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={s.container}>
        <View style={{ padding: 20, alignItems: 'center', gap: 16, paddingTop: 60 }}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={140} height={20} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <FlatList
        data={trips ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={s.header}>
              <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} hitSlop={12}>
                <ArrowLeft size={24} color={colors.text} />
              </Pressable>
            </View>

            {/* Profile */}
            <View style={s.profileSection}>
              <View style={s.avatarRing}>
                <Avatar url={profile?.avatar_url} name={profile?.display_name || '?'} size="lg" />
              </View>
              <Text style={s.displayName}>{profile?.display_name || 'Utilisateur'}</Text>

              {/* Stats row */}
              <View style={s.statsRow}>
                <View style={s.stat}>
                  <Text style={s.statValue}>{stats?.tripCount ?? trips?.length ?? 0}</Text>
                  <Text style={s.statLabel}>Voyages</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.stat}>
                  <Text style={s.statValue}>{followerCount}</Text>
                  <Text style={s.statLabel}>Abonnés</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.stat}>
                  <Text style={s.statValue}>{followingCount}</Text>
                  <Text style={s.statLabel}>Suivis</Text>
                </View>
              </View>

              {/* Gamification row */}
              {stats ? (
                <View style={s.gamifRow}>
                  <View style={s.gamifBadge}>
                    <Text style={s.gamifEmoji}>⚡</Text>
                    <Text style={s.gamifText}>Nv. {stats.level}</Text>
                  </View>
                  {stats.currentStreak > 0 ? (
                    <View style={s.gamifBadge}>
                      <Text style={s.gamifEmoji}>🔥</Text>
                      <Text style={s.gamifText}>{stats.currentStreak}j</Text>
                    </View>
                  ) : null}
                  <View style={s.gamifBadge}>
                    <Text style={s.gamifEmoji}>🌍</Text>
                    <Text style={s.gamifText}>{stats.countryCount} pays</Text>
                  </View>
                </View>
              ) : null}

              {/* Action buttons */}
              {!isOwnProfile && user ? (
                <View style={s.actionRow}>
                  <Pressable
                    onPress={handleFollow}
                    style={[s.followBtn, isFollowing ? s.followBtnActive : null]}
                  >
                    {isFollowing ? (
                      <UserCheck size={16} color={colors.gold} />
                    ) : (
                      <UserPlus size={16} color={colors.bg} />
                    )}
                    <Text style={[s.followBtnText, isFollowing ? s.followBtnTextActive : null]}>
                      {isFollowing ? 'Suivi' : 'Suivre'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={handleMessage} style={s.messageBtn}>
                    <MessageCircle size={16} color={colors.gold} />
                    <Text style={s.messageBtnText}>Message</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <Text style={s.sectionTitle}>Voyages</Text>
          </>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <MapPin size={32} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8 }}>Aucun voyage public</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 20 }}>
            <FeedCard
              trip={item}
              onPress={() => router.push(`/trip/${item.id}`)}
              onLike={() => {}}
              onClone={() => {}}
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderCurve: 'continuous',
    padding: 3,
    borderWidth: 2,
    borderColor: 'rgba(197,160,89,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.display,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginHorizontal: 20,
    borderRadius: radius['2xl'],
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.gold, fontSize: 20, fontFamily: fonts.display },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  gamifRow: {
    flexDirection: 'row',
    gap: 8,
  },
  gamifBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  gamifEmoji: { fontSize: 12 },
  gamifText: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
  },
  followBtnActive: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  followBtnText: {
    color: colors.bg,
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
  followBtnTextActive: {
    color: colors.gold,
  },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  messageBtnText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.display,
    paddingHorizontal: 20,
    marginBottom: 14,
    marginTop: 8,
  },
});
