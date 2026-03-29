import { ScrollView, Pressable, Text } from 'react-native';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  totalDays: number;
  activeDay: number | null;
  onSelect: (day: number | null) => void;
}

export function DaySelector({ totalDays, activeDay, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingVertical: 8 }}
    >
      {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
        const isActive = activeDay === day;
        return (
          <Pressable
            key={day}
            onPress={() => onSelect(isActive ? null : day)}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md,
              backgroundColor: isActive ? colors.gold : colors.surface,
              borderWidth: 1, borderColor: isActive ? colors.gold : colors.borderSubtle,
            }}
          >
            <Text style={{
              color: isActive ? colors.bg : colors.textSecondary,
              fontSize: 13, fontWeight: '700',
              fontFamily: isActive ? fonts.display : undefined,
            }}>
              Jour {day}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
