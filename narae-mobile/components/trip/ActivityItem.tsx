import { useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet, ScrollView } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';
import {
  MapPin, UtensilsCrossed, Hotel, Train, Plane, Clock, Map as MapIcon,
  Star, Luggage, Coffee, ParkingCircle, LogIn, LogOut, MoreHorizontal,
  Footprints, Bus, Car, Bike, ExternalLink,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { TRIP_ITEM_COLORS, type TripItem, type TripItemType } from '@/lib/types/trip';
import { colors, fonts, goldGradient } from '@/lib/theme';
import { SITE_URL } from '@/lib/constants';

interface Props {
  item: TripItem;
  isFirst?: boolean;
  isLast?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onSwapRestaurant?: (item: TripItem, alternative: any) => void;
}

const ICONS: Record<TripItemType, LucideIcon> = {
  activity: MapPin,
  restaurant: UtensilsCrossed,
  hotel: Hotel,
  transport: Train,
  flight: Plane,
  parking: ParkingCircle,
  checkin: LogIn,
  checkout: LogOut,
  luggage: Luggage,
  free_time: Coffee,
};

const TYPE_LABELS: Record<TripItemType, string> = {
  activity: 'ACTIVITÉ',
  restaurant: 'RESTAURANT',
  hotel: 'HÉBERGEMENT',
  transport: 'TRANSPORTS',
  flight: 'VOL',
  parking: 'PARKING',
  checkin: 'CHECK-IN',
  checkout: 'CHECK-OUT',
  luggage: 'CONSIGNE',
  free_time: 'TEMPS LIBRE',
};

function getTransportIcon(title: string): LucideIcon {
  const t = title.toLowerCase();
  if (t.includes('pied') || t.includes('marche') || t.includes('walk')) return Footprints;
  if (t.includes('bus')) return Bus;
  if (t.includes('voiture') || t.includes('taxi') || t.includes('car')) return Car;
  if (t.includes('vélo') || t.includes('bike')) return Bike;
  return Train;
}

function openMaps(item: TripItem) {
  if (item.googleMapsPlaceUrl) {
    Linking.openURL(item.googleMapsPlaceUrl);
  } else {
    const q = encodeURIComponent(`${item.title} ${item.locationName || ''}`);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  }
}

export function ActivityItem({ item, isFirst, isLast, onPress, onLongPress, onSwapRestaurant }: Props) {
  const Icon = ICONS[item.type] || MapPin;
  const rawUrl = (item.type === 'restaurant' && item.restaurant?.photos?.[0])
    ? item.restaurant.photos[0]
    : item.viatorImageUrl || item.imageUrl || item.photoGallery?.[0];
  const rawImageUrl = rawUrl?.startsWith('/') ? `${SITE_URL}${rawUrl}` : rawUrl;
  const [imageError, setImageError] = useState(false);
  const hasImage = !!rawImageUrl && !imageError;

  // Transport items render as a slim intermediate bar (not a full card)
  if (item.type === 'transport') {
    const TransIcon = getTransportIcon(item.title);
    const label = item.title.includes('—') ? item.title.split('—')[0].trim() : 'À pied';
    const distance = item.distanceFromPrevious
      ? item.distanceFromPrevious < 1
        ? `${Math.round(item.distanceFromPrevious * 1000)}m`
        : `${item.distanceFromPrevious.toFixed(1)}km`
      : '';
    const duration = item.duration ? `${item.duration} min` : '';

    return (
      <View style={s.wrapper}>
        <View style={s.timelineCol}>
          <View style={s.timelineLineTop} />
          <View style={[s.timelineDot, { width: 8, height: 8, borderRadius: 4, borderWidth: 2 }]} />
          {!isLast ? <View style={s.timelineLineBottom} /> : null}
        </View>
        <Pressable onPress={() => openMaps(item)} style={s.transportBar}>
          <View style={s.transportIconWrap}>
            <TransIcon size={16} color={colors.gold} />
          </View>
          <Text style={s.transportLabel}>{TYPE_LABELS.transport}</Text>
          <Text style={s.transportMeta}>
            {duration}{duration && distance ? ' · ' : ''}{distance}
          </Text>
          <MoreHorizontal size={16} color={colors.textDim} style={{ marginLeft: 'auto' }} />
        </Pressable>
      </View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={s.wrapper}>
      {/* Timeline */}
      <View style={s.timelineCol}>
        {!isFirst ? <View style={s.timelineLineTop} /> : <View style={{ height: 10 }} />}
        <View style={s.timelineDot} />
        {!isLast ? <View style={s.timelineLineBottom} /> : null}
      </View>

      {/* Card — Pressable wraps a View to guarantee flexDirection row */}
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          { flex: 1 },
          pressed && onPress ? { opacity: 0.95, transform: [{ scale: 0.97 }] } : null,
        ]}
      >
        <View style={s.card}>
          {/* Left: Image — rounded */}
          {hasImage ? (
            <View style={s.imageWrap}>
              <Image source={{ uri: rawImageUrl! }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} onError={() => setImageError(true)} />
              <View style={s.timeBadge}>
                <Clock size={10} color={colors.gold} />
                <Text style={s.timeBadgeText}>{item.startTime}</Text>
              </View>
              {item.rating !== undefined && item.rating > 0 ? (
                <LinearGradient colors={[...goldGradient]} style={s.ratingBadge}>
                  <Star size={10} color="#000" fill="#000" />
                  <Text style={s.ratingText}>{item.rating.toFixed(1)}</Text>
                  <Text style={s.ratingSource}>Google</Text>
                </LinearGradient>
              ) : null}
            </View>
          ) : (
            <View style={[s.imageWrap, s.imagePlaceholder]}>
              <Icon size={24} color="rgba(255,255,255,0.2)" />
              <View style={s.timeBadge}>
                <Clock size={10} color={colors.gold} />
                <Text style={s.timeBadgeText}>{item.startTime}</Text>
              </View>
            </View>
          )}

          {/* Right: Content + description + action buttons */}
          <View style={s.content}>
            <View style={s.contentHeader}>
              <Text style={s.typeLabel}>{TYPE_LABELS[item.type] || 'ACTIVITÉ'}</Text>
              {item.estimatedCost !== undefined && item.estimatedCost > 0 ? (
                <Text style={s.price}>{item.estimatedCost}€</Text>
              ) : null}
            </View>

            <Text style={s.title} numberOfLines={2} ellipsizeMode="tail">{item.title}</Text>

            {item.description ? (
              <Text style={s.description} numberOfLines={2} ellipsizeMode="tail">{item.description}</Text>
            ) : item.locationName && item.type !== 'free_time' ? (
              <Text style={s.description} numberOfLines={1} ellipsizeMode="tail">{item.locationName}</Text>
            ) : null}

            {/* Action buttons row */}
            <View style={s.actionRow}>
              {item.viatorUrl ? (
                <Pressable onPress={() => Linking.openURL(item.viatorUrl!)} style={s.actionBtn}>
                  <ExternalLink size={12} color={colors.gold} />
                  <Text style={s.actionBtnText}>Viator</Text>
                </Pressable>
              ) : null}
              {item.bookingUrl ? (
                <Pressable onPress={() => Linking.openURL(item.bookingUrl!)} style={s.actionBtn}>
                  <Plane size={12} color={colors.gold} />
                  <Text style={s.actionBtnText}>Aviasales</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => openMaps(item)} style={s.actionBtn}>
                <MapIcon size={12} color={colors.gold} />
                <Text style={s.actionBtnText}>Maps</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>

      {/* Restaurant alternatives mini-row */}
      {item.type === 'restaurant' && item.restaurantAlternatives && item.restaurantAlternatives.length > 0 ? (
        <View style={s.altRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingLeft: 4 }}>
            {item.restaurantAlternatives.slice(0, 2).map((alt, i) => (
              <Pressable
                key={alt.id || i}
                onPress={() => onSwapRestaurant?.(item, alt)}
                style={s.altCard}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.altName} numberOfLines={1}>{alt.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    {alt.rating ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <Star size={8} color={colors.gold} fill={colors.gold} />
                        <Text style={s.altMeta}>{alt.rating.toFixed(1)}</Text>
                      </View>
                    ) : null}
                    {alt.cuisineTypes?.[0] ? <Text style={s.altMeta}>{alt.cuisineTypes[0]}</Text> : null}
                  </View>
                </View>
                <Text style={s.altSwap}>Choisir</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    paddingLeft: 4,
    paddingRight: 4,
  },
  timelineCol: { width: 36, alignItems: 'center' },
  timelineLineTop: { width: 1, height: 10, backgroundColor: 'rgba(197,160,89,0.3)' },
  timelineLineBottom: { width: 1, flex: 1, backgroundColor: 'rgba(197,160,89,0.1)' },
  timelineDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.gold, borderWidth: 3, borderColor: '#000',
    shadowColor: '#c5a059', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 15,
  },
  // Transport slim bar
  transportBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 4,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  transportIconWrap: {
    width: 32, height: 32, borderRadius: 12, borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  transportLabel: {
    color: colors.gold, fontSize: 11, fontFamily: fonts.sansBold,
    textTransform: 'uppercase', letterSpacing: 1.5,
  },
  transportMeta: {
    color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sansBold,
  },
  // Activity/Restaurant card
  card: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#0A1628',
    marginBottom: 6,
    marginLeft: 4,
  },
  imageWrap: {
    width: 110,
    minHeight: 120,
    margin: 8,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  imagePlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  timeBadge: {
    position: 'absolute', top: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  timeBadgeText: { color: colors.text, fontSize: 10, fontFamily: fonts.sansBold },
  ratingBadge: {
    position: 'absolute', bottom: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  ratingText: { color: '#000', fontSize: 10, fontFamily: fonts.sansBold },
  ratingSource: { color: 'rgba(0,0,0,0.6)', fontSize: 8, fontFamily: fonts.sansBold, marginLeft: 2 },
  content: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
    gap: 3,
  },
  contentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeLabel: { color: colors.gold, fontSize: 10, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 2 },
  price: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: fonts.sansBold },
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: -0.3, lineHeight: 19 },
  description: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: fonts.sans, fontStyle: 'italic', lineHeight: 16 },
  // Action buttons
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnText: { color: colors.text, fontSize: 10, fontFamily: fonts.sansSemiBold },
  // Restaurant alternatives
  altRow: { marginLeft: 4, marginBottom: 4 },
  altCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  altName: { color: colors.text, fontSize: 12, fontFamily: fonts.sansBold, flex: 1 },
  altMeta: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.sans },
  altSwap: { color: colors.gold, fontSize: 10, fontFamily: fonts.sansBold },
});
