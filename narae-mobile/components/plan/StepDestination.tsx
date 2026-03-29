import { useState } from 'react';
import { View, Text, FlatList, Image, Pressable, TextInput, Keyboard } from 'react-native';
import { MapPin, Search } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DESTINATIONS } from '@/lib/destinations';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

/**
 * Smart duration defaults based on city name and relative distance if possible.
 */
function getSuggestedDuration(city: string, origin?: string): number {
  const c = city.toLowerCase();
  const o = origin?.toLowerCase() || '';
  
  // Region detection
  const isAsia = (s: string) => /tokyo|seoul|pékin|beijing|shanghai|bangkok|singapour|singapore|phuket|bali|denpasar|hong kong/i.test(s);
  const isEurope = (s: string) => /paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon|nice|lyon|bordeaux|nantes|marseille/i.test(s);
  const isUS = (s: string) => /new york|nyc|los angeles|san francisco|las vegas|miami/i.test(s);

  const sameRegion = (isAsia(c) && isAsia(o)) || (isEurope(c) && isEurope(o)) || (isUS(c) && isUS(o));

  // Big complex cities
  if (/tokyo|seoul|pékin|beijing|shanghai|new york|nyc|los angeles|rio de janeiro|bangkok|singapour|singapore/i.test(c)) {
    return sameRegion ? 3 : 5; 
  }
  // Standard City break
  if (/paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon/i.test(c)) {
    return 3;
  }
  // Quick getaway
  if (/nice|lyon|bordeaux|nantes|marseille|strasbourg|lille|montpellier|toulouse|annecy|biarritz/i.test(c)) {
    return 2;
  }
  return 4;
}

export function StepDestination({ prefs, onChange }: Props) {
  const [originQuery, setOriginQuery] = useState(prefs.origin ?? '');
  const [destQuery, setDestQuery] = useState(prefs.destination ?? '');

  const handleSelectDestination = (name: string) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setDestQuery(name);
    const suggestedDays = getSuggestedDuration(name, prefs.origin);
    onChange({ destination: name, durationDays: suggestedDays });
  };

  const handleDestChangeText = (t: string) => {
    setDestQuery(t);
    const suggestedDays = getSuggestedDuration(t, prefs.origin);
    onChange({ destination: t, durationDays: suggestedDays });
  };

  return (
    <View style={{ gap: 24 }}>
      {/* Origin */}
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Ville de départ</Text>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          borderRadius: radius.lg, paddingHorizontal: 14, height: 48,
        }}>
          <MapPin size={18} color={colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 15 }}
            placeholder="Ex: Paris, Lyon..."
            placeholderTextColor={colors.textDim}
            value={originQuery}
            onChangeText={(t) => { setOriginQuery(t); onChange({ origin: t }); }}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
          />
        </View>
      </View>

      {/* Destination */}
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600' }}>Destination</Text>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.surface, borderWidth: 1,
          borderColor: destQuery ? colors.gold : colors.border,
          borderRadius: radius.lg, paddingHorizontal: 14, height: 48,
        }}>
          <Search size={18} color={destQuery ? colors.gold : colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 15 }}
            placeholder="Où souhaitez-vous aller ?"
            placeholderTextColor={colors.textDim}
            value={destQuery}
            onChangeText={handleDestChangeText}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
          />
        </View>
      </View>

      {/* Popular destinations — horizontal scroll */}
      <View>
        <Text style={{ color: colors.text, fontSize: 17, fontFamily: fonts.display, marginBottom: 14 }}>
          Destinations populaires
        </Text>
        <FlatList
          data={DESTINATIONS}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12 }}
          keyExtractor={(d) => d.slug}
          renderItem={({ item }) => {
            const selected = destQuery.toLowerCase() === item.name.toLowerCase();
            return (
              <Pressable
                onPress={() => handleSelectDestination(item.name)}
                style={{
                  width: 150, borderRadius: radius['3xl'], overflow: 'hidden',
                  borderWidth: 2,
                  borderColor: selected ? colors.gold : 'transparent',
                  backgroundColor: colors.card,
                }}
              >
                <Image
                  source={{ uri: item.image }}
                  style={{ width: 150, height: 100 }}
                  resizeMode="cover"
                />
                <View style={{ padding: 10 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                    {item.emoji} {item.name}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    {item.country} · {item.idealDuration}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}
