import { View, Text, ScrollView, Pressable, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import {
  Star, Clock, MapPin, Navigation, ExternalLink,
  UtensilsCrossed, Ticket,
} from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { Button } from '@/components/ui/Button';
import { colors, fonts, radius } from '@/lib/theme';
import { SITE_URL } from '@/lib/constants';
import type { TripItem } from '@/lib/types/trip';

interface Props {
  item: TripItem;
}

export function ActivityDetail({ item }: Props) {
  const rawUrl = item.viatorImageUrl || item.imageUrl || item.photoGallery?.[0];
  const imageUrl = rawUrl?.startsWith('/') ? `${SITE_URL}${rawUrl}` : rawUrl;

  const openInMaps = () => {
    if (item.googleMapsPlaceUrl) {
      Linking.openURL(item.googleMapsPlaceUrl);
    } else {
      const q = encodeURIComponent(`${item.title} ${item.locationName}`);
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
    }
  };

  const openBooking = async (url: string) => {
    try { await openBrowserAsync(url); } catch { Linking.openURL(url); }
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Hero image with rounded corners */}
      {imageUrl ? (
        <View style={s.imageWrap}>
          <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        </View>
      ) : null}

      {/* Title + location */}
      <View style={s.header}>
        <Text style={s.title}>{item.title}</Text>
        {item.locationName ? (
          <View style={s.locationRow}>
            <MapPin size={14} color={colors.textSecondary} />
            <Text style={s.location}>{item.locationName}</Text>
          </View>
        ) : null}
      </View>

      {/* Stats badges row */}
      <View style={s.statsRow}>
        <View style={s.statChip}>
          <Clock size={13} color={colors.textMuted} />
          <Text style={s.statText}>{item.startTime} – {item.endTime}</Text>
        </View>
        {item.rating && item.rating > 0 ? (
          <View style={[s.statChip, s.ratingChip]}>
            <Star size={13} color={colors.gold} fill={colors.gold} />
            <Text style={s.ratingText}>{item.rating.toFixed(1)}</Text>
          </View>
        ) : null}
        {item.duration ? (
          <View style={s.statChip}>
            <Clock size={13} color={colors.textMuted} />
            <Text style={s.statText}>
              {item.duration >= 60 ? `${Math.floor(item.duration / 60)}h${item.duration % 60 > 0 ? String(item.duration % 60).padStart(2, '0') : ''}` : `${item.duration}min`}
            </Text>
          </View>
        ) : null}
        {item.estimatedCost !== undefined && item.estimatedCost > 0 ? (
          <View style={[s.statChip, s.costChip]}>
            <Text style={s.costText}>~{item.estimatedCost}€</Text>
          </View>
        ) : null}
      </View>

      {/* Description */}
      {item.description ? <Text style={s.description}>{item.description}</Text> : null}

      {/* Restaurant info */}
      {item.restaurant ? (
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <UtensilsCrossed size={14} color={colors.restaurant} />
            <Text style={s.restaurantTitle}>{item.restaurant.name}</Text>
          </View>
          {item.restaurant.cuisineTypes?.length > 0 ? (
            <Text style={s.restaurantCuisine}>{item.restaurant.cuisineTypes.join(', ')}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Alternatives */}
      {item.restaurantAlternatives && item.restaurantAlternatives.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={s.sectionLabel}>Alternatives</Text>
          {item.restaurantAlternatives.map((alt) => (
            <Pressable key={alt.id} onPress={() => alt.googleMapsUrl && Linking.openURL(alt.googleMapsUrl)} style={s.altRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.altName}>{alt.name}</Text>
                <Text style={s.altCuisine}>{alt.cuisineTypes?.join(', ')}</Text>
              </View>
              {alt.rating > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Star size={10} color={colors.gold} fill={colors.gold} />
                  <Text style={{ color: colors.gold, fontSize: 11, fontFamily: fonts.sansBold }}>{alt.rating.toFixed(1)}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Action buttons — compact row */}
      <View style={s.actions}>
        <Button icon={Navigation} onPress={openInMaps} style={{ flex: 1 }}>Maps</Button>
        {item.bookingUrl ? (
          <Button variant="secondary" icon={Ticket} onPress={() => openBooking(item.bookingUrl!)} style={{ flex: 1 }}>Réserver</Button>
        ) : null}
        {item.viatorUrl ? (
          <Button variant="outline" icon={ExternalLink} onPress={() => openBooking(item.viatorUrl!)} style={{ flex: 1 }}>Viator</Button>
        ) : null}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  // Hero image — rounded, not square
  imageWrap: {
    height: 200,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  header: { gap: 6 },
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.display, lineHeight: 30 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  location: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans, flex: 1 },
  // Stats
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  ratingChip: {
    borderColor: 'rgba(197,160,89,0.2)',
    backgroundColor: 'rgba(197,160,89,0.08)',
  },
  costChip: {
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderColor: 'rgba(197,160,89,0.2)',
  },
  statText: { color: colors.text, fontSize: 13, fontFamily: fonts.sansMedium },
  ratingText: { color: colors.gold, fontSize: 13, fontFamily: fonts.sansBold },
  costText: { color: colors.gold, fontSize: 13, fontFamily: fonts.sansBold },
  description: { color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, lineHeight: 22 },
  // Restaurant
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius.card,
    borderCurve: 'continuous', padding: 16, gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  restaurantTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.sansSemiBold },
  restaurantCuisine: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sans },
  sectionLabel: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5 },
  altRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 14, borderCurve: 'continuous',
    padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  altName: { color: colors.text, fontSize: 13, fontFamily: fonts.sansMedium },
  altCuisine: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans },
  // Actions — horizontal row
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
