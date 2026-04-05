import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { getXpForLevel, getLevelTitle } from '@/lib/constants/badges';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  level: number;
  totalXp: number;
}

export function LevelProgress({ level, totalXp }: Props) {
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const progress = nextLevelXp > currentLevelXp
    ? (totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp)
    : 1;
  const title = getLevelTitle(level);

  const barStyle = useAnimatedStyle(() => ({
    width: `${withTiming(Math.min(progress, 1) * 100, { duration: 800 })}%`,
  }));

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.levelBadge}>
          <Text style={s.levelText}>{level}</Text>
        </View>
        <View style={s.headerInfo}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.xpText}>{totalXp} XP</Text>
        </View>
      </View>

      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, barStyle]} />
      </View>

      <View style={s.footer}>
        <Text style={s.footerText}>Niveau {level}</Text>
        <Text style={s.footerText}>{nextLevelXp - totalXp} XP restants</Text>
        <Text style={s.footerText}>Niveau {level + 1}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    gap: 10,
    padding: 18,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  levelBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
    color: colors.gold,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  headerInfo: { gap: 2 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.sansBold,
  },
  xpText: {
    color: colors.gold,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: fonts.sans,
  },
});
