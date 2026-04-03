import { View, Text, Pressable } from 'react-native';
import { Plane, Train, Bus, Car, Ship, Zap, Clock, Leaf, ChevronDown } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { useState } from 'react';
import type { TransportOptionSummary } from '@/lib/types/trip';
import type { LucideIcon } from 'lucide-react-native';
import { SelectionSheet, type SelectionSheetOption } from '@/components/ui/SelectionSheet';

interface Props {
  options: TransportOptionSummary[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

const MODE_ICONS: Record<string, LucideIcon> = {
  plane: Plane, train: Train, bus: Bus, car: Car, ferry: Ship, combined: Zap,
};

function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`;
}

function getScoreColor(score: number): string {
  if (score >= 7) return colors.active;
  if (score >= 5) return '#fbbf24';
  return colors.danger;
}

export function TransportSelector({ options, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  if (!options?.length) return null;

  const selected = options.find((o) => o.id === selectedId) || options.find((o) => o.recommended) || options[0];
  const Icon = MODE_ICONS[selected.mode] || Train;
  const sheetOptions: Array<SelectionSheetOption & { option: TransportOptionSummary }> = options.map((option) => ({
    value: option.id,
    label: option.mode.charAt(0).toUpperCase() + option.mode.slice(1),
    description: `${formatDuration(option.totalDuration)} · ${option.totalPrice}€`,
    searchText: `${option.mode} ${option.totalPrice} ${option.totalDuration}`,
    option,
  }));

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.card, borderRadius: radius.xl,
          paddingHorizontal: 14, paddingVertical: 10,
          borderWidth: 1, borderColor: colors.borderSubtle,
        }}
      >
        <Icon size={16} color={colors.gold} />
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}>
          {formatDuration(selected.totalDuration)} · {selected.totalPrice}€
        </Text>
        <ChevronDown size={16} color={colors.textMuted} />
      </Pressable>

      <SelectionSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Options de transport"
        subtitle={`${options.length} options comparées pour ce voyage.`}
        options={sheetOptions}
        selectedValue={selected.id}
        onSelect={(value) => onSelect?.(value)}
        renderOption={({ option }, { selected: isSelected }) => {
          const OptIcon = MODE_ICONS[option.mode] || Train;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <OptIcon size={20} color={isSelected ? colors.gold : colors.textSecondary} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold }}>
                    {option.mode.charAt(0).toUpperCase() + option.mode.slice(1)}
                  </Text>
                  {option.recommended ? (
                    <View style={{ backgroundColor: colors.goldBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                      <Text style={{ color: colors.gold, fontSize: 9, fontFamily: fonts.sansBold }}>MEILLEUR</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Clock size={11} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{formatDuration(option.totalDuration)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Leaf size={11} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>{option.totalCO2}kg CO₂</Text>
                  </View>
                </View>
              </View>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                borderWidth: 2, borderColor: getScoreColor(option.score),
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: getScoreColor(option.score), fontSize: 12, fontFamily: fonts.sansBold }}>
                  {option.score.toFixed(0)}
                </Text>
              </View>
              <Text style={{ color: colors.text, fontSize: 15, fontFamily: fonts.sansBold, minWidth: 52, textAlign: 'right' }}>
                {option.totalPrice}€
              </Text>
            </View>
          );
        }}
      />
    </>
  );
}
