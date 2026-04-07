import { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, Minus, Plus, Calendar } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import type { TripPreferences } from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function StepWhen({ prefs, onChange }: Props) {
  const { t } = useTranslation();
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(prefs.startDate ? new Date(prefs.startDate).getMonth() : today.getMonth());
  const [viewYear, setViewYear] = useState(prefs.startDate ? new Date(prefs.startDate).getFullYear() : today.getFullYear());
  const selectedDate = prefs.startDate ? new Date(prefs.startDate) : null;
  const duration = prefs.durationDays ?? 3;

  const monthName = (idx: number) => t(`plan.when.month.${idx}` as any);
  const formatShort = (d: Date) => `${d.getDate()} ${monthName(d.getMonth()).slice(0, 3)}`;

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [viewMonth, viewYear]);

  const quickDates = useMemo(() => {
    const now = new Date();
    const nextWeekend = new Date(now);
    nextWeekend.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const inTwoWeeks = new Date(now);
    inTwoWeeks.setDate(now.getDate() + 14);

    return [
      { label: t('plan.when.quick.weekend'), date: nextWeekend, sub: formatShort(nextWeekend) },
      { label: t('plan.when.quick.twoweeks'), date: inTwoWeeks, sub: formatShort(inTwoWeeks) },
      { label: t('plan.when.quick.nextmonth'), date: nextMonth, sub: monthName(nextMonth.getMonth()) },
      { label: t('plan.when.quick.flexible'), date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30), sub: t('plan.when.quick.flexible_sub') },
    ];
  }, [t]);

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

  const selectQuick = (date: Date) => {
    Haptics.selectionAsync();
    onChange({ startDate: date });
    setViewMonth(date.getMonth());
    setViewYear(date.getFullYear());
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
      {/* Title */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>{t('plan.when.title')}</Text>
        <Text style={s.subtitle}>{t('plan.when.subtitle')}</Text>
      </View>

      {/* Quick dates — matches web grid-cols-2 */}
      <View style={s.quickGrid}>
        {quickDates.map((q) => (
          <Pressable key={q.label} onPress={() => selectQuick(q.date)} style={s.quickCard}>
            <Text style={s.quickLabel}>{q.label}</Text>
            <Text style={s.quickSub}>{q.sub}</Text>
          </Pressable>
        ))}
      </View>

      {/* Duration spinner — moved above calendar per user feedback */}
      <View style={s.durationBox}>
        <Text style={s.calendarSectionLabel}>{t('plan.when.duration')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, marginTop: 16 }}>
          <Pressable
            onPress={() => { if (duration > 1) { Haptics.selectionAsync(); onChange({ durationDays: duration - 1 }); } }}
            style={[s.spinnerButton, duration <= 1 && { opacity: 0.3 }]}
          >
            <Minus size={22} color={colors.text} />
          </Pressable>

          <View style={{ alignItems: 'center', minWidth: 80 }}>
            <Text style={s.durationNumber}>{duration}</Text>
            <Text style={s.durationLabel}>{duration === 1 ? t('plan.when.duration.singular') : t('plan.when.duration.plural')}</Text>
          </View>

          <Pressable
            onPress={() => { if (duration < 21) { Haptics.selectionAsync(); onChange({ durationDays: duration + 1 }); } }}
            style={[s.spinnerButton, duration >= 21 && { opacity: 0.3 }]}
          >
            <Plus size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Calendar — matches web rounded-xl border bg-card p-3 */}
      <View style={s.calendarBox}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Calendar size={14} color={colors.gold} />
          <Text style={s.calendarSectionLabel}>{t('plan.when.calendar')}</Text>
        </View>

        {/* Month navigation */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Pressable onPress={prevMonth} hitSlop={12} style={s.monthButton}>
            <ChevronLeft size={20} color={colors.textSecondary} />
          </Pressable>
          <Text style={s.monthTitle}>{monthName(viewMonth)} {viewYear}</Text>
          <Pressable onPress={nextMonth} hitSlop={12} style={s.monthButton}>
            <ChevronRight size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Day headers */}
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          {DAYS.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.dayHeader}>{d}</Text>
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
                  style={[s.dayCell, isSelected(day) && s.dayCellSelected, isPast(day) && { opacity: 0.3 }]}
                >
                  <Text style={[s.dayText, isSelected(day) && s.dayTextSelected]}>
                    {day}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
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
  // Quick dates grid
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickCard: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
  },
  quickLabel: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
  quickSub: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sans,
    marginTop: 4,
  },
  // Calendar — matches web rounded-xl border bg-card
  calendarBox: {
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
    padding: 20,
  },
  calendarSectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  monthButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.displaySemiBold,
  },
  dayHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  dayCellSelected: {
    backgroundColor: colors.gold,
  },
  dayText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
  dayTextSelected: {
    color: colors.bg,
    fontFamily: fonts.sansBold,
  },
  // Duration — matches web counter style
  durationBox: {
    borderRadius: 40,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
    padding: 24,
    alignItems: 'center',
  },
  spinnerButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationNumber: {
    color: colors.gold,
    fontSize: 48,
    fontFamily: fonts.display,
    lineHeight: 52,
  },
  durationLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 4,
  },
});
