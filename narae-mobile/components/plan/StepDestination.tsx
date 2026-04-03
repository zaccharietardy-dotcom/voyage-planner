import { useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, Keyboard, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Search } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DESTINATIONS } from '@/lib/destinations';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

function getSuggestedDuration(city: string, origin?: string): number {
  const c = city.toLowerCase();
  const o = origin?.toLowerCase() || '';
  const isAsia = (s: string) => /tokyo|seoul|pékin|beijing|shanghai|bangkok|singapour|singapore|phuket|bali|denpasar|hong kong/i.test(s);
  const isEurope = (s: string) => /paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon|nice|lyon|bordeaux|nantes|marseille/i.test(s);
  const isUS = (s: string) => /new york|nyc|los angeles|san francisco|las vegas|miami/i.test(s);
  const sameRegion = (isAsia(c) && isAsia(o)) || (isEurope(c) && isEurope(o)) || (isUS(c) && isUS(o));
  if (/tokyo|seoul|pékin|beijing|shanghai|new york|nyc|los angeles|rio de janeiro|bangkok|singapour|singapore/i.test(c)) return sameRegion ? 3 : 5;
  if (/paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon/i.test(c)) return 3;
  if (/nice|lyon|bordeaux|nantes|marseille|strasbourg|lille|montpellier|toulouse|annecy|biarritz/i.test(c)) return 2;
  return 4;
}

export function StepDestination({ prefs, onChange }: Props) {
  const [destQuery, setDestQuery] = useState(prefs.destination ?? '');

  const handleSelect = (name: string) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setDestQuery(name);
    onChange({ destination: name, durationDays: getSuggestedDuration(name, prefs.origin) });
  };

  const handleChange = (t: string) => {
    setDestQuery(t);
    onChange({ destination: t, durationDays: getSuggestedDuration(t, prefs.origin) });
  };

  return (
    <View style={{ gap: 24 }}>
      <View>
        <Text style={s.title}>Où allez-vous ?</Text>
        <Text style={s.subtitle}>Choisissez votre prochaine destination</Text>
      </View>

      <View style={[s.searchBar, destQuery ? s.searchBarActive : null]}>
        <Search size={20} color={destQuery ? colors.gold : colors.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Ex: Tokyo, Marrakech..."
          placeholderTextColor={colors.textDim}
          value={destQuery}
          onChangeText={handleChange}
          autoCorrect={false}
        />
      </View>

      <View style={{ gap: 12 }}>
        <Text style={s.sectionLabel}>Suggestions populaires</Text>
        <FlatList
          data={DESTINATIONS.slice(0, 6)}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.slug}
          contentContainerStyle={{ gap: 10 }}
          renderItem={({ item }) => (
            <Pressable onPress={() => handleSelect(item.name)} style={s.destCard}>
              <Image source={{ uri: item.image }} style={s.destImage} resizeMode="cover" />
              <View style={s.destInfo}>
                <Text style={s.destName}>{item.emoji} {item.name}</Text>
                <Text style={s.destCountry}>{item.country}</Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.display },
  subtitle: { color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 },
  sectionLabel: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.xl, borderCurve: 'continuous',
    paddingHorizontal: 16, height: 56,
  },
  searchBarActive: { borderColor: colors.gold, boxShadow: '0 0 8px rgba(197,160,89,0.15)' },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, fontFamily: fonts.sansMedium },
  destCard: {
    width: 130, borderRadius: radius.xl, borderCurve: 'continuous', overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  destImage: { width: 130, height: 85 },
  destInfo: { padding: 10 },
  destName: { color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold },
  destCountry: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans, marginTop: 2 },
});
