import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

export function StepOrigin({ prefs, onChange }: Props) {
  const [query, setQuery] = useState(prefs.origin ?? '');

  const handleSelect = (city: string) => {
    Haptics.selectionAsync();
    setQuery(city);
    onChange({ origin: city });
  };

  return (
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display }}>
          D&apos;où partez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 }}>
          Pour calculer vos temps de trajet
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
          borderColor: query ? colors.gold : 'rgba(255,255,255,0.08)',
          borderRadius: radius.xl, borderCurve: 'continuous',
          paddingHorizontal: 18, height: 56,
        }}>
          <MapPin size={20} color={query ? colors.gold : colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 16, fontFamily: fonts.sansMedium }}
            placeholder="Ex: Paris, Lyon, Bordeaux..."
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={(t) => { setQuery(t); onChange({ origin: t }); }}
            autoCorrect={false}
            textContentType="none"
            autoComplete="off"
          />
        </View>
      </View>

      {/* Popular origins */}
      <View>
        <Text style={{
          color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold,
          textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12,
        }}>
          Villes populaires
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Lille', 'Strasbourg'].map((city) => {
            const selected = query.toLowerCase() === city.toLowerCase();
            return (
              <Pressable
                key={city}
                onPress={() => handleSelect(city)}
                style={{
                  paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.06)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.12)',
                }}
              >
                <Text style={{ color: selected ? colors.gold : colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold }}>
                  {city}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
