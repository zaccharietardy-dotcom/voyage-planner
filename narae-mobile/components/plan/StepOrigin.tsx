import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '@/lib/theme';
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
        <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold' }}>
          D&apos;où partez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>
          Pour calculer vos temps de trajet
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
          borderColor: query ? colors.gold : 'rgba(255,255,255,0.1)',
          borderRadius: 20, paddingHorizontal: 18, height: 64,
          shadowColor: query ? colors.gold : 'transparent',
          shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 10,
        }}>
          <MapPin size={22} color={query ? colors.gold : colors.textMuted} />
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' }}
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
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold', fontFamily: fonts.display, marginBottom: 16 }}>
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
                  paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16,
                  backgroundColor: selected ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.05)',
                }}
              >
                <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 15, fontWeight: '700' }}>
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
