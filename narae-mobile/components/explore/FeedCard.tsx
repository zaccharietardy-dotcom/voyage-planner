import { View, Text, Image, Pressable } from 'react-native';
import { Heart, Copy, Calendar } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Avatar } from '@/components/ui/Avatar';
import type { FeedTrip } from '@/lib/api/feed';

interface Props {
  trip: FeedTrip;
  onPress: () => void;
  onLike: () => void;
  onClone: () => void;
}

// Same fallback map as TripCard
const FALLBACK_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=75',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&q=75',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&q=75',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&q=75',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=75',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&q=75',
  lisbon: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&q=75',
  marrakech: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&q=75',
  istanbul: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=600&q=75',
};
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=75';

function getImage(dest: string, coverUrl: string | null): string {
  if (coverUrl) return coverUrl;
  const lower = dest.toLowerCase();
  for (const [key, url] of Object.entries(FALLBACK_IMAGES)) {
    if (lower.includes(key)) return url;
  }
  return DEFAULT_IMAGE;
}

export function FeedCard({ trip, onPress, onLike, onClone }: Props) {
  const likeScale = useSharedValue(1);

  const likeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  const handleLike = () => {
    likeScale.value = withSpring(1.3, { damping: 8 }, () => {
      likeScale.value = withSpring(1);
    });
    onLike();
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16, overflow: 'hidden', marginBottom: 16,
        backgroundColor: 'rgba(255,255,255,0.05)',
        opacity: pressed ? 0.95 : 1,
      })}
    >
      {/* Image */}
      <View style={{ height: 200, position: 'relative' }}>
        <Image
          source={{ uri: getImage(trip.destination, trip.cover_url) }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        {/* Gradient */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 80,
          backgroundColor: 'rgba(2,6,23,0.7)',
        }} />
        {/* Duration badge */}
        <View style={{
          position: 'absolute', top: 12, right: 12,
          backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5,
          borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          <Calendar size={12} color="#f8fafc" />
          <Text style={{ color: '#f8fafc', fontSize: 11, fontWeight: '600' }}>
            {trip.duration_days}j
          </Text>
        </View>
        {/* Destination overlay */}
        <View style={{ position: 'absolute', bottom: 12, left: 14 }}>
          <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '800' }}>
            {trip.title || trip.destination}
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{trip.destination}</Text>
        </View>
      </View>

      {/* Bottom bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 14, paddingVertical: 12,
      }}>
        {/* Owner */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Avatar url={trip.owner.avatar_url} name={trip.owner.display_name} size="sm" />
          <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
            {trip.owner.display_name}
          </Text>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable onPress={handleLike} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Animated.View style={likeAnimStyle}>
              <Heart
                size={20}
                color={trip.user_liked ? '#ef4444' : '#64748b'}
                fill={trip.user_liked ? '#ef4444' : 'none'}
              />
            </Animated.View>
            {trip.likes_count > 0 && (
              <Text style={{ color: '#64748b', fontSize: 12 }}>{trip.likes_count}</Text>
            )}
          </Pressable>
          <Pressable onPress={onClone} hitSlop={8}>
            <Copy size={18} color="#64748b" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}
