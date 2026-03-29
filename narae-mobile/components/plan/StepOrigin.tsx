import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

export function StepOrigin({ prefs, onChange }: Props) {
  const [query, setQuery] = useState(prefs.origin ?? '');

  return (
    <View style={{ gap: 24 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.display, marginBottom: 6 }}>
          D'où partez-vous ?
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>
          Votre ville de départ pour calculer les transports
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          borderRadius: radius.lg, paddingHorizontal: 14, height: 52,
        }}>
          <MapPin size={20} color={colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 16 }}
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
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10 }}>
          Villes populaires
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Lille', 'Strasbourg'].map((city) => {
            const selected = query.toLowerCase() === city.toLowerCase();
            return (
              <Pressable
                key={city}
                onPress={() => { setQuery(city); onChange({ origin: city }); }}
                style={{
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md,
                  backgroundColor: selected ? colors.goldBg : colors.surface,
                  borderWidth: 1, borderColor: selected ? colors.goldBorder : colors.borderSubtle,
                }}
              >
                <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 14, fontWeight: '600' }}>
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
