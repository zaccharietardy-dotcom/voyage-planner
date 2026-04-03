import { useState, useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export function StepWhen({ prefs, onChange }: Props) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(prefs.startDate ? new Date(prefs.startDate).getMonth() : today.getMonth());
  const [viewYear, setViewYear] = useState(prefs.startDate ? new Date(prefs.startDate).getFullYear() : today.getFullYear());
  const selectedDate = prefs.startDate ? new Date(prefs.startDate) : null;
  const duration = prefs.durationDays ?? 3;

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    // Monday = 0
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];

    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return cells;
  }, [viewMonth, viewYear]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const selectDay = (day: number) => {
    Haptics.selectionAsync();
    const d = new Date(viewYear, viewMonth, day);
    if (d < today) return;
    onChange({ startDate: d });
  };

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return selectedDate.getDate() === day && selectedDate.getMonth() === viewMonth && selectedDate.getFullYear() === viewYear;
  };

  const isPast = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    return d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  };

  return (
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display }}>
          Quand partez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 }}>
          Définissez vos dates et la durée
        </Text>
      </View>

      {/* Calendar */}
      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, borderCurve: 'continuous', padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>Date de départ</Text>

        {/* Month navigation */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={prevMonth} hitSlop={12}>
            <ChevronLeft size={22} color={colors.textSecondary} />
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.displaySemiBold }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
          <Pressable onPress={nextMonth} hitSlop={12}>
            <ChevronRight size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Day headers */}
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          {DAYS.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sansSemiBold }}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Day grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {calendarDays.map((day, i) => (
            <View key={i} style={{ width: '14.28%', aspectRatio: 1, padding: 2 }}>
              {day !== null && (
                <Pressable
                  onPress={() => selectDay(day)}
                  disabled={isPast(day)}
                  style={{
                    flex: 1, alignItems: 'center', justifyContent: 'center',
                    borderRadius: radius.sm, borderCurve: 'continuous',
                    backgroundColor: isSelected(day) ? colors.gold : 'transparent',
                    opacity: isPast(day) ? 0.3 : 1,
                  }}
                >
                  <Text style={{
                    color: isSelected(day) ? colors.bg : colors.text,
                    fontSize: 14, fontFamily: isSelected(day) ? fonts.sansBold : fonts.sansMedium,
                  }}>
                    {day}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Duration */}
      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, borderCurve: 'continuous', padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 20, textAlign: 'center' }}>Durée du voyage</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          <Pressable
            onPress={() => {
              if (duration > 1) {
                Haptics.selectionAsync();
                onChange({ durationDays: duration - 1 });
              }
            }}
            style={{
              width: 56, height: 56, borderRadius: radius.xl,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              opacity: duration <= 1 ? 0.3 : 1,
            }}
          >
            <Minus size={24} color={colors.text} />
          </Pressable>
          <View style={{ alignItems: 'center', minWidth: 80 }}>
            <Text style={{ color: colors.gold, fontSize: 48, fontFamily: fonts.display }}>{duration}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sansMedium }}>{duration === 1 ? 'jour' : 'jours'}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (duration < 21) {
                Haptics.selectionAsync();
                onChange({ durationDays: duration + 1 });
              }
            }}
            style={{
              width: 56, height: 56, borderRadius: radius.xl,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              opacity: duration >= 21 ? 0.3 : 1,
            }}
          >
            <Plus size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
