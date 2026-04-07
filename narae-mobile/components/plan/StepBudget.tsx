import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Coins, Wallet, CreditCard, Gem } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import {
  BUDGET_LABELS, TRANSPORT_LABELS,
  type BudgetLevel, type TransportType, type TripPreferences,
} from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const BUDGET_OPTIONS: { key: BudgetLevel; labelKey: 'plan.budget.economic' | 'plan.budget.moderate' | 'plan.budget.comfort' | 'plan.budget.luxury'; rangeKey: 'plan.budget.economic.range' | 'plan.budget.moderate.range' | 'plan.budget.comfort.range' | 'plan.budget.luxury.range'; Icon: typeof Coins }[] = [
  { key: 'economic', labelKey: 'plan.budget.economic', rangeKey: 'plan.budget.economic.range', Icon: Coins },
  { key: 'moderate', labelKey: 'plan.budget.moderate', rangeKey: 'plan.budget.moderate.range', Icon: Wallet },
  { key: 'comfort', labelKey: 'plan.budget.comfort', rangeKey: 'plan.budget.comfort.range', Icon: CreditCard },
  { key: 'luxury', labelKey: 'plan.budget.luxury', rangeKey: 'plan.budget.luxury.range', Icon: Gem },
];

const TRANSPORT_OPTIONS: { value: TransportType; labelKey: 'plan.budget.transport.optimal' | 'plan.budget.transport.plane' | 'plan.budget.transport.train' | 'plan.budget.transport.car' | 'plan.budget.transport.bus'; emoji: string }[] = [
  { value: 'optimal', labelKey: 'plan.budget.transport.optimal', emoji: '🎯' },
  { value: 'plane', labelKey: 'plan.budget.transport.plane', emoji: '✈️' },
  { value: 'train', labelKey: 'plan.budget.transport.train', emoji: '🚄' },
  { value: 'car', labelKey: 'plan.budget.transport.car', emoji: '🚗' },
  { value: 'bus', labelKey: 'plan.budget.transport.bus', emoji: '🚌' },
];

export function StepBudget({ prefs, onChange }: Props) {
  const budget = prefs.budgetLevel ?? 'moderate';
  const transport = prefs.transport ?? 'optimal';
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  // Card width: container width minus padding (24*2) minus shell padding (20*2) minus gap (12)
  const cardW = (width - 48 - 40 - 12) / 2;

  return (
    <View style={{ gap: 28 }}>
      {/* Title */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>{t('plan.budget.title')}</Text>
        <Text style={s.subtitle}>{t('plan.budget.subtitle')}</Text>
      </View>

      {/* Budget 2x2 grid — fixed width cards */}
      <View style={s.budgetGrid}>
        {BUDGET_OPTIONS.map(({ key, labelKey, rangeKey, Icon }) => {
          const selected = budget === key;
          return (
            <Pressable
              key={key}
              onPress={() => { Haptics.selectionAsync(); onChange({ budgetLevel: key }); }}
              style={[s.budgetCard, { width: cardW }, selected && s.budgetCardSelected]}
            >
              <View style={[s.iconCircle, selected && s.iconCircleSelected]}>
                <Icon size={20} color={selected ? '#000' : 'rgba(255,255,255,0.4)'} />
              </View>
              <Text style={[s.budgetLabel, selected && { color: colors.text }]}>{t(labelKey)}</Text>
              <Text style={s.budgetRange}>{t(rangeKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Transport — horizontal scroll row */}
      <View style={{ gap: 12 }}>
        <Text style={s.sectionLabel}>{t('plan.budget.transport')}</Text>
        <View style={s.transportRow}>
          {TRANSPORT_OPTIONS.map((opt) => {
            const selected = transport === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { Haptics.selectionAsync(); onChange({ transport: opt.value }); }}
                style={[s.transportChip, selected && s.transportChipSelected]}
              >
                <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                <Text style={[s.transportLabel, selected && { color: colors.gold }]}>{t(opt.labelKey)}</Text>
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
    fontSize: 34,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontFamily: fonts.sans,
    marginTop: 4,
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
  // 2x2 grid with fixed card widths
  budgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  budgetCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
    gap: 6,
  },
  budgetCardSelected: {
    borderColor: colors.gold,
    backgroundColor: '#0e1220',
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleSelected: {
    backgroundColor: colors.gold,
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  budgetLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },
  budgetRange: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontFamily: fonts.sansMedium,
  },
  // Transport — even row of chips
  transportRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  transportChip: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  transportChipSelected: {
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderColor: colors.gold,
  },
  transportLabel: {
    color: colors.text,
    fontSize: 10,
    fontFamily: fonts.sansSemiBold,
  },
});
