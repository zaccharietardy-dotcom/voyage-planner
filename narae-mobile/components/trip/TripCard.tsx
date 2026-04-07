import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, Users, MapPin } from 'lucide-react-native';
import { Badge } from '@/components/ui/Badge';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripListItem } from '@/lib/api/trips';
import { useTranslation } from '@/lib/i18n';

interface Props {
  trip: TripListItem;
  onPress: () => void;
  compact?: boolean;
}

const FALLBACK_IMAGES: Record<string, string> = {
  paris: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&q=75',
  rome: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&q=75',
  barcelona: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&q=75',
  tokyo: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&q=75',
  london: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=75',
  new_york: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&q=75',
  amsterdam: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&q=75',
  lisbon: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&q=75',
  marrakech: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&q=75',
  istanbul: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=600&q=75',
};
const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=75';

function getImageForDestination(destination: string): string {
  const lower = destination.toLowerCase();
  for (const [key, url] of Object.entries(FALLBACK_IMAGES)) {
    if (lower.includes(key)) return url;
  }
  return DEFAULT_IMAGE;
}

function getTripStatusVariant(trip: TripListItem): 'upcoming' | 'active' | 'past' {
  const now = new Date();
  const start = new Date(trip.start_date);
  const end = new Date(trip.end_date);
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'active';
  return 'past';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const STATUS_KEYS: Record<string, string> = {
  upcoming: 'trip.card.upcoming',
  active: 'trip.card.active',
  past: 'trip.card.past',
};

export function TripCard({ trip, onPress, compact }: Props) {
  const { t } = useTranslation();
  const variant = getTripStatusVariant(trip);
  const status = { variant, label: t(STATUS_KEYS[variant] as any) };
  const imageUrl = getImageForDestination(trip.destination);
  const imageHeight = compact ? 130 : 220;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.cardCompact : styles.cardFull,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={[styles.imageWrap, { height: imageHeight }]}>
        <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        <LinearGradient
          colors={['transparent', 'rgba(2,6,23,0.3)', 'rgba(2,6,23,0.95)']}
          style={[styles.imageOverlay, { height: imageHeight * 0.72 }]}
        />
        <View style={styles.badgeWrap}>
          <Badge variant={status.variant} label={status.label} />
        </View>
        <View style={styles.destinationWrap}>
          <Text style={styles.kicker}>{t('trip.card.kicker')}</Text>
          <Text style={[styles.title, compact ? styles.titleCompact : null]}>
            {trip.title || trip.destination}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.content}>
        <View style={styles.locationRow}>
          <MapPin size={13} color={colors.textSecondary} />
          <Text style={styles.locationText}>{trip.destination}</Text>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaGroup}>
            <Calendar size={13} color={colors.textSecondary} />
            <Text style={styles.metaText}>
              {formatDate(trip.start_date)} · {trip.duration_days}j
            </Text>
          </View>
          {trip.preferences?.groupSize ? (
            <View style={styles.metaGroup}>
              <Users size={13} color={colors.textSecondary} />
              <Text style={styles.metaText}>{trip.preferences.groupSize}</Text>
            </View>
          ) : null}
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
    backgroundColor: 'rgba(10,17,40,0.96)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 26,
    elevation: 10,
  },
  cardFull: {
    marginBottom: 16,
  },
  cardCompact: {
    width: 260,
  },
  cardPressed: {
    opacity: 0.96,
    borderColor: colors.goldBorder,
    transform: [{ scale: 0.99 }],
  },
  imageWrap: {
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
  },
  badgeWrap: {
    position: 'absolute',
    top: 14,
    right: 14,
  },
  destinationWrap: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 16,
    gap: 4,
  },
  kicker: {
    color: colors.goldLight,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontFamily: fonts.display,
    lineHeight: 30,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 24,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  metaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
