import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, SectionList, ScrollView, Pressable, useWindowDimensions, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin, Info, PieChart, Ticket, Map as MapIcon, MessageCircle, Calendar, Users, Wallet, CalendarPlus, CreditCard,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { usePresence } from '@/hooks/usePresence';
import { useProposals } from '@/hooks/useProposals';
import { fetchTrip } from '@/lib/api/trips';
import { supabase } from '@/lib/supabase/client';
import { cacheTripLocally } from '@/lib/offline/tripCache';
import type { TripDay, TripItem, Trip } from '@/lib/types/trip';
import { BUDGET_LABELS } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';
import { TripHero } from '@/components/trip/TripHero';
import { DayHeader } from '@/components/trip/DayHeader';
import { ActivityItem } from '@/components/trip/ActivityItem';
import { ActivityActions, MoveToDaySheet } from '@/components/trip/ActivityActions';
import { ActivityDetail } from '@/components/trip/ActivityDetail';
import { ActivityEditSheet } from '@/components/trip/ActivityEditSheet';
import { AddActivitySheet } from '@/components/trip/AddActivitySheet';
import { updateTripData } from '@/lib/api/trips';
import { TripMap } from '@/components/trip/TripMap';
import { HotelSelector } from '@/components/trip/HotelSelector';
import { TransportSelector } from '@/components/trip/TransportSelector';
import { BookingChecklist } from '@/components/trip/BookingChecklist';
import { ChatPanel } from '@/components/trip/ChatPanel';
import { SharePanel } from '@/components/trip/SharePanel';
import { CalendarExport } from '@/components/trip/CalendarExport';
import { ExpensesPanel } from '@/components/trip/ExpensesPanel';
import { CommentsSection } from '@/components/trip/CommentsSection';
import { ProposalsList } from '@/components/trip/ProposalsList';
import { PackingList } from '@/components/trip/PackingList';
import { ImportBooking } from '@/components/trip/ImportBooking';
import { ImportPlaces } from '@/components/trip/ImportPlaces';
import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { TripSheet } from '@/components/trip/TripSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { useTranslation } from '@/lib/i18n';

const FALLBACK_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800&q=80',
  lisbon: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=800&q=80',
  marrakech: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=800&q=80',
  istanbul: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=800&q=80',
};
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&q=80';

function getImage(dest: string): string {
  const lower = dest.toLowerCase();
  for (const [key, url] of Object.entries(FALLBACK_IMAGES)) {
    if (lower.includes(key)) return url;
  }
  return DEFAULT_IMAGE;
}

type Tab = 'itinerary' | 'booking' | 'budget' | 'expenses' | 'info';

