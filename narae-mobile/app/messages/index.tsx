import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, MessageCircle, PenSquare } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { fetchConversations, fetchOrCreateConversation, type Conversation } from '@/lib/api/messages';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { colors, fonts, radius } from '@/lib/theme';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'maintenant';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

export default function MessagesListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { newConversation } = useLocalSearchParams<{ newConversation?: string }>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const convs = await fetchConversations();
      setConversations(convs);
    } catch {}
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Handle deep link to create new conversation
  useEffect(() => {
    if (!newConversation || !user) return;
    (async () => {
      try {
        const { id } = await fetchOrCreateConversation(newConversation);
        router.replace(`/messages/${id}` as any);
      } catch {}
    })();
  }, [newConversation, user, router]);

  if (!user) {
    return (
      <SafeAreaView style={s.container}>
        <PremiumBackground />
        <EmptyState
          icon={MessageCircle}
          title="Connectez-vous"
          description="Accédez à vos messages en vous connectant."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <PremiumBackground />

      <View style={s.header}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={s.headerTitle}>Messages</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.skeletons}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={s.skelRow}>
              <Skeleton width={48} height={48} radius={24} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width={120} height={14} />
                <Skeleton width={200} height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          contentContainerStyle={s.list}
          refreshing={false}
          onRefresh={loadConversations}
          ListEmptyComponent={
            <EmptyState
              icon={MessageCircle}
              title="Aucune conversation"
              description="Envoyez un message depuis le profil d'un voyageur."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push(`/messages/${item.id}` as any);
              }}
              style={s.convRow}
            >
              <Avatar
                url={item.participant.avatar_url}
                name={item.participant.display_name || '?'}
                size="md"
              />
              <View style={s.convContent}>
                <View style={s.convTop}>
                  <Text style={s.convName} numberOfLines={1}>
                    {item.participant.display_name}
                  </Text>
                  {item.lastMessage ? (
                    <Text style={s.convTime}>{timeAgo(item.lastMessage.created_at)}</Text>
                  ) : null}
                </View>
                {item.lastMessage ? (
                  <Text style={s.convPreview} numberOfLines={1}>
                    {item.lastMessage.sender_id === user.id ? 'Vous : ' : ''}
                    {item.lastMessage.content}
                  </Text>
                ) : (
                  <Text style={s.convPreview}>Nouvelle conversation</Text>
                )}
              </View>
              {item.unreadCount > 0 ? (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadText}>{item.unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  skeletons: { padding: 20, gap: 16 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  list: { paddingBottom: 40 },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  convContent: { flex: 1, gap: 4 },
  convTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  convName: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansSemiBold,
    flex: 1,
  },
  convTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  convPreview: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: colors.bg,
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },
});
