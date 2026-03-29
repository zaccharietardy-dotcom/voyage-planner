import { View, Text, Image, Pressable } from 'react-native';
import { Calendar, Users, MapPin } from 'lucide-react-native';
import { Badge } from '@/components/ui/Badge';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripListItem } from '@/lib/api/trips';

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

function getTripStatus(trip: TripListItem): { variant: 'upcoming' | 'active' | 'past'; label: string } {
  const now = new Date();
  const start = new Date(trip.start_date);
  const end = new Date(trip.end_date);
  if (now < start) return { variant: 'upcoming', label: 'À venir' };
  if (now >= start && now <= end) return { variant: 'active', label: 'En cours' };
  return { variant: 'past', label: 'Passé' };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function TripCard({ trip, onPress, compact }: Props) {
  const status = getTripStatus(trip);
  const imageUrl = getImageForDestination(trip.destination);
  const imageHeight = compact ? 130 : 220;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius['3xl'],
        overflow: 'hidden',
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: pressed ? colors.goldBorder : colors.borderSubtle,
        opacity: pressed ? 0.95 : 1,
        marginBottom: compact ? 0 : 16,
        width: compact ? 260 : undefined,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
      })}
    >
      {/* Image */}
      <View style={{ height: imageHeight, position: 'relative' }}>
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
        {/* Gradient overlay */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: imageHeight * 0.5,
          backgroundColor: 'rgba(2,6,23,0.75)',
        }} />
        {/* Badge */}
        <View style={{ position: 'absolute', top: 14, right: 14 }}>
          <Badge variant={status.variant} label={status.label} />
        </View>
        {/* Destination overlay */}
        <View style={{ position: 'absolute', bottom: 14, left: 18, right: 18 }}>
          <Text style={{
            color: colors.text,
            fontSize: compact ? 17 : 20,
            fontFamily: fonts.display,
          }}>
            {trip.title || trip.destination}
          </Text>
        </View>
      </View>

      {/* Info */}
      <View style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MapPin size={13} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{trip.destination}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Calendar size={13} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {formatDate(trip.start_date)} · {trip.duration_days}j
            </Text>
          </View>
          {trip.preferences?.groupSize && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Users size={13} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{trip.preferences.groupSize}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}
