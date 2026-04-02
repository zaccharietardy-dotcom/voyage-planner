import { View, Text, Pressable, SectionList } from 'react-native';
import {
  Plane, Hotel, MapPin, UtensilsCrossed, Check, ExternalLink,
} from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { colors, fonts, radius } from '@/lib/theme';
import type { Trip } from '@/lib/types/trip';
import type { LucideIcon } from 'lucide-react-native';

interface Props {
  trip: Trip;
  bookedItems: Record<string, { booked: boolean; notes?: string }>;
  onToggle: (itemId: string) => void;
}

interface BookingItem {
  id: string;
  title: string;
  subtitle?: string;
  price?: number;
  bookingUrl?: string;
  type: string;
  booked: boolean;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  flight: Plane, hotel: Hotel, activity: MapPin, restaurant: UtensilsCrossed,
  checkin: Hotel, checkout: Hotel, transport: Plane,
};

function buildSections(trip: Trip, bookedItems: Record<string, { booked: boolean }>) {
  const sections: { title: string; data: BookingItem[] }[] = [];

  // Outbound flight
  if (trip.outboundFlight) {
    sections.push({
      title: 'Vol aller',
      data: [{
        id: 'outbound-flight',
        title: `${trip.outboundFlight.departureAirportCode} → ${trip.outboundFlight.arrivalAirportCode}`,
        subtitle: trip.outboundFlight.airline,
        price: trip.outboundFlight.price,
        bookingUrl: trip.outboundFlight.bookingUrl,
        type: 'flight',
        booked: bookedItems['outbound-flight']?.booked ?? false,
      }],
    });
  }

  // Accommodation
  if (trip.accommodation) {
    sections.push({
      title: 'Hébergement',
      data: [{
        id: 'accommodation',
        title: trip.accommodation.name,
        subtitle: `${trip.accommodation.pricePerNight}€/nuit`,
        price: trip.accommodation.totalPrice,
        bookingUrl: trip.accommodation.bookingUrl,
        type: 'hotel',
        booked: bookedItems['accommodation']?.booked ?? false,
      }],
    });
  }

  // Per-day activities that need booking
  trip.days?.forEach((day) => {
    const bookable = day.items.filter((item) =>
      item.type === 'activity' && item.estimatedCost && item.estimatedCost > 0,
    );
    if (bookable.length > 0) {
      sections.push({
        title: `Jour ${day.dayNumber}`,
        data: bookable.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.locationName,
          price: item.estimatedCost,
          bookingUrl: item.bookingUrl || item.viatorUrl,
          type: item.type,
          booked: bookedItems[item.id]?.booked ?? false,
        })),
      });
    }
  });

  // Return flight
  if (trip.returnFlight) {
    sections.push({
      title: 'Vol retour',
      data: [{
        id: 'return-flight',
        title: `${trip.returnFlight.departureAirportCode} → ${trip.returnFlight.arrivalAirportCode}`,
        subtitle: trip.returnFlight.airline,
        price: trip.returnFlight.price,
        bookingUrl: trip.returnFlight.bookingUrl,
        type: 'flight',
        booked: bookedItems['return-flight']?.booked ?? false,
      }],
    });
  }

  return sections;
}

export function BookingChecklist({ trip, bookedItems, onToggle }: Props) {
  const sections = buildSections(trip, bookedItems);
  const totalItems = sections.reduce((s, sec) => s + sec.data.length, 0);
  const bookedCount = sections.reduce((s, sec) => s + sec.data.filter((i) => i.booked).length, 0);
  const progress = totalItems > 0 ? bookedCount / totalItems : 0;

  return (
    <View style={{ flex: 1 }}>
      {/* Progress header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display }}>
            Réservations
          </Text>
          <Text style={{ color: colors.gold, fontSize: 13, fontFamily: fonts.sansBold }}>
            {bookedCount}/{totalItems}
          </Text>
        </View>
        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
          <View style={{
            height: 4, backgroundColor: colors.gold, borderRadius: 2,
            width: `${progress * 100}%`,
          }} />
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderSectionHeader={({ section }) => (
          <Text style={{
            color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold,
            paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6,
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const Icon = TYPE_ICONS[item.type] || MapPin;
          return (
            <Pressable
              onPress={() => onToggle(item.id)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                marginHorizontal: 20, marginVertical: 4,
                backgroundColor: item.booked ? 'rgba(34,197,94,0.05)' : colors.surface,
                borderRadius: radius.card, padding: 14,
                borderWidth: 1, borderColor: item.booked ? 'rgba(34,197,94,0.2)' : colors.borderSubtle,
              }}
            >
              {/* Checkbox */}
              {item.booked ? (
                <View style={{
                  width: 24, height: 24, borderRadius: 8,
                  backgroundColor: colors.active, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Check size={14} color="#fff" strokeWidth={3} />
                </View>
              ) : (
                <View style={{
                  width: 24, height: 24, borderRadius: 8,
                  borderWidth: 2, borderColor: colors.border,
                }} />
              )}

              <Icon size={16} color={item.booked ? colors.active : colors.textMuted} />

              <View style={{ flex: 1 }}>
                <Text style={{
                  color: item.booked ? colors.active : colors.text,
                  fontSize: 13, fontFamily: fonts.sansMedium,
                  textDecorationLine: item.booked ? 'line-through' : 'none',
                }} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.subtitle && (
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{item.subtitle}</Text>
                )}
              </View>

              {item.price && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sansSemiBold }}>
                  {item.price}€
                </Text>
              )}

              {item.bookingUrl && !item.booked && (
                <Pressable
                  onPress={async (e) => {
                    e.stopPropagation?.();
                    try { await openBrowserAsync(item.bookingUrl!); } catch {}
                  }}
                  hitSlop={8}
                >
                  <ExternalLink size={16} color={colors.gold} />
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
