import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Compass, Search } from 'lucide-react-native';
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
import { RecommendedUsers } from '@/components/social/RecommendedUsers';
import { UserSearch } from '@/components/social/UserSearch';
import { colors, fonts, radius } from '@/lib/theme';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { useTranslation } from '@/lib/i18n';

type Tab = 'discover' | 'following';
type Sort = 'recent' | 'trending';

export default function ExploreScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('discover');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [allTrips, setAllTrips] = useState<FeedTrip[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [cloneTarget, setCloneTarget] = useState<FeedTrip | null>(null);
  const [cloning, setCloning] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

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
    } catch {}
  }, [hasMore, isLoading, page, tab, sort]);

  const handleLike = useCallback(async (trip: FeedTrip) => {
    if (!user) {
      router.push('/(auth)/login');
      return;
    }

    setAllTrips((prev) => prev.map((t) =>
      t.id === trip.id
        ? { ...t, user_liked: !t.user_liked, likes_count: t.user_liked ? t.likes_count - 1 : t.likes_count + 1 }
        : t,
    ));

    try {
      if (trip.user_liked) await unlikeTrip(trip.id);
      else await likeTrip(trip.id);
    } catch {
      setAllTrips((prev) => prev.map((t) =>
        t.id === trip.id
          ? { ...t, user_liked: trip.user_liked, likes_count: trip.likes_count }
          : t,
      ));
      Alert.alert(t('common.error'), t('explore.error.message'));
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
      Alert.alert(t('common.error'), t('explore.clone.error'));
    } finally {
      setCloning(false);
    }
  }, [cloneTarget, user, router]);

  return (
    <View style={styles.container}>
      <PremiumBackground />
      <View style={styles.content}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingRight: 20 }}>
          <View style={{ flex: 1 }}>
            <ScreenHeader title={t('explore.title')} subtitle={t('explore.subtitle')} />
          </View>
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setShowSearch(true); }}
            style={styles.searchBtn}
          >
            <Search size={20} color={colors.gold} />
          </Pressable>
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.tabsWrap}>
            <TabButton label={t('explore.tab.discover')} active={tab === 'discover'} onPress={() => { Haptics.selectionAsync(); setTab('discover'); }} />
            {user ? <TabButton label={t('explore.tab.following')} active={tab === 'following'} onPress={() => { Haptics.selectionAsync(); setTab('following'); }} /> : null}
          </View>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setSort(sort === 'recent' ? 'trending' : 'recent');
            }}
            style={styles.sortPill}
          >
            <Text style={styles.sortText}>
              {sort === 'recent' ? t('explore.sort.recent') : t('explore.sort.trending')}
            </Text>
          </Pressable>
        </View>

        <RecommendedUsers />

        {isLoading && allTrips.length === 0 ? (
          <View style={styles.skeletonWrap}>
            <TripCardSkeleton />
            <TripCardSkeleton />
          </View>
        ) : allTrips.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={tab === 'discover' ? t('explore.empty.discover') : t('explore.empty.following')}
            description={tab === 'discover'
              ? t('explore.empty.discover.desc')
              : t('explore.empty.following.desc')}
          />
        ) : (
          <FlatList
            data={allTrips}
            contentInsetAdjustmentBehavior="automatic"
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.listContent}
            refreshing={false}
            onRefresh={refetch}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <FeedCard
                trip={item}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push(`/trip/${item.id}`);
                }}
                onLike={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  handleLike(item);
                }}
                onClone={() => {
                  Haptics.selectionAsync();
                  if (!user) {
                    router.push('/(auth)/login');
                    return;
                  }
                  setCloneTarget(item);
                }}
              />
            )}
          />
        )}

        <BottomSheet isOpen={showSearch} onClose={() => setShowSearch(false)} height={0.7}>
          <UserSearch onClose={() => setShowSearch(false)} />
        </BottomSheet>

        <BottomSheet isOpen={!!cloneTarget} onClose={() => setCloneTarget(null)} height={0.25}>
          <View style={styles.sheetContent}>
            <Text style={styles.sheetTitle}>{t('explore.clone.title')}</Text>
            <Text style={styles.sheetDescription}>
              {t('explore.clone.desc')} &quot;{cloneTarget?.title || cloneTarget?.destination}&quot; {t('explore.clone.desc_end')}
            </Text>
            <Button
              isLoading={cloning}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleClone();
              }}
            >
              {t('explore.clone.confirm')}
            </Button>
          </View>
        </BottomSheet>
      </View>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{label}</Text>
      <View style={[styles.tabIndicator, active ? styles.tabIndicatorActive : null]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  tabsWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 18,
    flex: 1,
  },
  tabButton: {
    gap: 8,
    paddingBottom: 2,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  tabLabelActive: {
    color: colors.gold,
  },
  tabIndicator: {
    height: 2,
    borderRadius: radius.full,
    backgroundColor: 'transparent',
  },
  tabIndicatorActive: {
    backgroundColor: colors.gold,
  },
  sortPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sortText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  skeletonWrap: {
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 124,
  },
  sheetContent: {
    padding: 20,
    gap: 14,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: fonts.display,
  },
  sheetDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
});
