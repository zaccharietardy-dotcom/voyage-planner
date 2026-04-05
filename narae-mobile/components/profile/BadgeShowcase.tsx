import { View, Text, Pressable, StyleSheet } from 'react-native';
import { BADGES, BADGE_MAP, TIER_COLORS, type Badge, type BadgeTier } from '@/lib/constants/badges';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  earnedBadgeIds: string[];
  onBadgePress?: (badge: Badge) => void;
}

export function BadgeShowcase({ earnedBadgeIds, onBadgePress }: Props) {
  const earnedSet = new Set(earnedBadgeIds);

  return (
    <View style={s.container}>
      <Text style={s.title}>Badges ({earnedBadgeIds.length}/{BADGES.length})</Text>
      <View style={s.grid}>
        {BADGES.map((badge) => {
          const earned = earnedSet.has(badge.id);
          return (
            <Pressable
              key={badge.id}
              onPress={() => onBadgePress?.(badge)}
              style={[s.badgeCard, earned ? s.badgeCardEarned : s.badgeCardLocked]}
            >
              <Text style={[s.emoji, !earned && s.emojiLocked]}>{badge.emoji}</Text>
              <Text style={[s.badgeName, !earned && s.badgeNameLocked]} numberOfLines={1}>
                {badge.name}
              </Text>
              {earned ? (
                <View style={[s.tierDot, { backgroundColor: TIER_COLORS[badge.tier] }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 12 },
  title: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeCard: {
    width: '30%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  badgeCardEarned: {
    backgroundColor: 'rgba(197,160,89,0.08)',
    borderColor: 'rgba(197,160,89,0.2)',
  },
  badgeCardLocked: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.04)',
  },
  emoji: { fontSize: 24 },
  emojiLocked: { opacity: 0.3 },
  badgeName: {
    color: colors.text,
    fontSize: 10,
    fontFamily: fonts.sansSemiBold,
    textAlign: 'center',
  },
  badgeNameLocked: {
    color: colors.textMuted,
  },
  tierDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