const TAB_KEYS: { key: Tab; labelKey: string; icon: typeof MapPin }[] = [
  { key: 'itinerary', labelKey: 'trip.tabs.itinerary', icon: MapPin },
  { key: 'expenses', labelKey: 'trip.tabs.expenses', icon: CreditCard },
  { key: 'booking', labelKey: 'trip.tabs.booking', icon: Ticket },
  { key: 'budget', labelKey: 'trip.tabs.budget', icon: PieChart },
  { key: 'info', labelKey: 'trip.tabs.info', icon: Info },
];

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<Tab>('itinerary');
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [modalItem, setModalItem] = useState<TripItem | null>(null);
  const [openModal, setOpenModal] = useState<null | 'detail' | 'actions' | 'chat' | 'share' | 'calendar' | 'edit' | 'add' | 'move'>(null);
  const [bookedItems, setBookedItems] = useState<Record<string, { booked: boolean }>>({});
  const [localTrip, setLocalTrip] = useState<Trip | null>(null);
  const [addTargetDay, setAddTargetDay] = useState(1);
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('private');

  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { data: row, isLoading, error } = useApi(() => fetchTrip(id!), [id]);

  // Presence & collaboration
  const presenceUser = useMemo(() => user && profile ? { id: user.id, displayName: profile.display_name, avatarUrl: profile.avatar_url } : null, [user, profile]);
  const { onlineUsers } = usePresence(id, presenceUser);
  const { proposals, pendingCount, vote: voteProposal, decide: decideProposal } = useProposals(id);

  const serverTrip: Trip | null = row?.data ?? null;
  const trip = localTrip ?? serverTrip;

  useEffect(() => {
    if (serverTrip && !localTrip) setLocalTrip(serverTrip);
  }, [serverTrip]);

  useEffect(() => {
    if (trip?.bookedItems) setBookedItems(trip.bookedItems);
  }, [trip?.bookedItems]);

  useEffect(() => {
    if (row?.visibility) {
      setVisibility(row.visibility);
    }
  }, [row?.visibility]);

  useEffect(() => {
    if (row) cacheTripLocally(row).catch(() => {});
  }, [row]);

  const sections = useMemo(() => {
    if (!trip?.days) return [];
    const days = activeDay !== null ? trip.days.filter((d: TripDay) => d.dayNumber === activeDay) : trip.days;
    return days.map((day: TripDay) => ({ day, data: day.items }));
  }, [trip, activeDay]);

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenModal('share');
  };

  const handleBookingToggle = useCallback(async (itemId: string) => {
    if (!trip) return;
    Haptics.selectionAsync();
    const oldBooked = bookedItems[itemId]?.booked ?? false;
    const newBooked = !oldBooked;

    // Optimistic update
    setBookedItems((prev) => ({ ...prev, [itemId]: { booked: newBooked } }));

    try {
      await supabase.from('trips').update({
        booked_items: { ...bookedItems, [itemId]: { booked: newBooked } },
      }).eq('id', id);
    } catch {
      // Rollback on failure
      setBookedItems((prev) => ({ ...prev, [itemId]: { booked: oldBooked } }));
    }
  }, [bookedItems, trip, id]);

  const handleVisibilityChange = useCallback(async (nextVisibility: 'public' | 'friends' | 'private') => {
    Haptics.selectionAsync();
    setVisibility(nextVisibility);

    try {
      await supabase.from('trips').update({ visibility: nextVisibility }).eq('id', id);
    } catch {
      setVisibility(row?.visibility ?? 'private');
    }
  }, [id, row?.visibility]);

  // ─── Editing handlers ───
  const saveTripUpdate = useCallback(async (updated: Trip) => {
    setLocalTrip(updated);
    try {
      await updateTripData(id!, updated);
    } catch {
      // Silently fail — local state is already updated
    }
  }, [id]);

  const handleEditItem = useCallback((updatedItem: TripItem) => {
    if (!trip) return;
    const updatedDays = trip.days.map((day: TripDay) => ({
      ...day,
      items: day.items.map((i: TripItem) => i.id === updatedItem.id ? updatedItem : i),
    }));
    saveTripUpdate({ ...trip, days: updatedDays });
  }, [trip, saveTripUpdate]);

  const handleDeleteItem = useCallback((itemId: string) => {
    if (!trip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const updatedDays = trip.days.map((day: TripDay) => ({
      ...day,
      items: day.items.filter((i: TripItem) => i.id !== itemId),
    }));
    saveTripUpdate({ ...trip, days: updatedDays });
  }, [trip, saveTripUpdate]);

  const handleAddItem = useCallback((newItem: Omit<TripItem, 'id' | 'orderIndex'>, dayNumber: number) => {
    if (!trip) return;
    const itemWithId: TripItem = {
      ...newItem,
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderIndex: 999,
    } as TripItem;
    const updatedDays = trip.days.map((day: TripDay) => {
      if (day.dayNumber !== dayNumber) return day;
      return { ...day, items: [...day.items, itemWithId] };
    });
    saveTripUpdate({ ...trip, days: updatedDays });
  }, [trip, saveTripUpdate]);

  const handleSwapRestaurant = useCallback((item: TripItem, alternative: any) => {
    if (!trip) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updatedDays = trip.days.map((day: TripDay) => ({
      ...day,
      items: day.items.map((i: TripItem) => {
        if (i.id !== item.id) return i;
        return {
          ...i,
          title: alternative.name,
          restaurant: alternative,
          locationName: alternative.address || i.locationName,
          latitude: alternative.latitude || i.latitude,
          longitude: alternative.longitude || i.longitude,
          rating: alternative.rating,
          imageUrl: alternative.photos?.[0] || i.imageUrl,
          googleMapsPlaceUrl: alternative.googleMapsUrl || i.googleMapsPlaceUrl,
          restaurantAlternatives: item.restaurantAlternatives?.filter((a: any) => a.id !== alternative.id),
        };
      }),
    }));
    saveTripUpdate({ ...trip, days: updatedDays });
  }, [trip, saveTripUpdate]);

  const handleMoveToDay = useCallback((item: TripItem, targetDayNumber: number) => {
    if (!trip || item.dayNumber === targetDayNumber) return;
    const updatedDays = trip.days.map((day: TripDay) => {
      if (day.dayNumber === item.dayNumber) {
        return { ...day, items: day.items.filter((i: TripItem) => i.id !== item.id) };
      }
      if (day.dayNumber === targetDayNumber) {
        return { ...day, items: [...day.items, { ...item, dayNumber: targetDayNumber }] };
      }
      return day;
    });
    saveTripUpdate({ ...trip, days: updatedDays });
  }, [trip, saveTripUpdate]);

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <PremiumBackground />
        <Skeleton height={300} radius={0} />
        <View style={styles.loadingContent}>
          <Skeleton width={200} height={24} />
          <Skeleton width={280} height={16} />
          <Skeleton height={100} />
        </View>
      </View>
    );
  }

  if (error || !row) {
    return (
      <View style={styles.errorScreen}>
        <PremiumBackground />
        <Text style={styles.errorTitle}>Voyage introuvable</Text>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.canGoBack() ? router.back() : router.replace('/(tabs)');
          }}
        >
          <Text style={styles.errorLink}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const dateRange = row.start_date && row.end_date
    ? `${new Date(row.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${new Date(row.end_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    : `${row.duration_days} jours`;

  const prefs = trip?.preferences ?? row.preferences;
  const floatingBottom = Math.max(insets.bottom + 18, 28);

  // Day selector pills — shared with map
  const dayPills = trip?.days ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 8 }}>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); setActiveDay(null); }}
        style={{
          paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12,
          backgroundColor: activeDay === null ? colors.gold : 'rgba(15,23,42,0.9)',
          borderWidth: 1, borderColor: activeDay === null ? colors.gold : 'rgba(255,255,255,0.1)',
        }}
      >
        <Text style={{ color: activeDay === null ? colors.bg : colors.text, fontSize: 12, fontFamily: fonts.sansBold }}>Tous</Text>
      </Pressable>
      {trip.days.map((day) => {
        const isActive = activeDay === day.dayNumber;
        return (
          <Pressable
            key={day.dayNumber}
            onPress={() => { Haptics.selectionAsync(); setActiveDay(isActive ? null : day.dayNumber); }}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12,
              backgroundColor: isActive ? colors.gold : 'rgba(15,23,42,0.9)',
              borderWidth: 1, borderColor: isActive ? colors.gold : 'rgba(255,255,255,0.1)',
            }}
          >
            <Text style={{ color: isActive ? colors.bg : colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold }}>J{day.dayNumber}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  ) : null;

  return (
    <View style={styles.screen}>
      {/* Map ALWAYS visible as background */}
      {trip ? (
        <View style={StyleSheet.absoluteFillObject}>
          <TripMap days={trip.days || []} activeDay={activeDay} onDayChange={setActiveDay} onMarkerPress={(item) => { setModalItem(item); setOpenModal('detail'); }} />
        </View>
      ) : <PremiumBackground />}

      {/* Back + Share buttons over map */}
      <View style={[styles.mapOverlayButtons, { top: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}
          style={styles.mapButton}
        >
          <Text style={{ color: colors.text, fontSize: 20 }}>←</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {/* Presence avatars */}
          {onlineUsers.slice(0, 3).map((u, i) => (
            <View key={u.userId} style={{ marginLeft: i > 0 ? -8 : 0, borderWidth: 2, borderColor: colors.bg, borderRadius: 14 }}>
              <Avatar url={u.avatarUrl} name={u.displayName} size="sm" />
            </View>
          ))}
          {onlineUsers.length > 3 ? (
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(197,160,89,0.3)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.gold, fontSize: 10, fontFamily: fonts.sansBold }}>+{onlineUsers.length - 3}</Text>
            </View>
          ) : null}
          {pendingCount > 0 ? (
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#a78bfa', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 10, fontFamily: fonts.sansBold }}>{pendingCount}</Text>
            </View>
          ) : null}
          <Pressable onPress={handleShare} style={styles.mapButton}>
            <Text style={{ color: colors.text, fontSize: 16 }}>↗</Text>
          </Pressable>
        </View>
      </View>

      {/* Bottom Sheet with tabs + content */}
      <TripSheet>
        {/* Tabs inside sheet */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
          {TAB_KEYS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab(tab.key);
              }}
              style={[styles.tabButton, activeTab === tab.key ? styles.tabButtonActive : null]}
            >
              <tab.icon size={15} color={activeTab === tab.key ? '#000' : colors.textMuted} />
              <Text style={[styles.tabButtonLabel, activeTab === tab.key ? styles.tabButtonLabelActive : null]}>
                {t(tab.labelKey as any)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Tab content */}
        {activeTab === 'itinerary' && trip ? (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            ListHeaderComponent={dayPills}
            renderSectionHeader={({ section }) => (
              <DayHeader
                dayNumber={section.day.dayNumber}
                date={section.day.date}
                theme={section.day.theme}
                onAdd={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setAddTargetDay(section.day.dayNumber);
                  setOpenModal('add');
                }}
              />
            )}
            renderItem={({ item, index, section }) => (
              <ActivityItem
                item={item}
                isFirst={index === 0}
                isLast={index === section.data.length - 1}
                onSwapRestaurant={handleSwapRestaurant}
                onPress={() => {
                  Haptics.selectionAsync();
                  setModalItem(item);
                  setOpenModal('detail');
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setModalItem(item);
                  setOpenModal('actions');
                }}
              />
            )}
            contentContainerStyle={styles.sectionListContent}
          />
        ) : activeTab === 'expenses' ? (
          <Animated.View key="expenses" entering={FadeIn.duration(200)} style={{ flex: 1 }}>
            <ExpensesPanel tripId={id!} />
          </Animated.View>
        ) : activeTab === 'booking' && trip ? (
          <ScrollView contentContainerStyle={styles.scrollTabContent}>
            <BookingChecklist trip={trip} bookedItems={bookedItems} onToggle={handleBookingToggle} />
            <View style={{ marginTop: 16, gap: 16 }}>
              <ImportBooking
                onImport={(booking) => {
                  // Add parsed booking to trip
                  setOpenModal(null);
                }}
                onClose={() => {}}
              />
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollTabContent}>
            {activeTab === 'budget' && trip ? <BudgetTab trip={trip} /> : null}
            {activeTab === 'info' && trip ? (
              <View style={{ gap: 20 }}>
                <InfoTab trip={trip} />

                {/* Proposals */}
                {proposals.length > 0 ? (
                  <View style={{ paddingHorizontal: 4 }}>
                    <ProposalsList
                      proposals={proposals}
                      isOwner={row?.owner_id === user?.id}
                      onVote={voteProposal}
                      onDecide={decideProposal}
                    />
                  </View>
                ) : null}

                {/* Packing List */}
                <View style={{ paddingHorizontal: 4 }}>
                  <PackingList
                    tripId={id!}
                    packingItems={trip.travelTips?.packing?.essentials?.map((e) => e.item)}
                  />
                </View>

                {/* Comments */}
                <View style={{ paddingHorizontal: 4 }}>
                  <CommentsSection tripId={id!} />
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </TripSheet>

      <View style={[styles.floatingActions, { bottom: floatingBottom }]}>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setOpenModal('calendar');
          }}
          style={styles.secondaryFab}
        >
          <CalendarPlus size={20} color={colors.gold} />
        </Pressable>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setOpenModal('chat');
          }}
          style={styles.primaryFab}
        >
          <MessageCircle size={24} color={colors.bg} />
        </Pressable>
      </View>

      <BottomSheet isOpen={openModal === 'detail'} onClose={() => setOpenModal(null)} height={0.7}>
        {modalItem ? <ActivityDetail item={modalItem} /> : null}
      </BottomSheet>

      <ChatPanel isOpen={openModal === 'chat'} onClose={() => setOpenModal(null)} tripId={id!} />

      <ActivityActions
        item={modalItem}
        isOpen={openModal === 'actions'}
        onClose={() => setOpenModal(null)}
        onEdit={(item) => { setModalItem(item); setOpenModal('edit'); }}
        onDelete={handleDeleteItem}
        onMove={(item) => { setModalItem(item); setOpenModal('move'); }}
      />

      <ActivityEditSheet
        item={modalItem}
        isOpen={openModal === 'edit'}
        onClose={() => setOpenModal(null)}
        onSave={handleEditItem}
        onDelete={handleDeleteItem}
      />

      {trip ? (
        <AddActivitySheet
          isOpen={openModal === 'add'}
          onClose={() => setOpenModal(null)}
          onAdd={handleAddItem}
          trip={trip}
          targetDay={addTargetDay}
        />
      ) : null}

      <MoveToDaySheet
        item={modalItem}
        isOpen={openModal === 'move'}
        onClose={() => setOpenModal(null)}
        onMoveToDay={handleMoveToDay}
        availableDays={trip?.days?.map((d: TripDay) => d.dayNumber) ?? []}
      />

      {trip ? <CalendarExport isOpen={openModal === 'calendar'} onClose={() => setOpenModal(null)} trip={trip} /> : null}

      <SharePanel
        isOpen={openModal === 'share'}
        onClose={() => setOpenModal(null)}
        tripId={id!}
        destination={row.destination}
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
      />
    </View>
  );
}

function BudgetTab({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const breakdown = trip.costBreakdown;
  if (!breakdown) {
    return (
      <View style={styles.budgetEmpty}>
        <Text style={styles.emptyText}>Pas de données budget.</Text>
      </View>
    );
  }

  const items = [
    { label: 'Vols', value: breakdown.flights, color: colors.chartFlights },
    { label: 'Hébergement', value: breakdown.accommodation, color: colors.chartAccommodation },
    { label: 'Restaurants', value: breakdown.food, color: colors.chartFood },
    { label: 'Activités', value: breakdown.activities, color: colors.chartActivities },
    { label: 'Transport', value: breakdown.transport, color: colors.chartTransport },
  ].filter((i) => i.value > 0);

  const total = trip.totalEstimatedCost || items.reduce((s, i) => s + i.value, 0);
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <View style={styles.budgetContent}>
      <View style={styles.budgetHero}>
        <Text style={styles.budgetLabel}>Coût estimé total</Text>
        <Text style={styles.budgetTotal}>{Math.round(total)}€</Text>
        {trip.preferences?.groupSize && trip.preferences.groupSize > 1 ? (
          <Text style={styles.budgetPerPerson}>~{Math.round(total / trip.preferences.groupSize)}€ / personne</Text>
        ) : null}
      </View>

      <View style={styles.breakdownWrap}>
        {items.map((item) => (
          <View key={item.label} style={styles.breakdownItem}>
            <View style={styles.breakdownHeader}>
              <View style={styles.breakdownLabelRow}>
                <View style={[styles.breakdownDot, { backgroundColor: item.color }]} />
                <Text style={styles.breakdownLabel}>{item.label}</Text>
              </View>
              <Text style={styles.breakdownValue}>{Math.round(item.value)}€</Text>
            </View>
            <View style={styles.breakdownTrack}>
              <View style={[styles.breakdownFill, { backgroundColor: item.color, width: `${(item.value / maxValue) * 100}%` }]} />
            </View>
          </View>
        ))}
      </View>

      {trip.carbonFootprint ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoCardTitle}>Empreinte carbone</Text>
          <View style={styles.carbonRow}>
            <Text style={styles.carbonValue}>{Math.round(trip.carbonFootprint.total)}</Text>
            <Text style={styles.carbonUnit}>kg CO₂</Text>
            <View style={styles.carbonBadge}>
              <Text style={styles.carbonBadgeText}>{trip.carbonFootprint.rating}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {trip.days?.some((d) => d.dailyBudget) ? (
        <View style={styles.dailyBudgetWrap}>
          <Text style={styles.sectionTitle}>Par jour</Text>
          {trip.days.map((day) => day.dailyBudget ? (
            <View key={day.dayNumber} style={styles.dailyBudgetRow}>
              <Text style={styles.dailyBudgetLabel}>{t('trip.day', { n: day.dayNumber })}</Text>
              <Text style={styles.dailyBudgetValue}>{Math.round(day.dailyBudget.total)}€</Text>
            </View>
          ) : null)}
        </View>
      ) : null}
    </View>
  );
}

function InfoTab({ trip }: { trip: Trip }) {
  const tips = trip.travelTips;

  return (
    <View style={styles.infoContent}>
      {tips?.vocabulary ? (
        <InfoSection title={`Vocabulaire ${tips.vocabulary.language}`}>
          {tips.vocabulary.phrases.slice(0, 10).map((p, i) => (
            <View key={i} style={styles.vocabularyRow}>
              <Text style={styles.vocabularyOriginal}>{p.original}</Text>
              <Text style={styles.vocabularyTranslation}>{p.translation}</Text>
            </View>
          ))}
        </InfoSection>
      ) : null}

      {tips?.emergency ? (
        <InfoSection title="Numéros d'urgence">
          <InfoRow label="Police" value={tips.emergency.police} />
          <InfoRow label="Ambulance" value={tips.emergency.ambulance} />
          <InfoRow label="Pompiers" value={tips.emergency.fire} />
          <InfoRow label="Urgences" value={tips.emergency.generalEmergency} />
        </InfoSection>
      ) : null}

      {tips?.packing ? (
        <InfoSection title="À emporter">
          {tips.packing.essentials.slice(0, 10).map((e, i) => (
            <View key={i} style={styles.packingItem}>
              <Text style={styles.packingTitle}>• {e.item}</Text>
              <Text style={styles.packingReason}>{e.reason}</Text>
            </View>
          ))}
          {tips.packing.plugType ? <InfoRow label="Prise électrique" value={tips.packing.plugType} /> : null}
        </InfoSection>
      ) : null}

      {tips?.legal ? (
        <InfoSection title="Informations légales">
          {tips.legal.importantLaws?.slice(0, 5).map((law, i) => (
            <Text key={i} style={styles.legalText}>• {law}</Text>
          ))}
        </InfoSection>
      ) : null}

      {!tips ? <Text style={styles.emptyText}>Aucune info disponible.</Text> : null}
    </View>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoCardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  loadingContent: {
    padding: 20,
    gap: 16,
  },
  errorScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 16,
    fontFamily: fonts.sansSemiBold,
    marginBottom: 12,
  },
  errorLink: {
    color: colors.gold,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  statsPillsContent: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 8,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statPillText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
  },
  selectorWrap: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  hotelWrap: {
    marginBottom: 8,
  },
  tabsContent: {
    paddingHorizontal: 4,
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    padding: 3,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  tabButtonActive: {
    backgroundColor: colors.gold,
  },
  tabButtonLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  tabButtonLabelActive: {
    color: '#000',
  },
  sectionListContent: {
    paddingBottom: 126,
  },
  scrollTabContent: {
    paddingBottom: 126,
  },
  mapPanel: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 120,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  mapOverlayButtons: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  mapButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(2,6,23,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  floatingActions: {
    position: 'absolute',
    right: 20,
    gap: 12,
    alignItems: 'center',
    zIndex: 20,
  },
  secondaryFab: {
    width: 50,
    height: 50,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  primaryFab: {
    width: 58,
    height: 58,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 10,
  },
  budgetEmpty: {
    padding: 20,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  budgetContent: {
    padding: 20,
    gap: 24,
  },
  budgetHero: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(10,17,40,0.9)',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  budgetLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  budgetTotal: {
    color: colors.gold,
    fontSize: 44,
    fontFamily: fonts.display,
    marginTop: 8,
  },
  budgetPerPerson: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    marginTop: 4,
  },
  breakdownWrap: {
    gap: 14,
  },
  breakdownItem: {
    gap: 8,
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  breakdownLabel: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  breakdownValue: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
  breakdownTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: 6,
    borderRadius: radius.full,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 18,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 8,
  },
  infoCardTitle: {
    color: colors.text,
    fontSize: 17,
    fontFamily: fonts.display,
    marginBottom: 4,
  },
  carbonRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  carbonValue: {
    color: colors.gold,
    fontSize: 30,
    fontFamily: fonts.display,
  },
  carbonUnit: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  carbonBadge: {
    marginLeft: 8,
    backgroundColor: colors.goldBg,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  carbonBadgeText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  dailyBudgetWrap: {
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  dailyBudgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dailyBudgetLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  dailyBudgetValue: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  infoContent: {
    padding: 20,
    gap: 20,
  },
  vocabularyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: 12,
  },
  vocabularyOriginal: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sans,
    flex: 1,
  },
  vocabularyTranslation: {
    color: colors.gold,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    flex: 1,
    textAlign: 'right',
  },
  packingItem: {
    paddingVertical: 6,
  },
  packingTitle: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  packingReason: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
    marginLeft: 12,
    marginTop: 2,
  },
  legalText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sans,
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  infoRowLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  infoRowValue: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    textAlign: 'right',
  },
});
