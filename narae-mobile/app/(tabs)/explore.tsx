import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus';
import { fetchFeed, likeTrip, unlikeTrip, cloneTrip, type FeedTrip } from '@/lib/api/feed';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { TripCardSkeleton } from '@/components/ui/Skeleton';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { FeedCard } from '@/components/explore/FeedCard';
import { colors } from '@/lib/theme';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

type Tab = 'discover' | 'following';
type Sort = 'recent' | 'trending';

export default function ExploreScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('discover');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [allTrips, setAllTrips] = useState<FeedTrip[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [cloneTarget, setCloneTarget] = useState<FeedTrip | null>(null);
  const [cloning, setCloning] = useState(false);

  const { isLoading, refetch } = useApi(
    async () => {
      const res = await fetchFeed(tab, 1, sort);
      setAllTrips(res.trips);
      setHasMore(res.hasMore);
      setPage(1);
      return res;
    },
    [tab, sort],
  );

  useRefreshOnFocus(refetch);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    const nextPage = page + 1;
    try {
      const res = await fetchFeed(tab, nextPage, sort);
      setAllTrips((prev) => [...prev, ...res.trips]);
      setHasMore(res.hasMore);
      setPage(nextPage);
    } catch { /* ignore pagination errors */ }
  }, [hasMore, isLoading, page, tab, sort]);

  const handleLike = useCallback(async (trip: FeedTrip) => {
    if (!user) { router.push('/(auth)/login'); return; }

    // Optimistic update
    setAllTrips((prev) => prev.map((t) =>
      t.id === trip.id
        ? { ...t, user_liked: !t.user_liked, likes_count: t.user_liked ? t.likes_count - 1 : t.likes_count + 1 }
        : t,
    ));

    try {
      if (trip.user_liked) await unlikeTrip(trip.id);
      else await likeTrip(trip.id);
    } catch {
      // Revert on error
      setAllTrips((prev) => prev.map((t) =>
        t.id === trip.id
          ? { ...t, user_liked: trip.user_liked, likes_count: trip.likes_count }
          : t,
      ));
    }
  }, [user, router]);

  const handleClone = useCallback(async () => {
    if (!cloneTarget || !user) return;
    setCloning(true);
    try {
      const result = await cloneTrip(cloneTarget.id);
      setCloneTarget(null);
      router.push(`/trip/${result.id}`);
    } catch {
      Alert.alert('Erreur', 'Impossible de dupliquer ce voyage');
    } finally {
      setCloning(false);
    }
  }, [cloneTarget, user, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <ScreenHeader title="Explorer" subtitle="Voyages de la communauté" />

        {/* Tab bar */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 4 }}>
          <TabButton label="Découvrir" active={tab === 'discover'} onPress={() => { Haptics.selectionAsync(); setTab('discover'); }} />
          {user && <TabButton label="Suivis" active={tab === 'following'} onPress={() => { Haptics.selectionAsync(); setTab('following'); }} />}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setSort(sort === 'recent' ? 'trending' : 'recent'); }}
            style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
              backgroundColor: 'rgba(255,255,255,0.05)',
            }}
          >
            <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>
              {sort === 'recent' ? 'Récents' : 'Tendances'}
            </Text>
          </Pressable>
        </View>

        {/* Feed */}
        {isLoading && allTrips.length === 0 ? (
          <View style={{ padding: 20 }}>
            <TripCardSkeleton />
            <TripCardSkeleton />
          </View>
        ) : allTrips.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={tab === 'discover' ? 'Aucun voyage public' : 'Aucun voyage de vos abonnements'}
            description={tab === 'discover'
              ? 'Soyez le premier à partager un voyage !'
              : 'Suivez des voyageurs pour voir leurs trips ici'}
          />
        ) : (
          <FlatList
            data={allTrips}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
            refreshing={false}
            onRefresh={refetch}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <FeedCard
                trip={item}
                onPress={() => { Haptics.selectionAsync(); router.push(`/trip/${item.id}`); }}
                onLike={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleLike(item); }}
                onClone={() => {
                  Haptics.selectionAsync();
                  if (!user) { router.push('/(auth)/login'); return; }
                  setCloneTarget(item);
                }}
              />
            )}
          />
        )}

        {/* Clone confirmation */}
        <BottomSheet
          isOpen={!!cloneTarget}
          onClose={() => setCloneTarget(null)}
          height={0.25}
        >
          <View style={{ padding: 20, gap: 14 }}>
            <Text style={{ color: '#f8fafc', fontSize: 17, fontWeight: '700' }}>
              Dupliquer ce voyage ?
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 13 }}>
              Une copie de "{cloneTarget?.title || cloneTarget?.destination}" sera ajoutée à vos voyages.
            </Text>
            <Button isLoading={cloning} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleClone(); }}>Dupliquer</Button>
          </View>
        </BottomSheet>
      </SafeAreaView>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
        backgroundColor: active ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
        borderWidth: 1, borderColor: active ? '#c5a059' : 'transparent',
      }}
    >
      <Text style={{ color: active ? '#c5a059' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
