import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Calendar, Plus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, goldGradient } from '@/lib/theme';

interface Props {
  dayNumber: number;
  date: Date | string;
  theme?: string;
  isDayTrip?: boolean;
  weather?: { icon: string; tempMax: number } | null;
  onAdd?: () => void;
}

function formatDayDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function DayHeader({ dayNumber, date, theme, weather, onAdd }: Props) {
  return (
    <View style={s.container}>
      <View style={s.topRow}>
        {/* Day number in gold gradient square — matches web w-14 h-14 rounded-[1.5rem] */}
        <LinearGradient colors={[...goldGradient]} style={s.dayCircle}>
          <Text style={s.dayNumber}>{dayNumber}</Text>
        </LinearGradient>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.title}>Jour {dayNumber}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Calendar size={12} color={colors.gold} />
            <Text style={s.dateText}>{formatDayDate(date)}</Text>
          </View>
        </View>

        {/* Add activity button */}
        {onAdd ? (
          <Pressable onPress={onAdd} style={s.addButton}>
            <Plus size={18} color={colors.gold} />
          </Pressable>
        ) : null}

        {/* Weather badge */}
        {weather ? (
          <View style={s.weatherBadge}>
            <Text style={s.weatherText}>{weather.icon} {weather.tempMax}°</Text>
          </View>
        ) : null}
      </View>

      {theme ? <Text style={s.theme}>{theme}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  // Container — matches web rounded-[2.5rem] border-white/5 bg-black/40 p-5
  container: {
    borderRadius: 40,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 20,
    marginHorizontal: 4,
    marginTop: 24,
    marginBottom: 8,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  // Day number — matches web w-14 h-14 rounded-[1.5rem] bg-gold-gradient
  dayCircle: {
    width: 56,
    height: 56,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  dayNumber: {
    color: '#000',
    fontSize: 24,
    fontFamily: fonts.sansBold,
  },
  // Title — matches web font-black text-2xl text-white tracking-tight
  title: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.sansBold,
    letterSpacing: -0.3,
  },
  // Date — matches web text-[10px] font-black uppercase tracking-[0.2em] text-white/60
  dateText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  // Weather — matches web text-xs font-black text-gold bg-gold/10 rounded-full
  weatherBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.2)',
  },
  weatherText: {
    color: colors.gold,
    fontSize: 12,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  theme: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: fonts.sans,
    fontStyle: 'italic',
    marginLeft: 70,
  },
});
