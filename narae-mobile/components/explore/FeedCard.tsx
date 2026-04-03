import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Copy, Calendar } from 'lucide-react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';
import type { FeedTrip } from '@/lib/api/feed';

interface Props {
  trip: FeedTrip;
  onPress: () => void;
  onLike: () => void;
  onClone: () => void;
}

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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: getImage(trip.destination, trip.cover_url) }} style={styles.image} resizeMode="cover" />
        <LinearGradient
          colors={['transparent', 'rgba(2,6,23,0.35)', 'rgba(2,6,23,0.95)']}
          style={styles.imageOverlay}
        />

        {Platform.OS === 'ios' ? (
          <BlurView intensity={24} tint="dark" style={styles.durationBlur}>
            <View style={styles.durationInner}>
              <Calendar size={11} color={colors.text} />
              <Text style={styles.durationText}>{trip.duration_days}j</Text>
            </View>
          </BlurView>
        ) : (
          <View style={[styles.durationBlur, styles.durationAndroid]}>
            <Calendar size={11} color={colors.text} />
            <Text style={styles.durationText}>{trip.duration_days}j</Text>
          </View>
        )}

        <View style={styles.destinationWrap}>
          <Text style={styles.kicker}>Découverte de la communauté</Text>
          <Text style={styles.title}>{trip.title || trip.destination}</Text>
          <Text style={styles.destinationText}>{trip.destination}</Text>
        </View>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.ownerRow}>
          <Avatar url={trip.owner.avatar_url} name={trip.owner.display_name} size="sm" />
          <View style={styles.ownerCopy}>
            <Text style={styles.ownerName} numberOfLines={1}>
              {trip.owner.display_name}
            </Text>
            <Text style={styles.ownerMeta}>
              {trip.likes_count > 0 ? `${trip.likes_count} j'aime` : 'Itinéraire publié'}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable onPress={handleLike} hitSlop={8} style={styles.actionButton}>
            <Animated.View style={likeAnimStyle}>
              <Heart
                size={20}
                color={trip.user_liked ? colors.danger : colors.textMuted}
                fill={trip.user_liked ? colors.danger : 'none'}
              />
            </Animated.View>
            {trip.likes_count > 0 ? <Text style={styles.likesText}>{trip.likes_count}</Text> : null}
          </Pressable>
          <Pressable onPress={onClone} hitSlop={8} style={styles.cloneButton}>
            <Copy size={18} color={colors.gold} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: 'rgba(10,17,40,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 10,
  },
  cardPressed: {
    opacity: 0.96,
    borderColor: colors.goldBorder,
  },
  imageWrap: {
    height: 200,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 112,
  },
  durationBlur: {
    position: 'absolute',
    top: 14,
    right: 14,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  durationAndroid: {
    backgroundColor: 'rgba(2,6,23,0.68)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationInner: {
    backgroundColor: 'rgba(2,6,23,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    color: colors.text,
    fontSize: 9,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  destinationWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    gap: 4,
  },
  kicker: {
    color: colors.goldLight,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.display,
    lineHeight: 28,
  },
  destinationText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  ownerCopy: {
    flex: 1,
    gap: 2,
  },
  ownerName: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
  },
  ownerMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cloneButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  likesText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
});
