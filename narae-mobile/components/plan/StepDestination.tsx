import { useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, Keyboard, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DESTINATIONS } from '@/lib/destinations';
import { colors, fonts } from '@/lib/theme';
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
  const [isFocused, setIsFocused] = useState(false);
  const { width } = useWindowDimensions();

  // 2-column grid for popular destinations
  const cardWidth = (width - 40 - 48 - 16) / 2; // screenPadding*2 + shellPadding*2 + gap

  const filtered = destQuery.length >= 2
    ? DESTINATIONS.filter((d) =>
        d.name.toLowerCase().includes(destQuery.toLowerCase()) ||
        d.country?.toLowerCase().includes(destQuery.toLowerCase())
      ).slice(0, 6)
    : [];

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
    <View style={{ gap: 28 }}>
      {/* Title — matches web text-4xl font-serif font-bold */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>Où allez-vous ?</Text>
        <Text style={s.subtitle}>Choisissez votre prochaine destination</Text>
      </View>

      {/* Search input — matches web h-[56px] rounded-[1.2rem] with MapPin icon */}
      <View style={{ position: 'relative' }}>
        {isFocused && (
          <View style={s.inputGlow} />
        )}
        <View style={[s.searchBar, isFocused && s.searchBarFocused]}>
          <MapPin size={18} color={isFocused ? colors.text : 'rgba(255,255,255,0.5)'} strokeWidth={2} />
          <TextInput
            style={s.searchInput}
            placeholder="Ex: Tokyo, Marrakech..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={destQuery}
            onChangeText={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoCorrect={false}
          />
        </View>

        {/* Autocomplete dropdown — matches web rounded-[1.2rem] bg-[#0f1629] */}
        {filtered.length > 0 && isFocused && (
          <View style={s.dropdown}>
            {filtered.map((item) => (
              <Pressable key={item.slug} onPress={() => handleSelect(item.name)} style={s.suggestion}>
                <Text style={s.suggestionName}>{item.name}</Text>
                {item.country && <Text style={s.suggestionCountry}>{item.country}</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Popular destinations — matches web grid-cols-2 rounded-[2.5rem] */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>SUGGESTIONS POPULAIRES</Text>
        <View style={s.destGrid}>
          {DESTINATIONS.slice(0, 6).map((item) => (
            <Pressable
              key={item.slug}
              onPress={() => handleSelect(item.name)}
              style={[s.destCard, { width: cardWidth, height: cardWidth * 1.1 }]}
            >
              <Image source={{ uri: item.image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              {/* Gradient overlay */}
              <View style={s.destOverlay} />
              {/* Content */}
              <View style={s.destContent}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                  <Text style={s.destName}>{item.name}</Text>
                </View>
                {item.country && (
                  <Text style={s.destCountry}>{item.country}</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 36,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 17,
    fontFamily: fonts.sans,
    marginTop: 6,
    textAlign: 'center',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  // Input — matches web h-[56px] pl-[3.25rem] rounded-[1.2rem] bg-[#0e1220]/50
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(14,18,32,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 19,
    borderCurve: 'continuous',
    paddingLeft: 20,
    paddingRight: 24,
    height: 56,
  },
  searchBarFocused: {
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: '#0f1429',
  },
  inputGlow: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 21,
    backgroundColor: 'rgba(197,160,89,0.2)',
    // blur approximation via shadow
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansMedium,
  },
  // Dropdown — matches web rounded-[1.2rem] bg-[#0f1629] border-white/10
  dropdown: {
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    zIndex: 50,
    borderRadius: 19,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0f1629',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    paddingVertical: 12,
    maxHeight: 256,
  },
  suggestion: {
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  suggestionName: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.sansMedium,
  },
  suggestionCountry: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sans,
    marginTop: 2,
  },
  // Destination grid — matches web grid-cols-2 gap-6
  destGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
  },
  // Card — matches web rounded-[2.5rem] aspect-[0.9] with image + gradient
  destCard: {
    borderRadius: 40,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  destOverlay: {
    ...StyleSheet.absoluteFillObject,
    // gradient from transparent to dark navy
    backgroundColor: 'rgba(2,6,23,0.5)',
  },
  destContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 2,
  },
  destName: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.sansBold,
    letterSpacing: -0.3,
  },
  destCountry: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginLeft: 26,
  },
});
