import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { UserPlus, UserCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { fetchRecommendedUsers, followUser, unfollowUser, type FollowUser } from '@/lib/api/social';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';

export function RecommendedUsers() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<FollowUser[]>([]);

  useEffect(() => {
    if (!user) return;
    fetchRecommendedUsers()
      .then(setUsers)
      .catch(() => {});
  }, [user]);

  const handleToggleFollow = async (target: FollowUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasFollowing = target.isFollowing;
    setUsers((prev) =>
      prev.map((u) => (u.id === target.id ? { ...u, isFollowing: !wasFollowing } : u)),
    );
    try {
      if (wasFollowing) await unfollowUser(target.id);
      else await followUser(target.id);
    } catch {
      setUsers((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, isFollowing: wasFollowing } : u)),
      );
    }
  };

  if (!user || users.length === 0) return null;

  return (
    <View style={s.container}>
      <Text style={s.title}>Voyageurs à suivre</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {users.map((u) => (
          <Pressable
            key={u.id}
            style={s.card}
            onPress={() => router.push(`/user/${u.id}`)}
          >
            <Avatar url={u.avatar_url} name={u.display_name || '?'} size="md" />
            <Text style={s.name} numberOfLines={1}>{u.display_name}</Text>
            <Pressable
              onPress={() => handleToggleFollow(u)}
              style={[s.followBtn, u.isFollowing ? s.followBtnActive : null]}
            >
              {u.isFollowing ? (
                <UserCheck size={14} color={colors.gold} />
              ) : (
                <UserPlus size={14} color={colors.text} />
              )}
              <Text style={s.followText}>{u.isFollowing ? 'Suivi' : 'Suivre'}</Text>
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 12, paddingTop: 4 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.display,
    paddingHorizontal: 20,
  },
  scroll: { paddingHorizontal: 20, gap: 12 },
  card: {
    width: 120,
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    textAlign: 'center',
  },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  followBtnActive: {
    backgroundColor: colors.goldBg,
  },
  followText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },
});
