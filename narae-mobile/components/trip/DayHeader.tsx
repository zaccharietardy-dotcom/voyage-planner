import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  dayNumber: number;
  date: Date | string;
  theme?: string;
  isDayTrip?: boolean;
}

function formatDayDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function DayHeader({ dayNumber, date, theme, isDayTrip }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.badge, isDayTrip ? styles.dayTripBadge : styles.defaultBadge]}>
          <Text style={[styles.badgeText, { color: isDayTrip ? colors.upcoming : colors.gold }]}>
            Jour {dayNumber}
          </Text>
        </View>
        <Text style={styles.date}>{formatDayDate(date)}</Text>
      </View>
      {theme ? <Text style={styles.theme}>{theme}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 14,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  defaultBadge: {
    backgroundColor: colors.goldBg,
    borderColor: colors.goldBorder,
  },
  dayTripBadge: {
    backgroundColor: colors.upcomingBg,
    borderColor: 'rgba(96,165,250,0.2)',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  date: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    textTransform: 'capitalize',
  },
  theme: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.displayMedium,
    marginLeft: 2,
  },
});
