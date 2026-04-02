import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, SectionList, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  MapPin, Info, PieChart, Ticket, Map as MapIcon, MessageCircle, Calendar, Users, Wallet, CalendarPlus,
} from 'lucide-react-native';
import { useApi } from '@/hooks/useApi';
import { fetchTrip } from '@/lib/api/trips';
import { supabase } from '@/lib/supabase/client';
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
import { cacheTripLocally } from '@/lib/offline/tripCache';
import * as Haptics from 'expo-haptics';
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
  const { height: screenH } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<Tab>('itinerary');
  const [modalItem, setModalItem] = useState<TripItem | null>(null);
  const [openModal, setOpenModal] = useState<null | 'detail' | 'actions' | 'chat' | 'share' | 'calendar'>(null);
  const [bookedItems, setBookedItems] = useState<Record<string, { booked: boolean }>>({});

  const { data: row, isLoading, error } = useApi(() => fetchTrip(id!), [id]);

  const trip: Trip | null = row?.data ?? null;

  // Initialize booked items from trip data
  useEffect(() => {
    if (trip?.bookedItems) setBookedItems(trip.bookedItems);
  }, [trip?.bookedItems]);

  // Auto-cache trip for offline access
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
    // Persist to Supabase
    try {
      const updated = { ...bookedItems, [itemId]: { booked: !(bookedItems[itemId]?.booked ?? false) } };
      await supabase.from('trips').update({
        data: { ...trip, bookedItems: updated },
      }).eq('id', id);
    } catch { /* silent */ }
  }, [bookedItems, trip, id]);

  // Loading
  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <Skeleton height={280} radius={0} />
        <View style={{ padding: 20, gap: 16 }}>
          <Skeleton width={200} height={24} />
          <Skeleton width={280} height={16} />
          <Skeleton height={100} />
        </View>
      </View>
    );
  }

  // Error
  if (error || !row) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumBackground />
        <Text style={{ color: colors.danger, fontSize: 16, marginBottom: 12 }}>Voyage introuvable</Text>
        <Pressable onPress={() => { Haptics.selectionAsync(); router.back(); }}>
          <Text style={{ color: colors.gold, fontSize: 14 }}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const dateRange = row.start_date && row.end_date
    ? `${new Date(row.start_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${new Date(row.end_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    : `${row.duration_days} jours`;

  const prefs = trip?.preferences ?? row.preferences;

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

      {/* Stats pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 14, gap: 8 }}>
        {[
          { icon: Calendar, label: `${row.duration_days} jours` },
          ...(prefs?.groupSize ? [{ icon: Users, label: `${prefs.groupSize} pers.` }] : []),
          ...(prefs?.budgetLevel ? [{ icon: Wallet, label: BUDGET_LABELS[prefs.budgetLevel as keyof typeof BUDGET_LABELS]?.label ?? '' }] : []),
        ].map((p, i) => (
          <View key={i} style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
            borderWidth: 1, borderColor: colors.borderSubtle,
          }}>
            <p.icon size={14} color={colors.textSecondary} />
            <Text style={{ color: '#e2e8f0', fontSize: 12, fontFamily: fonts.sansSemiBold }}>{p.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Transport selector */}
      {trip?.transportOptions && trip.transportOptions.length > 0 && (
        <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
          <TransportSelector
            options={trip.transportOptions}
            selectedId={trip.selectedTransport?.id}
          />
        </View>
      )}

      {/* Hotel selector */}
      {trip?.accommodationOptions && trip.accommodationOptions.length > 0 && (
        <HotelSelector
          options={trip.accommodationOptions}
          selectedId={trip.accommodation?.id}
        />
      )}

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 4, paddingVertical: 8 }}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(t.key); }}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md,
              backgroundColor: activeTab === t.key ? colors.goldBg : 'transparent',
            }}
          >
            <t.icon size={15} color={activeTab === t.key ? colors.gold : colors.textMuted} />
            <Text style={{
              color: activeTab === t.key ? colors.gold : colors.textMuted,
              fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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
              onPress={() => { Haptics.selectionAsync(); setModalItem(item); setOpenModal('detail'); }}
              onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setModalItem(item); setOpenModal('actions'); }}
            />
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      ) : activeTab === 'map' && trip ? (
        <View style={{ flex: 1 }}>
          {headerContent}
          <View style={{ flex: 1, minHeight: screenH * 0.5 }}>
            <TripMap days={trip.days || []} onMarkerPress={(item) => { setModalItem(item); setOpenModal('detail'); }} />
          </View>
        </View>
      ) : activeTab === 'booking' && trip ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          {headerContent}
          <BookingChecklist
            trip={trip}
            bookedItems={bookedItems}
            onToggle={handleBookingToggle}
          />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          {headerContent}
          {activeTab === 'budget' && trip && <BudgetTab trip={trip} />}
          {activeTab === 'info' && trip && <InfoTab trip={trip} />}
        </ScrollView>
      )}

      {/* FAB buttons */}
      <View style={{ position: 'absolute', bottom: 100, right: 20, gap: 12, alignItems: 'center' }}>
        {/* Calendar export */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setOpenModal('calendar'); }}
          style={{
            width: 48, height: 48, borderRadius: 16,
            backgroundColor: colors.surface,
            borderWidth: 1, borderColor: colors.borderSubtle,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2, shadowRadius: 6, elevation: 4,
          }}
        >
          <CalendarPlus size={20} color={colors.gold} />
        </Pressable>

        {/* Chat */}
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setOpenModal('chat'); }}
          style={{
            width: 56, height: 56, borderRadius: 18,
            backgroundColor: colors.gold,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: colors.gold, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.35, shadowRadius: 10, elevation: 8,
          }}
        >
          <MessageCircle size={24} color={colors.bg} />
        </Pressable>
      </View>

      {/* Activity detail */}
      <BottomSheet isOpen={openModal === 'detail'} onClose={() => setOpenModal(null)} height={0.7}>
        {modalItem && <ActivityDetail item={modalItem} />}
      </BottomSheet>

      {/* Chat panel */}
      <ChatPanel isOpen={openModal === 'chat'} onClose={() => setOpenModal(null)} tripId={id!} />

      {/* Activity actions */}
      <ActivityActions
        item={modalItem}
        isOpen={openModal === 'actions'}
        onClose={() => setOpenModal(null)}
      />

      {/* Calendar export */}
      {trip && <CalendarExport isOpen={openModal === 'calendar'} onClose={() => setOpenModal(null)} trip={trip} />}

      {/* Share panel */}
      <SharePanel
        isOpen={openModal === 'share'}
        onClose={() => setOpenModal(null)}
        tripId={id!}
        destination={row.destination}
        visibility={row.visibility}
      />
    </View>
  );
}

// ─── Budget Tab ───

function BudgetTab({ trip }: { trip: Trip }) {
  const breakdown = trip.costBreakdown;
  if (!breakdown) {
    return (
      <View style={{ padding: 20 }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: fonts.sans }}>Pas de données budget.</Text>
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
    <View style={{ padding: 20, gap: 24 }}>
      {/* Total */}
      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>Coût estimé total</Text>
        <Text style={{ color: colors.gold, fontSize: 40, fontFamily: fonts.display }}>
          {Math.round(total)}€
        </Text>
        {trip.preferences?.groupSize && trip.preferences.groupSize > 1 && (
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
            ~{Math.round(total / trip.preferences.groupSize)}€ / personne
          </Text>
        )}
      </View>

      {/* Category bars */}
      <View style={{ gap: 14 }}>
        {items.map((item) => (
          <View key={item.label} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
                <Text style={{ color: colors.text, fontSize: 14 }}>{item.label}</Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansBold }}>{Math.round(item.value)}€</Text>
            </View>
            <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3 }}>
              <View style={{
                height: 6, backgroundColor: item.color, borderRadius: 3,
                width: `${(item.value / maxValue) * 100}%`,
              }} />
            </View>
          </View>
        ))}
      </View>

      {/* Carbon footprint */}
      {trip.carbonFootprint && (
        <View style={{
          backgroundColor: colors.surface, borderRadius: radius.card, padding: 18,
          borderWidth: 1, borderColor: colors.borderSubtle, gap: 8,
        }}>
          <Text style={{ color: colors.text, fontSize: 15, fontFamily: fonts.display }}>
            Empreinte carbone
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ color: colors.gold, fontSize: 28, fontFamily: fonts.display }}>
              {Math.round(trip.carbonFootprint.total)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>kg CO₂</Text>
            <View style={{
              marginLeft: 8, backgroundColor: colors.goldBg,
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
            }}>
              <Text style={{ color: colors.gold, fontSize: 12, fontFamily: fonts.sansBold }}>
                {trip.carbonFootprint.rating}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Per day */}
      {trip.days?.some((d) => d.dailyBudget) && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display }}>Par jour</Text>
          {trip.days.map((day) => day.dailyBudget ? (
            <View key={day.dayNumber} style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: colors.surface, borderRadius: radius.md, padding: 12,
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Jour {day.dayNumber}</Text>
              <Text style={{ color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold }}>
                {Math.round(day.dailyBudget.total)}€
              </Text>
            </View>
          ) : null)}
        </View>
      )}
    </View>
  );
}

// ─── Info Tab ───

function InfoTab({ trip }: { trip: Trip }) {
  const tips = trip.travelTips;

  return (
    <View style={{ padding: 20, gap: 20 }}>
      {tips?.vocabulary && (
        <InfoSection title={`Vocabulaire ${tips.vocabulary.language}`}>
          {tips.vocabulary.phrases.slice(0, 10).map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
              <Text style={{ color: '#e2e8f0', fontSize: 13, flex: 1 }}>{p.original}</Text>
              <Text style={{ color: colors.gold, fontSize: 13, flex: 1, textAlign: 'right' }}>{p.translation}</Text>
            </View>
          ))}
        </InfoSection>
      )}

      {tips?.emergency && (
        <InfoSection title="Numéros d'urgence">
          <InfoRow label="Police" value={tips.emergency.police} />
          <InfoRow label="Ambulance" value={tips.emergency.ambulance} />
          <InfoRow label="Pompiers" value={tips.emergency.fire} />
          <InfoRow label="Urgences" value={tips.emergency.generalEmergency} />
        </InfoSection>
      )}

      {tips?.packing && (
        <InfoSection title="À emporter">
          {tips.packing.essentials.slice(0, 10).map((e, i) => (
            <View key={i} style={{ paddingVertical: 6 }}>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>• {e.item}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginLeft: 12 }}>{e.reason}</Text>
            </View>
          ))}
          {tips.packing.plugType && <InfoRow label="Prise électrique" value={tips.packing.plugType} />}
        </InfoSection>
      )}

      {tips?.legal && (
        <InfoSection title="Informations légales">
          {tips.legal.importantLaws?.slice(0, 5).map((law, i) => (
            <Text key={i} style={{ color: colors.textSecondary, fontSize: 12, paddingVertical: 4 }}>• {law}</Text>
          ))}
        </InfoSection>
      )}

      {!tips && (
        <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: fonts.sans }}>Aucune info disponible.</Text>
      )}
    </View>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: radius.card, padding: 18,
      borderWidth: 1, borderColor: colors.borderSubtle, gap: 4,
    }}>
      <Text style={{ color: colors.text, fontSize: 15, fontFamily: fonts.display, marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: '#e2e8f0', fontSize: 13, fontFamily: fonts.sansSemiBold }}>{value}</Text>
    </View>
  );
}
