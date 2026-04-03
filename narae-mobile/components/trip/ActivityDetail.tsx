import { View, Text, ScrollView, Pressable, Linking, Image, StyleSheet } from 'react-native';
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{item.title}</Text>
        {item.locationName ? (
          <View style={styles.locationRow}>
            <MapPin size={14} color={colors.textSecondary} />
            <Text style={styles.location}>{item.locationName}</Text>
          </View>
        ) : null}
      </View>

      {item.photoGallery && item.photoGallery.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryScroll}>
          <View style={styles.galleryRow}>
            {item.photoGallery.slice(0, 5).map((url, i) => (
              <Image key={i} source={{ uri: url }} style={styles.galleryImage} resizeMode="cover" />
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Clock size={14} color={colors.textMuted} />
          <Text style={styles.statText}>
            {item.startTime} – {item.endTime}
          </Text>
        </View>
        {item.rating && item.rating > 0 ? (
          <View style={styles.statChip}>
            <Star size={14} color={colors.gold} fill={colors.gold} />
            <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
            {item.reviewCount ? <Text style={styles.reviewCount}>({item.reviewCount})</Text> : null}
          </View>
        ) : null}
        {item.duration ? (
          <View style={styles.statChip}>
            <Clock size={14} color={colors.textMuted} />
            <Text style={styles.statText}>
              {item.duration >= 60 ? `${Math.floor(item.duration / 60)}h${item.duration % 60 > 0 ? String(item.duration % 60).padStart(2, '0') : ''}` : `${item.duration}min`}
            </Text>
          </View>
        ) : null}
        {item.estimatedCost !== undefined && item.estimatedCost > 0 ? <Badge variant="gold" label={`~${item.estimatedCost}€`} /> : null}
      </View>

      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}

      {item.restaurant ? (
        <View style={styles.card}>
          <View style={styles.restaurantHeader}>
            <UtensilsCrossed size={14} color={colors.restaurant} />
            <Text style={styles.restaurantTitle}>{item.restaurant.name}</Text>
          </View>
          {item.restaurant.cuisineTypes?.length > 0 ? (
            <Text style={styles.restaurantCuisine}>{item.restaurant.cuisineTypes.join(', ')}</Text>
          ) : null}
          {item.restaurant.rating > 0 ? (
            <View style={styles.restaurantRating}>
              <Star size={12} color={colors.gold} fill={colors.gold} />
              <Text style={styles.restaurantRatingText}>{item.restaurant.rating.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {item.restaurantAlternatives && item.restaurantAlternatives.length > 0 ? (
        <View style={styles.alternativesWrap}>
          <Text style={styles.sectionLabel}>Alternatives</Text>
          {item.restaurantAlternatives.map((alt) => (
            <Pressable
              key={alt.id}
              onPress={() => alt.googleMapsUrl && Linking.openURL(alt.googleMapsUrl)}
              style={styles.alternativeRow}
            >
              <View style={styles.alternativeCopy}>
                <Text style={styles.alternativeName}>{alt.name}</Text>
                <Text style={styles.alternativeCuisine}>{alt.cuisineTypes?.join(', ')}</Text>
              </View>
              {alt.rating > 0 ? (
                <View style={styles.alternativeRating}>
                  <Star size={10} color={colors.gold} fill={colors.gold} />
                  <Text style={styles.alternativeRatingText}>{alt.rating.toFixed(1)}</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button icon={Navigation} onPress={openInMaps}>Ouvrir dans Maps</Button>

        {item.bookingUrl ? (
          <Button variant="secondary" icon={Ticket} onPress={() => openBooking(item.bookingUrl!)}>
            Réserver
          </Button>
        ) : null}

        {item.viatorUrl ? (
          <Button variant="outline" icon={ExternalLink} onPress={() => openBooking(item.viatorUrl!)}>
            Voir sur Viator
          </Button>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontFamily: fonts.display,
    lineHeight: 30,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  location: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    flex: 1,
  },
  galleryScroll: {
    marginHorizontal: -20,
  },
  galleryRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
  },
  galleryImage: {
    width: 168,
    height: 112,
    borderRadius: 14,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  statText: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  ratingText: {
    color: colors.gold,
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },
  reviewCount: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sans,
    lineHeight: 22,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  restaurantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  restaurantTitle: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansSemiBold,
  },
  restaurantCuisine: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  restaurantRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  restaurantRatingText: {
    color: colors.gold,
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },
  alternativesWrap: {
    gap: 8,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  alternativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14,
    borderCurve: 'continuous',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  alternativeCopy: {
    flex: 1,
    gap: 2,
  },
  alternativeName: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  alternativeCuisine: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  alternativeRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  alternativeRatingText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
});
