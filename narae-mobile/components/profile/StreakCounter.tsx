import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { colors, fonts } from '@/lib/theme';

interface Props {
  currentStreak: number;
  longestStreak: number;
}

export function StreakCounter({ currentStreak, longestStreak }: Props) {
  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withRepeat(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          -1,
          true,
        ),
      },
    ],
  }));

  return (
    <View style={s.container}>
      <View style={s.row}>
        {currentStreak > 0 ? (
          <Animated.Text style={[s.flame, flameStyle]}>🔥</Animated.Text>
        ) : (
          <Text style={s.flameOff}>🔥</Text>
        )}
        <View>
          <Text style={s.value}>{currentStreak} jours</Text>
          <Text style={s.label}>Série actuelle</Text>
        </View>
      </View>
      <View style={s.divider} />
      <View style={s.row}>
        <Text style={s.trophy}>🏆</Text>
        <View>
          <Text style={s.value}>{longestStreak} jours</Text>
          <Text style={s.label}>Record</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  divider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.08)' },
  flame: { fontSize: 28 },
  flameOff: { fontSize: 28, opacity: 0.3 },
  trophy: { fontSize: 24 },
  value: { color: colors.text, fontSize: 16, fontFamily: fonts.sansBold },
  label: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans },
});
