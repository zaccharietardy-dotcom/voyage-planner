import { useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Alert } from 'react-native';
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

type Filter = 'all' | 'upcoming' | 'active' | 'past';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'upcoming', label: 'À venir' },
  { key: 'active', label: 'En cours' },
  { key: 'past', label: 'Passés' },
];

function getStatus(trip: TripListItem): 'upcoming' | 'active' | 'past' {
  const now = new Date();
  const start = new Date(trip.start_date);
  const end = new Date(trip.end_date);
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'active';
  return 'past';
}

export default function TripsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedTrip, setSelectedTrip] = useState<TripListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: trips, isLoading, refetch } = useApi(
    () => (user ? fetchMyTrips() : Promise.resolve([])),
    [user?.id ?? null],
  );

  useRefreshOnFocus(refetch);

  const filtered = (trips ?? []).filter((t) => filter === 'all' || getStatus(t) === filter);

  const handleDelete = useCallback(async () => {
    if (!selectedTrip) return;
    Alert.alert(
      'Supprimer ce voyage ?',
      `"${selectedTrip.title || selectedTrip.destination}" sera supprimé définitivement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteTrip(selectedTrip.id);
              setSelectedTrip(null);
              refetch();
            } catch {
              Alert.alert('Erreur', 'Impossible de supprimer ce voyage');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [selectedTrip, refetch]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title="Mes Voyages"
          rightAction={
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/plan'); }}
              style={{
                width: 40, height: 40, borderRadius: 12, borderCurve: 'continuous',
                backgroundColor: 'rgba(197,160,89,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Plus size={20} color="#c5a059" />
            </Pressable>
          }
        />

        {/* Filters */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 16 }}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => { Haptics.selectionAsync(); setFilter(f.key); }}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderCurve: 'continuous',
                backgroundColor: filter === f.key ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: filter === f.key ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.08)',
              }}
            >
              <Text style={{
                color: filter === f.key ? colors.gold : colors.textSecondary,
                fontSize: 13, fontWeight: '700', fontFamily: fonts.sansSemiBold,
              }}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* List */}
        {isLoading ? (
          <View style={{ padding: 20 }}>
            <TripCardSkeleton />
            <TripCardSkeleton />
            <TripCardSkeleton />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Map}
            title="Aucun voyage"
            description={filter === 'all'
              ? 'Planifiez votre premier voyage en appuyant sur le bouton +'
              : 'Aucun voyage dans cette catégorie'}
            action={filter === 'all' ? { label: 'Créer un voyage', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(tabs)/plan'); } } : undefined}
          />
        ) : (
          <FlatList
            data={filtered}
            contentInsetAdjustmentBehavior="automatic"
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
            refreshing={false}
            onRefresh={refetch}
            renderItem={({ item }) => (
              <TripCard
                trip={item}
                onPress={() => { Haptics.selectionAsync(); router.push(`/trip/${item.id}`); }}
              />
            )}
          />
        )}

        {/* Actions bottom sheet */}
        <BottomSheet
          isOpen={!!selectedTrip}
          onClose={() => setSelectedTrip(null)}
          height={0.3}
        >
          <View style={{ padding: 20, gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontFamily: fonts.sansBold, marginBottom: 4 }}>
              {selectedTrip?.title || selectedTrip?.destination}
            </Text>
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
              Voir le voyage
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              isLoading={deleting}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); handleDelete(); }}
            >
              Supprimer
            </Button>
          </View>
        </BottomSheet>
      </View>
    </View>
  );
}
