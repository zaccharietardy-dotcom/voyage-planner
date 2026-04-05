import { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Search, UserPlus, UserCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { searchUsers, followUser, unfollowUser, type FollowUser } from '@/lib/api/social';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  onClose?: () => void;
}

export function UserSearch({ onClose }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const users = await searchUsers(text);
        setResults(users.filter((u) => u.id !== user?.id));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [user?.id]);

  const handleToggleFollow = useCallback(async (targetUser: FollowUser) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasFollowing = targetUser.isFollowing;
    setResults((prev) =>
      prev.map((u) => (u.id === targetUser.id ? { ...u, isFollowing: !wasFollowing } : u)),
    );
    try {
      if (wasFollowing) await unfollowUser(targetUser.id);
      else await followUser(targetUser.id);
    } catch {
      setResults((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, isFollowing: wasFollowing } : u)),
      );
    }
  }, []);

  return (
    <View style={s.container}>
      <View style={s.searchBar}>
        <Search size={18} color={colors.textMuted} />
        <TextInput
          style={s.input}
          placeholder="Rechercher un voyageur..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={handleSearch}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading ? <ActivityIndicator size="small" color={colors.gold} /> : null}
      </View>

      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.length >= 2 && !loading ? (
            <Text style={s.empty}>Aucun voyageur trouv\u00e9</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.userRow}
            onPress={() => {
              onClose?.();
              router.push(`/user/${item.id}`);
            }}
          >
            <Avatar url={item.avatar_url} name={item.display_name || '?'} size="sm" />
            <View style={s.userInfo}>
              <Text style={s.userName} numberOfLines={1}>{item.display_name}</Text>
              {item.username ? (
                <Text style={s.userHandle} numberOfLines={1}>@{item.username}</Text>
              ) : null}
            </View>
            {user ? (
              <Pressable
                onPress={() => handleToggleFollow(item)}
                style={[s.followBtn, item.isFollowing ? s.followBtnActive : null]}
              >
                {item.isFollowing ? (
                  <UserCheck size={14} color={colors.gold} />
                ) : (
                  <UserPlus size={14} color={colors.text} />
                )}
              </Pressable>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sans,
  },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlign: 'center',
    paddingVertical: 32,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  userInfo: { flex: 1, gap: 2 },
  userName: { color: colors.text, fontSize: 15, fontFamily: fonts.sansSemiBold },
  userHandle: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans },
  followBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnActive: {
    backgroundColor: colors.goldBg,
  },
});
