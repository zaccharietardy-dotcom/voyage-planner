import { View, Text, Pressable, SectionList, StyleSheet } from 'react-native';
import {
  Plane, Hotel, MapPin, UtensilsCrossed, Check, ExternalLink,
} from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import type { LucideIcon } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { Trip } from '@/lib/types/trip';

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
        booked: bookedItems.accommodation?.booked ?? false,
      }],
    });
  }

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
    <View style={styles.container}>
      <View style={styles.progressWrap}>
        <View style={styles.progressHeader}>
          <Text style={styles.title}>Réservations</Text>
          <Text style={styles.progressCount}>
            {bookedCount}/{totalItems}
          </Text>
        </View>
        <Text style={styles.subtitle}>Suivez vos réservations essentielles avant le départ.</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressValue, { width: `${progress * 100}%` }]} />
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const Icon = TYPE_ICONS[item.type] || MapPin;
          return (
            <Pressable onPress={() => onToggle(item.id)} style={[styles.itemCard, item.booked ? styles.itemBooked : null]}>
              {item.booked ? (
                <View style={styles.checkboxActive}>
                  <Check size={14} color="#fff" strokeWidth={3} />
                </View>
              ) : (
                <View style={styles.checkbox} />
              )}

              <Icon size={16} color={item.booked ? colors.active : colors.textMuted} />

              <View style={styles.itemCopy}>
                <Text style={[styles.itemTitle, item.booked ? styles.itemTitleBooked : null]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.subtitle ? <Text style={styles.itemSubtitle}>{item.subtitle}</Text> : null}
              </View>

              {item.price ? <Text style={styles.price}>{item.price}€</Text> : null}

              {item.bookingUrl && !item.booked ? (
                <Pressable
                  onPress={async (e) => {
                    e.stopPropagation?.();
                    try {
                      await openBrowserAsync(item.bookingUrl!);
                    } catch {}
                  }}
                  hitSlop={8}
                  style={styles.linkButton}
                >
                  <ExternalLink size={16} color={colors.gold} />
                </Pressable>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressWrap: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    padding: 18,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(10,17,40,0.9)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  progressCount: {
    color: colors.gold,
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressValue: {
    height: 6,
    backgroundColor: colors.gold,
    borderRadius: radius.full,
  },
  listContent: {
    paddingBottom: 48,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginVertical: 4,
    backgroundColor: 'rgba(10,17,40,0.94)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 15,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  itemBooked: {
    backgroundColor: 'rgba(34,197,94,0.06)',
    borderColor: 'rgba(34,197,94,0.18)',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  checkboxActive: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.active,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCopy: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  itemTitleBooked: {
    color: colors.active,
    textDecorationLine: 'line-through',
  },
  itemSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  price: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
  },
  linkButton: {
    width: 32,
    height: 32,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
