import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, fonts } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const POPULAR_ORIGINS = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Lille', 'Strasbourg'];

export function StepOrigin({ prefs, onChange }: Props) {
  const [query, setQuery] = useState(prefs.origin ?? '');
  const [isFocused, setIsFocused] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);

  const handleSelect = (city: string) => {
    Haptics.selectionAsync();
    setQuery(city);
    onChange({ origin: city });
  };

  return (
    <View style={{ gap: 28 }}>
      {/* Title — matches web text-4xl font-serif font-bold */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>D'où partez-vous ?</Text>
        <Text style={s.subtitle}>Pour calculer vos temps de trajet</Text>
      </View>

      {/* Input — matches web h-[56px] rounded-[1.2rem] with glow */}
      <View style={{ position: 'relative' }}>
        {isFocused && <View style={s.inputGlow} />}
        <View style={[s.inputBar, isFocused && s.inputBarFocused]}>
          <MapPin size={18} color={isFocused ? colors.text : 'rgba(255,255,255,0.5)'} strokeWidth={2} />
          <TextInput
            style={s.input}
            placeholder="Ex: Paris, Lyon, Bordeaux..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={query}
            onChangeText={(t) => { setQuery(t); onChange({ origin: t }); }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
          />
        </View>
      </View>

      {/* Geolocation button */}
      <Pressable
        style={s.geoButton}
        disabled={geoLoading}
        onPress={async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setGeoLoading(true);
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') { setGeoLoading(false); return; }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
            const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            if (place?.city) { handleSelect(place.city); }
          } catch { /* ignore */ }
          setGeoLoading(false);
        }}
      >
        {geoLoading ? <ActivityIndicator size="small" color="rgba(255,255,255,0.9)" /> : <Navigation size={18} color="rgba(255,255,255,0.9)" />}
        <Text style={s.geoText}>Utiliser ma position</Text>
      </Pressable>

      {/* Popular origins — matches web pill chips */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>VILLES POPULAIRES</Text>
        <View style={s.chipGrid}>
          {POPULAR_ORIGINS.map((city) => {
            const selected = query.toLowerCase() === city.toLowerCase();
            return (
              <Pressable
                key={city}
                onPress={() => handleSelect(city)}
                style={[s.chip, selected && s.chipSelected]}
              >
                <Text style={[s.chipText, selected && { color: colors.gold }]}>{city}</Text>
              </Pressable>
            );
          })}
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
  // Input bar — matches web h-[56px] pl-[3.25rem] rounded-[1.2rem] bg-[#0e1220]/50
  inputBar: {
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
  inputBarFocused: {
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
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansMedium,
  },
  // Geo button — matches web h-[52px] rounded-[1.2rem] border-dashed
  geoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 52,
    borderRadius: 19,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  geoText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.5,
  },
  // Chips
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 19,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipSelected: {
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderColor: colors.gold,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
});
