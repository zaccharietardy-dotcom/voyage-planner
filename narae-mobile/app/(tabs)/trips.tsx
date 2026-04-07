import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Map, Plus, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { useRefreshOnFocus } from '@/hooks/useRefreshOnFocus';
import { fetchMyTrips, deleteTrip, type TripListItem } from '@/lib/api/trips';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { TripCard } from '@/components/trip/TripCard';
import { TripCardSkeleton } from '@/components/ui/Skeleton';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { colors, fonts, radius } from '@/lib/theme';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { useTranslation, type TranslationKey } from '@/lib/i18n';

type Filter = 'all' | 'upcoming' | 'active' | 'past';

const FILTER_KEYS: { key: Filter; i18nKey: TranslationKey }[] = [
  { key: 'all', i18nKey: 'trips.filter.all' },
  { key: 'upcoming', i18nKey: 'trips.filter.upcoming' },
  { key: 'active', i18nKey: 'trips.filter.active' },
  { key: 'past', i18nKey: 'trips.filter.past' },
];

function getStatus(trip: TripListItem): 'upcoming' | 'active' | 'past' {
  const now = new Date();
  const start = new Date(trip.start_date);
  const end = new Date(trip.end_date);
  if (now < start) return 'upcoming';
  if (now >= start && now < end) return 'active';
  return 'past';
}

export default function TripsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedTrip, setSelectedTrip] = useState<TripListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { t } = useTranslation();

  const { data: trips, isLoading, refetch } = useApi(
    () => (user ? fetchMyTrips() : Promise.resolve([])),
    [user?.id ?? null],
  );

  useRefreshOnFocus(refetch);

  const filtered = (trips ?? []).filter((t) => filter === 'all' || getStatus(t) === filter);

  const handleDelete = useCallback(async () => {
    if (!selectedTrip) return;
    Alert.alert(
      t('trips.delete.title'),
      `"${selectedTrip.title || selectedTrip.destination}" ${t('trips.delete.confirm')}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteTrip(selectedTrip.id);
              setSelectedTrip(null);
              refetch();
            } catch {
              Alert.alert(t('common.error'), t('trips.empty.desc.filtered'));
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [selectedTrip, refetch]);

  return (
    <View style={styles.container}>
      <PremiumBackground />
      <View style={styles.content}>
        <ScreenHeader
          title={t('trips.title')}
          subtitle={t('trips.subtitle')}
          rightAction={(
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/plan');
              }}
              style={styles.createButton}
            >
              <Plus size={20} color={colors.gold} />
            </Pressable>
          )}
        />

        <View style={styles.filtersRow}>
          {FILTER_KEYS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFilter(f.key);
                }}
                style={[styles.filterPill, active ? styles.filterPillActive : null]}
              >
                <Text style={[styles.filterText, active ? styles.filterTextActive : null]}>
                  {t(f.i18nKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isLoading ? (
          <View style={styles.skeletonWrap}>
            <TripCardSkeleton />
            <TripCardSkeleton />
            <TripCardSkeleton />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Map}
            title={t('trips.empty.title')}
            description={filter === 'all'
              ? t('trips.empty.desc.all')
              : t('trips.empty.desc.filtered')}
            action={filter === 'all'
              ? {
                  label: t('trips.empty.cta'),
                  onPress: () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push('/plan');
                  },
                }
              : undefined}
          />
        ) : (
          <FlatList
            data={filtered}
            contentInsetAdjustmentBehavior="automatic"
            keyExtractor={(t) => t.id}
            contentContainerStyle={styles.listContent}
            refreshing={false}
            onRefresh={refetch}
            renderItem={({ item }) => (
              <TripCard
                trip={item}
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push(`/trip/${item.id}`);
                }}
              />
            )}
          />
        )}

        <BottomSheet isOpen={!!selectedTrip} onClose={() => setSelectedTrip(null)} height={0.3}>
          <View style={styles.sheetContent}>
            <Text style={styles.sheetTitle}>{selectedTrip?.title || selectedTrip?.destination}</Text>
            <Button
              variant="outline"
              onPress={() => {
                if (selectedTrip) {
                  Haptics.selectionAsync();
                  router.push(`/trip/${selectedTrip.id}`);
                }
                setSelectedTrip(null);
              }}
            >
              {t('trips.card.action')}
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              isLoading={deleting}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                handleDelete();
              }}
            >
              {t('common.delete')}
            </Button>
          </View>
        </BottomSheet>
      </View>
    </View>
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
  createButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 14,
  },
  filterPill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterPillActive: {
    backgroundColor: colors.goldBg,
    borderColor: colors.goldBorder,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  filterTextActive: {
    color: colors.gold,
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
    gap: 12,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: fonts.display,
    marginBottom: 4,
  },
});
