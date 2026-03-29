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
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold' }}>
          Où allez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>
          Choisissez votre prochaine destination
        </Text>
      </View>

      {/* Destination Input */}
      <View style={{ gap: 8 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
          borderColor: destQuery ? colors.gold : 'rgba(255,255,255,0.1)',
          borderRadius: 20, paddingHorizontal: 18, height: 64,
          shadowColor: destQuery ? colors.gold : 'transparent',
          shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 10,
        }}>
          <Search size={22} color={destQuery ? colors.gold : colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' }}
            placeholder="Ex: Tokyo, Marrakech..."
            placeholderTextColor={colors.textDim}
            value={destQuery}
            onChangeText={handleDestChangeText}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
          />
        </View>
      </View>

      {/* Popular Destinations List */}
      <View style={{ gap: 16 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', fontFamily: fonts.display }}>
          Suggestions populaires
        </Text>
        <FlatList
          data={DESTINATIONS.slice(0, 6)}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.slug}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleSelectDestination(item.name)}
              style={{
                width: 140, borderRadius: 24, overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
              }}
            >
              <Image source={{ uri: item.image }} style={{ width: 140, height: 100 }} resizeMode="cover" />
              <View style={{ padding: 12 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                  {item.country}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}
