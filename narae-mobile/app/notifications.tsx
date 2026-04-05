import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, Heart, MessageCircle, UserPlus, Users, Vote, Mail } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useNotifications, type Notification, type NotificationType } from '@/hooks/useNotifications';
import { EmptyState } from '@/components/ui/EmptyState';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { colors, fonts, radius } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  follow: UserPlus,
  like: Heart,
  comment: MessageCircle,
  reply: MessageCircle,
  proposal: Vote,
  trip_invite: Users,
  message: Mail,
};

const TYPE_COLOR: Record<NotificationType, string> = {
  follow: '#60a5fa',
  like: '#f87171',
  comment: '#4ade80',
  reply: '#4ade80',
  proposal: '#a78bfa',
  trip_invite: colors.gold,
  message: '#38bdf8',
};

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

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, isLoading, markAsRead, markAllRead, refetch } = useNotifications();

  const handlePress = (notif: Notification) => {
    Haptics.selectionAsync();
    if (!notif.read) markAsRead([notif.id]);

    // Navigate based on type
    if (notif.data?.tripId) {
      router.push(`/trip/${notif.data.tripId}`);
    } else if (notif.data?.userId) {
      router.push(`/user/${notif.data.userId}`);
    } else if (notif.data?.conversationId) {
      router.push(`/messages/${notif.data.conversationId}` as any);
    }
  };

  return (
    <SafeAreaView style={s.container}>
      <PremiumBackground />

      <View style={s.header}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={s.headerTitle}>Notifications</Text>
        <Pressable onPress={() => { Haptics.selectionAsync(); markAllRead(); }} hitSlop={12}>
          <Text style={s.markAll}>Tout lire</Text>
        </Pressable>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={s.list}
        refreshing={isLoading}
        onRefresh={refetch}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon={Bell}
              title="Aucune notification"
              description="Vous serez notifié quand quelqu'un interagit avec vos voyages."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const Icon = TYPE_ICON[item.type] || Bell;
          const iconColor = TYPE_COLOR[item.type] || colors.gold;
          return (
            <Pressable
              onPress={() => handlePress(item)}
              style={[s.notifRow, !item.read && s.notifRowUnread]}
            >
              <View style={[s.iconWrap, { backgroundColor: `${iconColor}15` }]}>
                <Icon size={18} color={iconColor} />
              </View>
              <View style={s.notifContent}>
                <Text style={s.notifTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={s.notifBody} numberOfLines={2}>{item.body}</Text>
              </View>
              <Text style={s.notifTime}>{timeAgo(item.created_at)}</Text>
              {!item.read ? <View style={s.unreadDot} /> : null}
            </Pressable>
          );
        }}
      />
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
  headerTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.display },
  markAll: { color: colors.gold, fontSize: 12, fontFamily: fonts.sansBold },
  list: { paddingBottom: 40 },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  notifRowUnread: {
    backgroundColor: 'rgba(197,160,89,0.04)',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: { flex: 1, gap: 2 },
  notifTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold },
  notifBody: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans, lineHeight: 17 },
  notifTime: { color: colors.textDim, fontSize: 11, fontFamily: fonts.sans },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
    position: 'absolute',
    top: 14,
    right: 16,
  },
});
