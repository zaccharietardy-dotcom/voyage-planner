import { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { Send, Bot, Sparkles } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { supabase } from '@/lib/supabase/client';
import { SITE_URL } from '@/lib/constants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Ajouter une activité culturelle',
  'Changer le restaurant du déjeuner',
  'Plus de temps libre',
  'Ajouter une visite guidée',
  'Trouver un meilleur hôtel',
];

export function ChatPanel({ isOpen, onClose, tripId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${SITE_URL}/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text.trim(), history: messages }),
      });

      if (!res.ok) throw new Error('Erreur de réponse');

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.message || 'Je n\'ai pas pu traiter votre demande.',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Désolé, une erreur est survenue. Réessayez.',
      }]);
    } finally {
      setSending(false);
      setTimeout(() => flatListRef.current?.scrollToEnd(), 100);
    }
  }, [sending, messages, tripId]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.85}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={40}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Sparkles size={18} color={colors.gold} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Assistant Narae</Text>
            <Text style={styles.headerSubtitle}>Modifiez votre voyage par chat</Text>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Bot size={40} color={colors.textMuted} />
              <Text style={styles.emptyCopy}>
                Demandez-moi de modifier{'\n'}votre itinéraire
              </Text>
              <View style={styles.suggestionsWrap}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} onPress={() => sendMessage(s)} style={styles.suggestionChip}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.messageBubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={[styles.messageText, item.role === 'user' ? styles.userMessageText : null]}>
                {item.content}
              </Text>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Modifier mon itinéraire..."
            placeholderTextColor={colors.textDim}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            style={[styles.sendButton, input.trim() ? styles.sendButtonActive : null, (!input.trim() || sending) ? styles.sendButtonDisabled : null]}
          >
            <Send size={20} color={input.trim() ? colors.bg : colors.textMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    gap: 3,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    gap: 12,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyCopy: {
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlign: 'center',
    lineHeight: 22,
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  suggestionChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  messageBubble: {
    maxWidth: '82%',
    borderRadius: 22,
    padding: 14,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.gold,
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderBottomLeftRadius: 6,
  },
  messageText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  userMessageText: {
    color: colors.bg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.button,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  sendButtonActive: {
    backgroundColor: colors.gold,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
});
