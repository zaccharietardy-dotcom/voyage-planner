import { View, Text, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MapPin } from 'lucide-react-native';
import { useApi } from '@/hooks/useApi';
import { fetchProfile } from '@/lib/api/users';
import { api } from '@/lib/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { FeedCard } from '@/components/explore/FeedCard';
import { colors, fonts } from '@/lib/theme';
import type { FeedTrip } from '@/lib/api/feed';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: profile, isLoading } = useApi(
    () => fetchProfile(id!),
    [id],
  );

  const { data: trips } = useApi(
    () => api.get<{ trips: FeedTrip[] }>(`/api/feed?userId=${id}&limit=20`).then((r) => r.trips).catch(() => []),
    [id],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 20, alignItems: 'center', gap: 16, paddingTop: 60 }}>
          <Skeleton width={72} height={72} radius={36} />
          <Skeleton width={140} height={20} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={trips ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <ArrowLeft size={24} color={colors.text} />
              </Pressable>
            </View>

            {/* Profile */}
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 12 }}>
              <Avatar url={profile?.avatar_url} name={profile?.display_name || '?'} size="lg" />
              <Text style={{ color: colors.text, fontSize: 22, fontFamily: fonts.display }}>
                {profile?.display_name || 'Utilisateur'}
              </Text>
            </View>

            <Text style={{
              color: colors.text, fontSize: 16, fontFamily: fonts.display,
              paddingHorizontal: 20, marginBottom: 14, marginTop: 8,
            }}>
              Voyages
            </Text>
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
