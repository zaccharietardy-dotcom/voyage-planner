import { View, Text, Image, FlatList, Pressable, Linking } from 'react-native';
import { Star, MapPin, Check, Coffee, ExternalLink } from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { colors, fonts, radius } from '@/lib/theme';
import type { Accommodation } from '@/lib/types/trip';

interface Props {
  options: Accommodation[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  central: { label: 'Central', color: '#4ade80', bg: 'rgba(34,197,94,0.15)' },
  comfortable: { label: 'Confort', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
  value: { label: 'Bon plan', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
};

export function HotelSelector({ options, selectedId, onSelect }: Props) {
  if (!options?.length) return null;

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{
        color: colors.text, fontSize: 17, fontFamily: fonts.display,
        paddingHorizontal: 20, marginBottom: 14,
      }}>
        Hébergement
      </Text>
      <FlatList
        data={options}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={292}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => <HotelCard hotel={item} isSelected={item.id === selectedId} onSelect={onSelect} />}
      />
    </View>
  );
}

function HotelCard({ hotel, isSelected, onSelect }: { hotel: Accommodation; isSelected: boolean; onSelect?: (id: string) => void }) {
  const tier = TIER_CONFIG[hotel.distanceTier || 'comfortable'];

  const openBooking = async () => {
    if (hotel.bookingUrl) {
      try { await openBrowserAsync(hotel.bookingUrl); } catch { Linking.openURL(hotel.bookingUrl); }
    }
  };

  return (
    <Pressable
      onPress={() => onSelect?.(hotel.id)}
      style={{
        width: 280, borderRadius: radius['3xl'], overflow: 'hidden',
        backgroundColor: colors.card,
        borderWidth: 2,
        borderColor: isSelected ? colors.gold : colors.borderSubtle,
      }}
    >
      {/* Photo */}
      {hotel.photos?.[0] ? (
        <Image source={{ uri: hotel.photos[0] }} style={{ width: '100%', height: 140 }} resizeMode="cover" />
      ) : (
        <View style={{ width: '100%', height: 140, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 32 }}>🏨</Text>
        </View>
      )}

      {/* Selected check */}
      {isSelected && (
        <View style={{
          position: 'absolute', top: 12, right: 12,
          width: 28, height: 28, borderRadius: 14,
          backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={16} color={colors.bg} strokeWidth={3} />
        </View>
      )}

      {/* Tier badge */}
      {tier && (
        <View style={{
          position: 'absolute', top: 12, left: 12,
          backgroundColor: tier.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
        }}>
          <Text style={{ color: tier.color, fontSize: 11, fontWeight: '700' }}>{tier.label}</Text>
        </View>
      )}

      {/* Info */}
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
          {hotel.name}
        </Text>

        {/* Stars + rating */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {hotel.stars && (
            <View style={{ flexDirection: 'row', gap: 2 }}>
              {Array.from({ length: hotel.stars }).map((_, i) => (
                <Star key={i} size={11} color={colors.gold} fill={colors.gold} />
              ))}
            </View>
          )}
          {hotel.rating > 0 && (
            <Text style={{ color: colors.gold, fontSize: 12, fontWeight: '700' }}>
              {hotel.rating}/10
            </Text>
          )}
        </View>

        {/* Distance */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <MapPin size={12} color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>
            {hotel.distanceToCenter ? `${hotel.distanceToCenter.toFixed(1)} km du centre` : hotel.address}
          </Text>
        </View>

        {/* Breakfast */}
        {hotel.breakfastIncluded && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Coffee size={12} color={colors.active} />
            <Text style={{ color: colors.active, fontSize: 11, fontWeight: '600' }}>Petit-déj inclus</Text>
          </View>
        )}

        {/* Price + booking */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>
              {hotel.pricePerNight}€<Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '400' }}>/nuit</Text>
            </Text>
            {hotel.totalPrice && (
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>Total: {hotel.totalPrice}€</Text>
            )}
          </View>
          {hotel.bookingUrl && (
            <Pressable onPress={openBooking} style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: colors.goldBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
            }}>
              <ExternalLink size={13} color={colors.gold} />
              <Text style={{ color: colors.gold, fontSize: 12, fontWeight: '700' }}>Réserver</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}
