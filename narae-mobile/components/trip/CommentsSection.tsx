import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { MessageCircle, Send, CornerDownRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';

interface Comment {
  id: string;
  trip_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

interface Props {
  tripId: string;
}

export function CommentsSection({ tripId }: Props) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('comments.time.now');
    if (mins < 60) return t('comments.time.min', { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('comments.time.hours', { n: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t('comments.time.days', { n: days });
    return t('comments.time.months', { n: Math.floor(days / 30) });
  }
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const fetchComments = useCallback(async () => {
    try {
      const res = await api.get<{ comments: Comment[] }>(`/api/trips/${tripId}/comments`);
      setComments(res.comments ?? []);
    } catch {}
  }, [tripId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    if (!user) {
      router.push('/(auth)/login');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    try {
      const body: { content: string; parentId?: string } = { content: text.trim() };
      if (replyTo) body.parentId = replyTo.id;
      await api.post(`/api/trips/${tripId}/comments`, body);
      setText('');
      setReplyTo(null);
      await fetchComments();
    } catch {}
    setSending(false);
  };

  // Build tree: root comments with nested replies
  const roots = comments.filter((c) => !c.parent_id);
  const replies = comments.filter((c) => c.parent_id);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <MessageCircle size={16} color={colors.gold} />
        <Text style={s.headerText}>{t('comments.title', { count: comments.length })}</Text>
      </View>

      {roots.length === 0 ? (
        <Text style={s.empty}>{t('comments.empty')}</Text>
      ) : null}

      {roots.map((comment) => {
        const childReplies = replies.filter((r) => r.parent_id === comment.id);
        return (
          <View key={comment.id}>
            <CommentRow
              comment={comment}
              onReply={() => setReplyTo(comment)}
              onUserPress={(userId) => router.push(`/user/${userId}`)}
              timeAgoFn={timeAgo}
            />
            {childReplies.map((reply) => (
              <View key={reply.id} style={s.replyIndent}>
                <CornerDownRight size={12} color={colors.textDim} style={{ marginTop: 8 }} />
                <CommentRow
                  comment={reply}
                  onReply={() => setReplyTo(comment)}
                  onUserPress={(userId) => router.push(`/user/${userId}`)}
                  timeAgoFn={timeAgo}
                />
              </View>
            ))}
          </View>
        );
      })}

      {/* Input */}
      <View style={s.inputWrap}>
        {replyTo ? (
          <Pressable onPress={() => setReplyTo(null)} style={s.replyBanner}>
            <Text style={s.replyBannerText}>
              {t('comments.replyTo', { name: replyTo.user?.display_name || t('comments.author.anon') })}
            </Text>
            <Text style={s.replyCancel}>✕</Text>
          </Pressable>
        ) : null}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder={t('comments.input')}
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || sending}
            style={[s.sendBtn, text.trim() ? s.sendBtnActive : null]}
          >
            <Send size={16} color={text.trim() ? colors.bg : colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CommentRow({
  comment,
  onReply,
  onUserPress,
  timeAgoFn,
}: {
  comment: Comment;
  onReply: () => void;
  onUserPress: (userId: string) => void;
  timeAgoFn: (dateStr: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <View style={s.commentRow}>
      <Pressable onPress={() => onUserPress(comment.user_id)}>
        <Avatar url={comment.user?.avatar_url} name={comment.user?.display_name || '?'} size="sm" />
      </Pressable>
      <View style={s.commentBody}>
        <View style={s.commentTop}>
          <Text style={s.commentAuthor} numberOfLines={1}>
            {comment.user?.display_name || t('comments.author.anon')}
          </Text>
          <Text style={s.commentTime}>{timeAgoFn(comment.created_at)}</Text>
        </View>
        <Text style={s.commentText}>{comment.content}</Text>
        <Pressable onPress={onReply} hitSlop={8}>
          <Text style={s.replyBtn}>{t('comments.reply')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerText: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.sans,
    fontStyle: 'italic',
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  commentBody: { flex: 1, gap: 3 },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAuthor: { color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold, flex: 1 },
  commentTime: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans },
  commentText: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans, lineHeight: 19 },
  replyBtn: { color: colors.gold, fontSize: 11, fontFamily: fonts.sansBold, marginTop: 2 },
  replyIndent: { flexDirection: 'row', gap: 6, paddingLeft: 28 },
  inputWrap: { marginTop: 4 },
  replyBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderRadius: 8,
    marginBottom: 6,
  },
  replyBannerText: { color: colors.gold, fontSize: 12, fontFamily: fonts.sansSemiBold },
  replyCancel: { color: colors.textMuted, fontSize: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    maxHeight: 80,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: colors.gold,
  },
});
