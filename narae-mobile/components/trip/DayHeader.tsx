import { View, Text } from 'react-native';
import { colors, fonts } from '@/lib/theme';

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
    <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{
          backgroundColor: isDayTrip ? colors.upcomingBg : colors.goldBg,
          paddingHorizontal: 14,
          paddingVertical: 7,
          borderRadius: 12,
        }}>
          <Text style={{
            color: isDayTrip ? colors.upcoming : colors.gold,
            fontSize: 14,
            fontFamily: fonts.display,
          }}>
            Jour {dayNumber}
          </Text>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: 'capitalize' }}>
          {formatDayDate(date)}
        </Text>
      </View>
      {theme && (
        <Text style={{
          color: '#e2e8f0',
          fontSize: 15,
          fontFamily: fonts.displayMedium,
          marginTop: 8,
          marginLeft: 2,
        }}>
          {theme}
        </Text>
      )}
    </View>
  );
}
