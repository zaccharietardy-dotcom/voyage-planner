import { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
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
    <View style={{ gap: 28 }}>
      {/* Calendar */}
      <View>
        <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>Date de départ</Text>

        {/* Month navigation */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={prevMonth} hitSlop={12}>
            <ChevronLeft size={22} color="#94a3b8" />
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 17, fontFamily: fonts.display }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
          <Pressable onPress={nextMonth} hitSlop={12}>
            <ChevronRight size={22} color="#94a3b8" />
          </Pressable>
        </View>

        {/* Day headers */}
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          {DAYS.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '600' }}>{d}</Text>
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
                    borderRadius: 10,
                    backgroundColor: isSelected(day) ? '#c5a059' : 'transparent',
                    opacity: isPast(day) ? 0.3 : 1,
                  }}
                >
                  <Text style={{
                    color: isSelected(day) ? '#020617' : '#f8fafc',
                    fontSize: 14, fontWeight: isSelected(day) ? '800' : '500',
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
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 12 }}>Durée du voyage</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <Pressable
            onPress={() => {
              if (duration > 1) {
                Haptics.selectionAsync();
                onChange({ durationDays: duration - 1 });
              }
            }}
            style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.05)',
              alignItems: 'center', justifyContent: 'center',
              opacity: duration <= 1 ? 0.3 : 1,
            }}
          >
            <Minus size={20} color="#f8fafc" />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.gold, fontSize: 44, fontFamily: fonts.display }}>{duration}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{duration === 1 ? 'jour' : 'jours'}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (duration < 21) {
                Haptics.selectionAsync();
                onChange({ durationDays: duration + 1 });
              }
            }}
            style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.05)',
              alignItems: 'center', justifyContent: 'center',
              opacity: duration >= 21 ? 0.3 : 1,
            }}
          >
            <Plus size={20} color="#f8fafc" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
