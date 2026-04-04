import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, SectionList, ScrollView, Pressable, useWindowDimensions, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin, Info, PieChart, Ticket, Map as MapIcon, MessageCircle, Calendar, Users, Wallet, CalendarPlus,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { fetchTrip } from '@/lib/api/trips';
import { supabase } from '@/lib/supabase/client';
import { cacheTripLocally } from '@/lib/offline/tripCache';
import type { TripDay, TripItem, Trip } from '@/lib/types/trip';
import { BUDGET_LABELS } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';
import { TripHero } from '@/components/trip/TripHero';
import { DayHeader } from '@/components/trip/DayHeader';
import { ActivityItem } from '@/components/trip/ActivityItem';
import { ActivityActions } from '@/components/trip/ActivityActions';
import { ActivityDetail } from '@/components/trip/ActivityDetail';
import { TripMap } from '@/components/trip/TripMap';
import { HotelSelector } from '@/components/trip/HotelSelector';
import { TransportSelector } from '@/components/trip/TransportSelector';
import { BookingChecklist } from '@/components/trip/BookingChecklist';
import { ChatPanel } from '@/components/trip/ChatPanel';
import { SharePanel } from '@/components/trip/SharePanel';
import { CalendarExport } from '@/components/trip/CalendarExport';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

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

type Tab = 'itinerary' | 'map' | 'booking' | 'budget' | 'info';

const TABS: { key: Tab; label: string; icon: typeof MapPin }[] = [
  { key: 'itinerary', label: 'Itinéraire', icon: MapPin },
  { key: 'map', label: 'Carte', icon: MapIcon },
  { key: 'booking', label: 'Réserver', icon: Ticket },
  { key: 'budget', label: 'Budget', icon: PieChart },
  { key: 'info', label: 'Infos', icon: Info },
];

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<Tab>('itinerary');
  const [modalItem, setModalItem] = useState<TripItem | null>(null);
  const [openModal, setOpenModal] = useState<null | 'detail' | 'actions' | 'chat' | 'share' | 'calendar'>(null);
  const [bookedItems, setBookedItems] = useState<Record<string, { booked: boolean }>>({});
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('private');

  const { data: row, isLoading, error } = useApi(() => fetchTrip(id!), [id]);

  const trip: Trip | null = row?.data ?? null;

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
    return trip.days.map((day: TripDay) => ({ day, data: day.items }));
  }, [trip]);

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpenModal('share');
  };

  const handleBookingToggle = useCallback(async (itemId: string) => {
    Haptics.selectionAsync();
    setBookedItems((prev) => {
      const current = prev[itemId]?.booked ?? false;
      return { ...prev, [itemId]: { booked: !current } };
    });

    try {
      const updated = { ...bookedItems, [itemId]: { booked: !(bookedItems[itemId]?.booked ?? false) } };
      await supabase.from('trips').update({
        data: { ...trip, bookedItems: updated },
      }).eq('id', id);
    } catch {}
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
            router.back();
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

  const headerContent = (
    <>
      <TripHero
        imageUrl={getImage(row.destination)}
        title={row.title || row.destination}
        destination={row.destination}
        dateRange={dateRange}
        onBack={() => router.back()}
        onShare={handleShare}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsPillsContent}>
        {[
          { icon: Calendar, label: `${row.duration_days} jours` },
          ...(prefs?.groupSize ? [{ icon: Users, label: `${prefs.groupSize} pers.` }] : []),
          ...(prefs?.budgetLevel ? [{ icon: Wallet, label: BUDGET_LABELS[prefs.budgetLevel as keyof typeof BUDGET_LABELS]?.label ?? '' }] : []),
        ].map((p, i) => (
          <View key={i} style={styles.statPill}>
            <p.icon size={14} color={colors.textSecondary} />
            <Text style={styles.statPillText}>{p.label}</Text>
          </View>
        ))}
      </ScrollView>

      {activeTab === 'itinerary' && trip?.transportOptions && trip.transportOptions.length > 0 ? (
        <View style={styles.selectorWrap}>
          <TransportSelector options={trip.transportOptions} selectedId={trip.selectedTransport?.id} />
        </View>
      ) : null}

      {activeTab === 'itinerary' && trip?.accommodationOptions && trip.accommodationOptions.length > 0 ? (
        <View style={styles.hotelWrap}>
          <HotelSelector options={trip.accommodationOptions} selectedId={trip.accommodation?.id} />
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(t.key);
            }}
            style={[styles.tabButton, activeTab === t.key ? styles.tabButtonActive : null]}
          >
            <t.icon size={15} color={activeTab === t.key ? colors.gold : colors.textMuted} />
            <Text style={[styles.tabButtonLabel, activeTab === t.key ? styles.tabButtonLabelActive : null]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  return (
    <View style={styles.screen}>
      <PremiumBackground />

      {activeTab === 'itinerary' && trip ? (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={headerContent}
          renderSectionHeader={({ section }) => (
            <DayHeader
              dayNumber={section.day.dayNumber}
              date={section.day.date}
              theme={section.day.theme}
              isDayTrip={section.day.isDayTrip}
            />
          )}
          renderItem={({ item, index, section }) => (
            <ActivityItem
              item={item}
              isFirst={index === 0}
              isLast={index === section.data.length - 1}
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
      ) : activeTab === 'map' && trip ? (
        <View style={styles.flex}>
          {headerContent}
          <View style={[styles.mapPanel, { minHeight: screenH * 0.52 }]}>
            <TripMap days={trip.days || []} onMarkerPress={(item) => { setModalItem(item); setOpenModal('detail'); }} />
          </View>
        </View>
      ) : activeTab === 'booking' && trip ? (
        <ScrollView contentContainerStyle={styles.scrollTabContent}>
          {headerContent}
          <BookingChecklist trip={trip} bookedItems={bookedItems} onToggle={handleBookingToggle} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollTabContent}>
          {headerContent}
          {activeTab === 'budget' && trip ? <BudgetTab trip={trip} /> : null}
          {activeTab === 'info' && trip ? <InfoTab trip={trip} /> : null}
        </ScrollView>
      )}

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

      <ActivityActions item={modalItem} isOpen={openModal === 'actions'} onClose={() => setOpenModal(null)} />

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
              <Text style={styles.dailyBudgetLabel}>Jour {day.dayNumber}</Text>
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
    paddingHorizontal: 16,
    gap: 6,
    paddingVertical: 8,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tabButtonActive: {
    backgroundColor: colors.goldBg,
    borderColor: colors.goldBorder,
  },
  tabButtonLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  tabButtonLabelActive: {
    color: colors.gold,
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
  floatingActions: {
    position: 'absolute',
    right: 20,
    gap: 12,
    alignItems: 'center',
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
