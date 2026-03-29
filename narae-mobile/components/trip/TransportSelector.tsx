import { View, Text, Pressable, Linking } from 'react-native';
import { Plane, Train, Bus, Car, Ship, Zap, Clock, Leaf, ChevronDown, Check, ExternalLink } from 'lucide-react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { colors, fonts, radius } from '@/lib/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useState } from 'react';
import type { TransportOptionSummary } from '@/lib/types/trip';
import type { LucideIcon } from 'lucide-react-native';

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

      <BottomSheet isOpen={open} onClose={() => setOpen(false)} height={0.65}>
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display, marginBottom: 8 }}>
            Options de transport
          </Text>
          {options.map((opt) => {
            const OptIcon = MODE_ICONS[opt.mode] || Train;
            const isSelected = opt.id === selected.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => { onSelect?.(opt.id); setOpen(false); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: isSelected ? colors.goldBg : colors.surface,
                  borderRadius: radius.lg, padding: 14,
                  borderWidth: 1, borderColor: isSelected ? colors.goldBorder : colors.borderSubtle,
                }}
              >
                <OptIcon size={20} color={isSelected ? colors.gold : colors.textSecondary} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                      {opt.mode.charAt(0).toUpperCase() + opt.mode.slice(1)}
                    </Text>
                    {opt.recommended && (
                      <View style={{ backgroundColor: colors.goldBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ color: colors.gold, fontSize: 9, fontWeight: '700' }}>MEILLEUR</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Clock size={11} color={colors.textMuted} />
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{formatDuration(opt.totalDuration)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Leaf size={11} color={colors.textMuted} />
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{opt.totalCO2}kg CO₂</Text>
                    </View>
                  </View>
                </View>
                {/* Score */}
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  borderWidth: 2, borderColor: getScoreColor(opt.score),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: getScoreColor(opt.score), fontSize: 12, fontWeight: '800' }}>
                    {opt.score.toFixed(0)}
                  </Text>
                </View>
                {/* Price */}
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', minWidth: 50, textAlign: 'right' }}>
                  {opt.totalPrice}€
                </Text>
                {isSelected && <Check size={16} color={colors.gold} />}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </>
  );
}
