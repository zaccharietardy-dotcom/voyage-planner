import { View, Text, ScrollView, Pressable, Linking, Image } from 'react-native';
import {
  Star, Clock, MapPin, ExternalLink, Navigation,
  UtensilsCrossed, Ticket,
} from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripItem } from '@/lib/types/trip';

interface Props {
  item: TripItem;
}

export function ActivityDetail({ item }: Props) {
  const openInMaps = () => {
    if (item.googleMapsPlaceUrl) {
      Linking.openURL(item.googleMapsPlaceUrl);
    } else {
      const q = encodeURIComponent(`${item.title} ${item.locationName}`);
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
    }
  };

  const openBooking = async (url: string) => {
    try {
      await openBrowserAsync(url);
    } catch {
      Linking.openURL(url);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
    >
      {/* Header */}
      <View>
        <Text style={{ color: '#f8fafc', fontSize: 20, fontFamily: fonts.display, marginBottom: 6 }}>
          {item.title}
        </Text>
        {item.locationName && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MapPin size={14} color="#94a3b8" />
            <Text style={{ color: '#94a3b8', fontSize: 13, fontFamily: fonts.sans, flex: 1 }}>{item.locationName}</Text>
          </View>
        )}
      </View>

      {/* Photo gallery */}
      {item.photoGallery && item.photoGallery.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8 }}>
            {item.photoGallery.slice(0, 5).map((url, i) => (
              <Image
                key={i}
                source={{ uri: url }}
                style={{ width: 160, height: 110, borderRadius: 12 }}
                resizeMode="cover"
              />
            ))}
          </View>
        </ScrollView>
      )}

      {/* Stats row */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Clock size={14} color="#64748b" />
          <Text style={{ color: '#e2e8f0', fontSize: 13 }}>
            {item.startTime} – {item.endTime}
          </Text>
        </View>
        {item.rating && item.rating > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Star size={14} color="#c5a059" fill="#c5a059" />
            <Text style={{ color: '#c5a059', fontSize: 13, fontFamily: fonts.sansBold }}>
              {item.rating.toFixed(1)}
            </Text>
            {item.reviewCount && (
              <Text style={{ color: '#64748b', fontSize: 12 }}>({item.reviewCount})</Text>
            )}
          </View>
        )}
        {item.duration && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Clock size={14} color="#64748b" />
            <Text style={{ color: '#e2e8f0', fontSize: 13 }}>
              {item.duration >= 60 ? `${Math.floor(item.duration / 60)}h${item.duration % 60 > 0 ? String(item.duration % 60).padStart(2, '0') : ''}` : `${item.duration}min`}
            </Text>
          </View>
        )}
        {item.estimatedCost !== undefined && item.estimatedCost > 0 && (
          <Badge variant="gold" label={`~${item.estimatedCost}€`} />
        )}
      </View>

      {/* Description */}
      {item.description && (
        <Text style={{ color: '#94a3b8', fontSize: 14, fontFamily: fonts.sans, lineHeight: 20 }}>
          {item.description}
        </Text>
      )}

      {/* Restaurant details */}
      {item.restaurant && (
        <View style={{
          backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: radius.card,
          padding: 14, gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <UtensilsCrossed size={14} color="#F97316" />
            <Text style={{ color: '#f8fafc', fontSize: 14, fontFamily: fonts.sansSemiBold }}>
              {item.restaurant.name}
            </Text>
          </View>
          {item.restaurant.cuisineTypes?.length > 0 && (
            <Text style={{ color: '#94a3b8', fontSize: 12 }}>
              {item.restaurant.cuisineTypes.join(', ')}
            </Text>
          )}
          {item.restaurant.rating > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Star size={12} color="#c5a059" fill="#c5a059" />
              <Text style={{ color: '#c5a059', fontSize: 12 }}>{item.restaurant.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>
      )}

      {/* Restaurant alternatives */}
      {item.restaurantAlternatives && item.restaurantAlternatives.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#64748b', fontSize: 12, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>Alternatives</Text>
          {item.restaurantAlternatives.map((alt) => (
            <Pressable
              key={alt.id}
              onPress={() => alt.googleMapsUrl && Linking.openURL(alt.googleMapsUrl)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#e2e8f0', fontSize: 13 }}>{alt.name}</Text>
                <Text style={{ color: '#64748b', fontSize: 11 }}>{alt.cuisineTypes?.join(', ')}</Text>
              </View>
              {alt.rating > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Star size={10} color="#c5a059" fill="#c5a059" />
                  <Text style={{ color: '#c5a059', fontSize: 11 }}>{alt.rating.toFixed(1)}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={{ gap: 10, marginTop: 4 }}>
        <Button icon={Navigation} onPress={openInMaps}>Ouvrir dans Maps</Button>

        {item.bookingUrl && (
          <Button variant="secondary" icon={Ticket} onPress={() => openBooking(item.bookingUrl!)}>
            Réserver
          </Button>
        )}

        {item.viatorUrl && (
          <Button variant="outline" icon={ExternalLink} onPress={() => openBooking(item.viatorUrl!)}>
            Voir sur Viator
          </Button>
        )}
      </View>
    </ScrollView>
  );
}
