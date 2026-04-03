import { useMemo, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Star, Coffee, ChevronDown } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { Accommodation } from '@/lib/types/trip';
import { SelectionSheet, type SelectionSheetOption } from '@/components/ui/SelectionSheet';

interface Props {
  options: Accommodation[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  central: { label: 'Central', color: '#4ade80', bg: 'rgba(34,197,94,0.15)' },
  comfortable: { label: 'Confort', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
  value: { label: 'Bon plan', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
};

export function HotelSelector({ options, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  if (!options?.length) return null;

  const selected = options.find((hotel) => hotel.id === selectedId) || options[0];
  const tier = TIER_CONFIG[selected.distanceTier || 'comfortable'];
  const sheetOptions: Array<SelectionSheetOption & { hotel: Accommodation }> = useMemo(
    () => options.map((hotel) => ({
      value: hotel.id,
      label: hotel.name,
      description: hotel.address,
      searchText: `${hotel.name} ${hotel.address} ${hotel.distanceTier || ''}`,
      hotel,
    })),
    [options],
  );

  return (
    <View style={{ marginTop: 8, paddingHorizontal: 20, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 17, fontFamily: fonts.display }}>
          Hébergement
        </Text>
        {options.length > 1 ? (
          <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sansMedium }}>
            {options.length} options
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 14,
          borderRadius: radius['2xl'],
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.borderSubtle,
        }}
      >
        {selected.photos?.[0] ? (
          <Image source={{ uri: selected.photos[0] }} style={{ width: 72, height: 72, borderRadius: radius.lg }} resizeMode="cover" />
        ) : (
          <View style={{ width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>🏨</Text>
          </View>
        )}

        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontFamily: fonts.sansBold, flex: 1 }} numberOfLines={1}>
              {selected.name}
            </Text>
            {tier ? (
              <View style={{ backgroundColor: tier.bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: tier.color, fontSize: 10, fontFamily: fonts.sansBold }}>{tier.label}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {selected.stars ? (
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {Array.from({ length: selected.stars }).map((_, index) => (
                  <Star key={index} size={11} color={colors.gold} fill={colors.gold} />
                ))}
              </View>
            ) : null}
            {selected.rating > 0 ? (
              <Text style={{ color: colors.gold, fontSize: 12, fontFamily: fonts.sansBold }}>
                {selected.rating}/10
              </Text>
            ) : null}
          </View>

          <Text style={{ color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sans }} numberOfLines={1}>
            {selected.distanceToCenter ? `${selected.distanceToCenter.toFixed(1)} km du centre` : selected.address}
          </Text>

          <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.sansBold }}>
            {selected.pricePerNight}€<Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans }}>/nuit</Text>
          </Text>
        </View>

        <ChevronDown size={18} color={colors.textMuted} />
      </Pressable>

      <SelectionSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Hébergements suggérés"
        subtitle="Comparez les options retenues par le planificateur."
        options={sheetOptions}
        selectedValue={selected.id}
        onSelect={(value) => onSelect?.(value)}
        searchPlaceholder="Rechercher un hôtel"
        height={0.72}
        renderOption={({ hotel }, { selected: isSelected }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {hotel.photos?.[0] ? (
              <Image source={{ uri: hotel.photos[0] }} style={{ width: 60, height: 60, borderRadius: radius.lg }} resizeMode="cover" />
            ) : (
              <View style={{ width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 24 }}>🏨</Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: isSelected ? colors.gold : colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold, flex: 1 }} numberOfLines={1}>
                  {hotel.name}
                </Text>
                {hotel.distanceTier ? (
                  <View style={{ backgroundColor: TIER_CONFIG[hotel.distanceTier].bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ color: TIER_CONFIG[hotel.distanceTier].color, fontSize: 9, fontFamily: fonts.sansBold }}>
                      {TIER_CONFIG[hotel.distanceTier].label}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans }}>
                {hotel.distanceToCenter ? `${hotel.distanceToCenter.toFixed(1)} km du centre` : hotel.address}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansBold }}>
                  {hotel.pricePerNight}€
                </Text>
                {hotel.breakfastIncluded ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Coffee size={11} color={colors.active} />
                    <Text style={{ color: colors.active, fontSize: 11, fontFamily: fonts.sansSemiBold }}>Petit-déj</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}
