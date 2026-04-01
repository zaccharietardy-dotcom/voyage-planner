import { View, Text, Pressable, Image } from 'react-native';
import {
  MapPin, UtensilsCrossed, Hotel, Train, Plane, Clock,
  Star, Luggage, Coffee, ParkingCircle, MoreHorizontal,
} from 'lucide-react-native';
import { TRIP_ITEM_COLORS, type TripItem, type TripItemType } from '@/lib/types/trip';
import { colors, radius } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';

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
      style={({ pressed }) => ({
        flexDirection: 'row',
        paddingHorizontal: 20,
        opacity: pressed && onPress ? 0.85 : 1,
      })}
    >
      {/* Timeline column */}
      <View style={{ width: 40, alignItems: 'center' }}>
        {!isFirst && <View style={{ width: 2, height: 8, backgroundColor: colors.border }} />}
        {isFirst && <View style={{ height: 8 }} />}
        <View style={{
          width: 14, height: 14, borderRadius: 7,
          backgroundColor: color,
          borderWidth: 3, borderColor: colors.bg,
        }} />
        {!isLast && <View style={{ width: 2, flex: 1, backgroundColor: colors.border }} />}
      </View>

      {/* Content card */}
      <View style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: radius.xl,
        marginBottom: 6,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        overflow: 'hidden',
      }}>
        {/* Thumbnail */}
        {imageUrl && (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: '100%', height: 70 }}
            resizeMode="cover"
          />
        )}

        <View style={{ padding: 12 }}>
          {/* Time + type icon */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Clock size={11} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>
              {item.startTime} – {item.endTime}
            </Text>
            <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon size={12} color={color} />
              {onLongPress && <MoreHorizontal size={13} color={colors.textDim} />}
            </View>
          </View>

          {/* Title */}
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 1 }}>
            {item.title}
          </Text>

          {/* Location */}
          {item.locationName && item.type !== 'free_time' && (
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 2 }} numberOfLines={1}>
              {item.locationName}
            </Text>
          )}

          {/* Meta row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
            {item.rating !== undefined && item.rating > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Star size={10} color={colors.gold} fill={colors.gold} />
                <Text style={{ color: colors.gold, fontSize: 10, fontWeight: '700' }}>
                  {item.rating.toFixed(1)}
                </Text>
              </View>
            )}
            {item.estimatedCost !== undefined && item.estimatedCost > 0 && (
              <Text style={{ color: colors.textMuted, fontSize: 10 }}>~{item.estimatedCost}€</Text>
            )}
            {item.duration && (
              <Text style={{ color: colors.textMuted, fontSize: 10 }}>{formatDuration(item.duration)}</Text>
            )}
            {item.distanceFromPrevious !== undefined && item.distanceFromPrevious > 0 && (
              <Text style={{ color: colors.textDim, fontSize: 9 }}>
                {item.distanceFromPrevious < 1
                  ? `${Math.round(item.distanceFromPrevious * 1000)}m`
                  : `${item.distanceFromPrevious.toFixed(1)}km`}
              </Text>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
