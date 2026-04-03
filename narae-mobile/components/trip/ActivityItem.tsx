import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import {
  MapPin, UtensilsCrossed, Hotel, Train, Plane, Clock,
  Star, Luggage, Coffee, ParkingCircle, MoreHorizontal,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { TRIP_ITEM_COLORS, type TripItem, type TripItemType } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  item: TripItem;
  isFirst?: boolean;
  isLast?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

const ICONS: Record<TripItemType, LucideIcon> = {
  activity: MapPin,
  restaurant: UtensilsCrossed,
  hotel: Hotel,
  transport: Train,
  flight: Plane,
  parking: ParkingCircle,
  checkin: Hotel,
  checkout: Hotel,
  luggage: Luggage,
  free_time: Coffee,
};

function formatDuration(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}`;
  }
  return `${min}min`;
}

export function ActivityItem({ item, isFirst, isLast, onPress, onLongPress }: Props) {
  const color = TRIP_ITEM_COLORS[item.type] || colors.textMuted;
  const Icon = ICONS[item.type] || MapPin;
  const imageUrl = item.viatorImageUrl || item.imageUrl;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View style={styles.timelineCol}>
        {!isFirst ? <View style={styles.timelineTop} /> : <View style={styles.timelineSpacer} />}
        <View style={[styles.timelineDot, { backgroundColor: color }]} />
        {!isLast ? <View style={styles.timelineBottom} /> : null}
      </View>

      <View style={styles.card}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" /> : null}

        <View style={styles.content}>
          <View style={styles.topRow}>
            <Clock size={11} color={colors.textMuted} />
            <Text style={styles.timeText}>
              {item.startTime} – {item.endTime}
            </Text>
            <View style={styles.trailingIcons}>
              <Icon size={12} color={color} />
              {onLongPress ? <MoreHorizontal size={13} color={colors.textDim} /> : null}
            </View>
          </View>

          <Text style={styles.title}>{item.title}</Text>

          {item.locationName && item.type !== 'free_time' ? (
            <Text style={styles.location} numberOfLines={1}>
              {item.locationName}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {item.rating !== undefined && item.rating > 0 ? (
              <View style={styles.ratingWrap}>
                <Star size={11} color={colors.gold} fill={colors.gold} />
                <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
              </View>
            ) : null}
            {item.estimatedCost !== undefined && item.estimatedCost > 0 ? (
              <Text style={styles.metaText}>~{item.estimatedCost}€</Text>
            ) : null}
            {item.duration ? <Text style={styles.metaText}>{formatDuration(item.duration)}</Text> : null}
            {item.distanceFromPrevious !== undefined && item.distanceFromPrevious > 0 ? (
              <Text style={styles.distanceText}>
                {item.distanceFromPrevious < 1
                  ? `${Math.round(item.distanceFromPrevious * 1000)}m`
                  : `${item.distanceFromPrevious.toFixed(1)}km`}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  rowPressed: {
    opacity: 0.9,
  },
  timelineCol: {
    width: 40,
    alignItems: 'center',
  },
  timelineTop: {
    width: 2,
    height: 10,
    backgroundColor: colors.border,
  },
  timelineBottom: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
  },
  timelineSpacer: {
    height: 10,
  },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  card: {
    flex: 1,
    backgroundColor: 'rgba(10,17,40,0.96)',
    borderRadius: radius.card,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  image: {
    width: '100%',
    height: 82,
  },
  content: {
    padding: 14,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  trailingIcons: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.sansSemiBold,
    lineHeight: 22,
  },
  location: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  ratingText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansMedium,
  },
  distanceText: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.sansMedium,
  },
});
